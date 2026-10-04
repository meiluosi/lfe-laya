"""每个体独立的 MaskablePPO 会话；调度器可批量调用 Laya，但不共享训练状态。"""
import copy,hashlib,json,random,time
from contextlib import contextmanager
import gymnasium as gym
import numpy as np
import torch
from sb3_contrib import MaskablePPO
from stable_baselines3.common.logger import configure
from gym_env import ACTIONS,OBS_SIZE
from bridge import ROOT

class SpaceOnlyEnv(gym.Env):
    observation_space=gym.spaces.Box(-1,1,(OBS_SIZE,),np.float32)
    action_space=gym.spaces.Discrete(6)
    def reset(self,**kw):raise RuntimeError('World must be driven through TS bridge')
    def step(self,action):raise RuntimeError('World must be driven through TS bridge')

class PolicySession:
    VERSION='m0-policy-v1'
    def __init__(self,seed,config=None):
        self.config=copy.deepcopy(config or json.loads((ROOT/'experiments/m0/config/learning.json').read_text()))
        self.seed=seed;self.revision=0;self.frozen=False;self.consumed=set();self.committed={};self.pending=None;self.episode_start=True
        ambient=(random.getstate(),np.random.get_state(),torch.get_rng_state())
        try:
            kw={k:self.config[k] for k in ['learning_rate','n_steps','batch_size','n_epochs','gamma','gae_lambda','clip_range','ent_coef','vf_coef','max_grad_norm','normalize_advantage']}
            self.model=MaskablePPO('MlpPolicy',SpaceOnlyEnv(),device='cpu',seed=seed,policy_kwargs={'net_arch':self.config['network']},verbose=0,**kw)
            self.rng=(random.getstate(),np.random.get_state(),torch.get_rng_state())
        finally:random.setstate(ambient[0]);np.random.set_state(ambient[1]);torch.set_rng_state(ambient[2])
        self.model.set_logger(configure(folder=None,format_strings=[]))
    @contextmanager
    def own_rng(self):
        ambient=(random.getstate(),np.random.get_state(),torch.get_rng_state())
        random.setstate(self.rng[0]);np.random.set_state(self.rng[1]);torch.set_rng_state(self.rng[2])
        try:yield
        finally:
            self.rng=(random.getstate(),np.random.get_state(),torch.get_rng_state())
            random.setstate(ambient[0]);np.random.set_state(ambient[1]);torch.set_rng_state(ambient[2])
    def fingerprint(self):
        h=hashlib.sha256()
        for name,p in sorted(self.model.policy.state_dict().items()):h.update(name.encode());h.update(p.cpu().numpy().tobytes())
        return h.hexdigest()
    def act(self,request,obs,action_mask,provider="laya+individual-ppo"):
        key=json.dumps(request['identity'],sort_keys=True)
        if self.pending:
            if self.pending['key']==key:return copy.deepcopy(self.pending['decision'])
            raise RuntimeError('unsettled_action')
        tensor=torch.as_tensor(obs).unsqueeze(0)
        with self.own_rng(),torch.no_grad():
            self.model.policy.set_training_mode(False)
            dist=self.model.policy.get_distribution(tensor,action_masks=action_mask)
            action=dist.get_actions(deterministic=False)
            value=self.model.policy.predict_values(tensor);log_prob=dist.log_prob(action)
            probs=dist.distribution.probs[0].cpu().numpy()
        choice=int(action.item())
        decision={'identity':copy.deepcopy(request['identity']),'action':ACTIONS[choice],'provider':provider,
                  'distribution':{a:float(probs[i]) for i,a in enumerate(ACTIONS) if action_mask[i]},'revision':self.revision}
        self.pending={'key':key,'decision':copy.deepcopy(decision),'obs':obs.copy(),'mask':action_mask.copy(),'action':choice,'value':value.detach().clone(),'log_prob':log_prob.detach().clone()}
        return decision
    def settle(self,transition):
        if not transition['accepted']:raise ValueError('not_executed')
        key=json.dumps(transition['proposal']['identity'],sort_keys=True)
        if key in self.consumed:return {'duplicate':True}
        if not self.pending or self.pending['key']!=key or transition['action']!=self.pending['decision']['action']:raise ValueError('transition_mismatch')
        if not np.isfinite(transition['reward']):raise ValueError('invalid_reward')
        p=self.pending
        if not self.frozen:
            if self.model.rollout_buffer.full:raise RuntimeError('update_required_before_new_transition')
            self.model.rollout_buffer.add(p['obs'],np.array([p['action']]),np.array([transition['reward']]),np.array([self.episode_start]),p['value'],p['log_prob'],action_masks=p['mask'])
        self.consumed.add(key);self.pending=None;self.episode_start=bool(transition['terminated'] or transition['truncated'])
        self.model.num_timesteps+=1
        return {'duplicate':False,'sample_count':self.model.rollout_buffer.pos}
    def update(self,next_obs,terminated,batch_id,expected_revision):
        if batch_id in self.committed:return copy.deepcopy(self.committed[batch_id])
        if expected_revision!=self.revision:raise ValueError('stale_revision')
        if self.pending:raise ValueError('unsettled_action')
        if self.frozen:raise ValueError('learning_frozen')
        buffer=self.model.rollout_buffer;count=buffer.pos
        if count<1:raise ValueError('no_samples')
        before=self.export();before_hash=self.fingerprint();start=time.perf_counter()
        try:
            if not buffer.full:
                for name in ['observations','actions','rewards','returns','episode_starts','values','log_probs','advantages','action_masks']:
                    setattr(buffer,name,getattr(buffer,name)[:count].copy())
                buffer.buffer_size=count;buffer.full=True
            with self.own_rng(),torch.no_grad():
                last=torch.zeros(1) if terminated else self.model.policy.predict_values(torch.as_tensor(next_obs).unsqueeze(0))
                buffer.compute_returns_and_advantage(last,np.array([terminated]))
            with self.own_rng():self.model.train()
            if any(not torch.isfinite(p).all() for p in self.model.policy.parameters()):raise RuntimeError('nonfinite_parameters')
            self.revision+=1
            result={'batch_id':batch_id,'input_revision':expected_revision,'revision':self.revision,'samples':count,'before':before_hash,'after':self.fingerprint(),'milliseconds':(time.perf_counter()-start)*1000}
            self.committed[batch_id]=copy.deepcopy(result)
            self.model.rollout_buffer=self.model.rollout_buffer_class(self.config['n_steps'],self.model.observation_space,self.model.action_space,device='cpu',gamma=self.config['gamma'],gae_lambda=self.config['gae_lambda'],n_envs=1)
            return result
        except Exception:
            self.restore(before);raise
    def export(self):
        return copy.deepcopy({'version':self.VERSION,'config':self.config,'seed':self.seed,'revision':self.revision,'frozen':self.frozen,
            'parameters':self.model.policy.state_dict(),'optimizer':self.model.policy.optimizer.state_dict(),'buffer':self.model.rollout_buffer,
            'rng':self.rng,'consumed':self.consumed,'committed':self.committed,'pending':self.pending,'episode_start':self.episode_start,
            'num_timesteps':self.model.num_timesteps,'n_updates':self.model._n_updates})
    def restore(self,state):
        state=copy.deepcopy(state)
        if state['version']!=self.VERSION or state['config']!=self.config:raise ValueError('checkpoint_version_or_config')
        self.model.policy.load_state_dict(state['parameters']);self.model.policy.optimizer.load_state_dict(state['optimizer'])
        self.model.rollout_buffer=state['buffer'];self.model.num_timesteps=state['num_timesteps'];self.model._n_updates=state['n_updates']
        for key in ['seed','revision','frozen','rng','consumed','committed','pending','episode_start']:setattr(self,key,state[key])
    def freeze(self):
        if self.pending:raise ValueError('unsettled_action')
        self.frozen=True;self.model.rollout_buffer.reset()
