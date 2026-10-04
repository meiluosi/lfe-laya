"""独立、可恢复的个体 PPO；仅处理自身许可观测与实际反馈。"""
import copy
import hashlib
import json
import math
import random
import time
from contextlib import contextmanager
import gymnasium as gym
import numpy as np
import torch
from sb3_contrib import MaskablePPO
from sb3_contrib.common.maskable.policies import MaskableActorCriticPolicy
from sb3_contrib.common.maskable.buffers import MaskableRolloutBuffer
from stable_baselines3.common.logger import configure

ACTIONS = ('north', 'east', 'south', 'west', 'eat', 'rest', 'reproduce')
OBS_SIZE = 324
ENCODING = 'ecology-grid9-memory8-v1'
DEFAULT_LEARNING = dict(learning_rate=.001, n_steps=32, batch_size=16, n_epochs=4,
    gamma=.998, gae_lambda=.995, clip_range=.2, ent_coef=.01, vf_coef=.5,
    max_grad_norm=.5, normalize_advantage=False, network={'pi':[32], 'vf':[32]},
    fusion='features', residual_scale=2., prior_floor=.02)


def features(request, prior=None, use_memory=True):
    o = request['observation'] if use_memory else {**request['observation'],'memory':[]}
    if len(o['memory']) > 8 or len(o['neighbors']) > 8: raise ValueError('learning_observation_budget')
    origin = min((c for c in o['local'] if not c['blocked']), key=lambda c: c['dx']**2+c['dy']**2)
    grid = np.zeros((9, 9, 3), np.float32)
    for cell in o['local']:
        x, y = round(cell['dx']-origin['dx'])+4, round(cell['dy']-origin['dy'])+4
        if not (0 <= x < 9 and 0 <= y < 9): raise ValueError('learning_perception_range')
        grid[y,x] = [min(cell['food']/20,1), float(cell['blocked']), 1.]
    own = [o['energy']/o['capacity'], min(o['age']/3600,1), o['traits']['size']/1.2,
        o['traits']['speed']/1.25, o['traits']['perception']/4, o['traits']['metabolism']/1.2,
        math.sin(o['heading']), math.cos(o['heading']), float(o['lastRejected']),
        origin['dx']*2, origin['dy']*2] + [float(o['lastAction']==a) for a in ACTIONS]
    memories = []
    for m in o['memory']: memories.extend([np.clip(m['dx']/64,-1,1),np.clip(m['dy']/64,-1,1),min(m['food']/20,1),min(m['stepsAgo']/300,1)])
    memories += [0.]*(4*(8-len(o['memory'])))
    neighbors = []
    for n in o['neighbors']: neighbors.extend([n['dx']/4,n['dy']/4,n['shape']/2])
    neighbors += [0.]*(3*(8-len(o['neighbors'])))
    data = np.asarray([*grid.flatten(),*own,*memories,*neighbors,*[float((prior or {}).get(a,0)) for a in ACTIONS]],np.float32)
    if data.shape!=(OBS_SIZE,) or not np.isfinite(data).all() or (np.abs(data)>1.000001).any(): raise ValueError('invalid_learning_features')
    return data


def action_mask(request):
    return np.asarray([a in {c['id'] for c in request['candidates']} for a in ACTIONS],dtype=bool)


class SpaceOnlyEnv(gym.Env):
    observation_space=gym.spaces.Box(-1,1,(OBS_SIZE,),np.float32)
    action_space=gym.spaces.Discrete(7)
    def reset(self,**kwargs): raise RuntimeError('World is owned by TypeScript')
    def step(self,action): raise RuntimeError('World is owned by TypeScript')


class TimedBuffer(MaskableRolloutBuffer):
    """每个样本是一段模拟时间；折扣与 GAE 按真实子步长度计算。"""
    def reset(self):
        super().reset(); self.durations=np.zeros((self.buffer_size, self.n_envs),np.int32)
    def compute_returns_and_advantage(self,last_values,dones):
        last_values=last_values.clone().cpu().numpy().flatten(); advantage=0
        for step in reversed(range(self.buffer_size)):
            if step==self.buffer_size-1: nonterminal=1.-dones; next_values=last_values
            else: nonterminal=1.-self.episode_starts[step+1]; next_values=self.values[step+1]
            duration=self.durations[step]
            delta=self.rewards[step] + self.gamma**duration*next_values*nonterminal-self.values[step]
            advantage=delta+(self.gamma*self.gae_lambda)**duration*nonterminal*advantage
            self.advantages[step]=advantage
        self.returns=self.advantages+self.values


class FusionPolicy(MaskableActorCriticPolicy):
    def __init__(self,*args,fusion='features',residual_scale=2.,prior_floor=.02,**kwargs):
        self.fusion=fusion; self.residual_scale=residual_scale; self.prior_floor=prior_floor
        super().__init__(*args,**kwargs)
        if not self.share_features_extractor: raise ValueError('unsupported_extractor')
    def distribution(self,obs,latent,mask):
        logits=self.action_net(latent)
        if self.fusion=='residual':
            prior=obs[:,-7:]
            prior=torch.where(prior.sum(dim=-1,keepdim=True)>0,prior,torch.ones_like(prior)/7)
            logits=torch.log(prior.clamp(min=self.prior_floor))+self.residual_scale*torch.tanh(logits)
        dist=self.action_dist.proba_distribution(action_logits=logits)
        if mask is not None: dist.apply_masking(mask)
        return dist
    def get_distribution(self,obs,action_masks=None):
        latent=self.mlp_extractor.forward_actor(self.extract_features(obs))
        return self.distribution(obs,latent,action_masks)
    def forward(self,obs,deterministic=False,action_masks=None):
        pi,vf=self.mlp_extractor(self.extract_features(obs))
        dist=self.distribution(obs,pi,action_masks); action=dist.get_actions(deterministic=deterministic)
        return action.reshape((-1,*self.action_space.shape)),self.value_net(vf),dist.log_prob(action)
    def evaluate_actions(self,obs,actions,action_masks=None):
        pi,vf=self.mlp_extractor(self.extract_features(obs)); dist=self.distribution(obs,pi,action_masks)
        return self.value_net(vf),dist.log_prob(actions),dist.entropy()


BUFFER_ARRAYS=('observations','actions','rewards','returns','episode_starts','values','log_probs','advantages','action_masks','durations')

class IndividualPolicy:
    VERSION='ecology-individual-ppo-v1'
    def __init__(self,seed,config=None):
        self.config=copy.deepcopy({**DEFAULT_LEARNING,**(config or {})}); self.seed=int(seed)
        if self.config['fusion'] not in ('features','residual') or self.config['n_steps']<2 or self.config['n_steps']>1024: raise ValueError('learning_config')
        self.revision=0; self.frozen=False; self.pending=None; self.last_tick=-1; self.last_settled=None; self.updates={}; self.episode_start=True
        ambient=(random.getstate(),np.random.get_state(),torch.get_rng_state())
        try:
            kw={k:self.config[k] for k in ('learning_rate','n_steps','batch_size','n_epochs','gamma','gae_lambda','clip_range','ent_coef','vf_coef','max_grad_norm','normalize_advantage')}
            self.model=MaskablePPO(FusionPolicy,SpaceOnlyEnv(),device='cpu',seed=self.seed,rollout_buffer_class=TimedBuffer,
                policy_kwargs={k:self.config[k] for k in ('fusion','residual_scale','prior_floor')}|{'net_arch':self.config['network']},**kw)
            self.rng=(random.getstate(),np.random.get_state(),torch.get_rng_state())
        finally: random.setstate(ambient[0]);np.random.set_state(ambient[1]);torch.set_rng_state(ambient[2])
        self.model.set_logger(configure(folder=None,format_strings=[]))
    @contextmanager
    def own_rng(self):
        ambient=(random.getstate(),np.random.get_state(),torch.get_rng_state())
        random.setstate(self.rng[0]);np.random.set_state(self.rng[1]);torch.set_rng_state(self.rng[2])
        try: yield
        finally:
            self.rng=(random.getstate(),np.random.get_state(),torch.get_rng_state())
            random.setstate(ambient[0]);np.random.set_state(ambient[1]);torch.set_rng_state(ambient[2])
    def reset_exploration(self,seed):
        if self.pending: raise ValueError('unsettled_action')
        # 相同评估种子提供相同采样随机流，不重置参数或优化器。
        py=random.Random(seed); np_rng=np.random.RandomState(seed); generator=torch.Generator().manual_seed(seed)
        self.rng=(py.getstate(),np_rng.get_state(),generator.get_state())
    def fingerprint(self):
        digest=hashlib.sha256()
        for key,value in sorted(self.model.policy.state_dict().items()): digest.update(key.encode());digest.update(value.cpu().numpy().tobytes())
        return digest.hexdigest()
    def distribution(self,obs,mask):
        with torch.no_grad(): return self.model.policy.get_distribution(torch.as_tensor(obs).unsqueeze(0),action_masks=mask).distribution.probs[0].cpu().numpy().copy()
    def act(self,request,obs,mask,provider):
        key=json.dumps(request['identity'],sort_keys=True)
        if self.pending:
            if self.pending['key']==key: return copy.deepcopy(self.pending['proposal'])
            raise ValueError('unsettled_action')
        if request['identity']['tick']<=self.last_tick: raise ValueError('stale_decision_tick')
        with self.own_rng(),torch.no_grad():
            tensor=torch.as_tensor(obs).unsqueeze(0); self.model.policy.set_training_mode(False)
            dist=self.model.policy.get_distribution(tensor,action_masks=mask); action=dist.get_actions(deterministic=False)
            value=self.model.policy.predict_values(tensor); log_prob=dist.log_prob(action); probs=dist.distribution.probs[0].cpu().numpy()
        choice=int(action.item())
        proposal={'identity':copy.deepcopy(request['identity']),'action':ACTIONS[choice],'provider':provider,'revision':self.revision,'distribution':{a:float(probs[i]) for i,a in enumerate(ACTIONS) if mask[i]}}
        self.pending={'key':key,'proposal':copy.deepcopy(proposal),'obs':obs.copy(),'mask':mask.copy(),'action':choice,'value':value.clone(),'log_prob':log_prob.clone(),'decision_ticks':request['observation']['costs']['decisionTicks']}
        return proposal
    def settle(self,proposal,outcome):
        key=json.dumps(proposal['identity'],sort_keys=True)
        if key==self.last_settled: return {'duplicate':True}
        p=self.pending
        if not p or p['key']!=key or proposal!=p['proposal'] or outcome['action']!=proposal['action'] or outcome['agentId']!=proposal['identity']['agentId']: raise ValueError('feedback_mismatch')
        duration=outcome['endTick']-outcome['startTick']; rewards=outcome['rewards']
        if duration<1 or duration>p.get('decision_ticks',100) or duration!=len(rewards) or not all(math.isfinite(r) for r in rewards) or not math.isfinite(outcome['reward']) or abs(sum(rewards)-outcome['reward'])>1e-6: raise ValueError('invalid_feedback_reward')
        if outcome['startTick']!=proposal['identity']['tick'] or (outcome['terminated'] and outcome['truncated']): raise ValueError('invalid_feedback_time')
        buffer=self.model.rollout_buffer
        if not self.frozen:
            if buffer.full: raise ValueError('update_required')
            reward=sum(self.config['gamma']**i*r for i,r in enumerate(rewards)); position=buffer.pos
            buffer.add(p['obs'],np.array([p['action']]),np.array([reward]),np.array([self.episode_start]),p['value'],p['log_prob'],action_masks=p['mask'])
            buffer.durations[position]=duration
        if not self.frozen: self.model.num_timesteps+=duration
        self.last_tick=proposal['identity']['tick']; self.last_settled=key; self.pending=None
        self.episode_start=bool(outcome['terminated']); return {'duplicate':False,'samples':buffer.pos}
    def update(self,next_obs,terminated,batch_id,expected_revision):
        if batch_id in self.updates: return copy.deepcopy(self.updates[batch_id])
        if self.frozen or self.pending or expected_revision!=self.revision: raise ValueError('frozen_pending_or_stale_update')
        buffer=self.model.rollout_buffer; count=buffer.pos
        if not count: raise ValueError('empty_update')
        before=self.export(); before_hash=self.fingerprint(); started=time.perf_counter()
        probe_obs=buffer.observations[count-1,0].copy();probe_mask=buffer.action_masks[count-1,0].astype(bool).copy()
        probe_before=self.distribution(probe_obs,probe_mask)
        try:
            if not buffer.full:
                for key in BUFFER_ARRAYS: setattr(buffer,key,getattr(buffer,key)[:count].copy())
                buffer.buffer_size=count;buffer.full=True
            with torch.no_grad():
                value=torch.zeros(1) if terminated else self.model.policy.predict_values(torch.as_tensor(next_obs).unsqueeze(0))
                buffer.compute_returns_and_advantage(value,np.array([terminated]))
            with self.own_rng(): self.model.train()
            if any(not torch.isfinite(p).all() for p in self.model.policy.parameters()): raise RuntimeError('nonfinite_policy')
            self.revision+=1
            result={'batch_id':batch_id,'input_revision':expected_revision,'revision':self.revision,'samples':count,'before':before_hash,'after':self.fingerprint(),'milliseconds':(time.perf_counter()-started)*1000}
            probe_after=self.distribution(probe_obs,probe_mask)
            result['probe']={'features':probe_obs.tolist(),'mask':probe_mask.tolist(),'before':probe_before.tolist(),'after':probe_after.tolist(),'maxDelta':float(np.max(np.abs(probe_after-probe_before)))}
            self.updates[batch_id]=result
            # 旧更新 ID 不再可能匹配当前 revision；保留最近 64 条回执用于重试。
            while len(self.updates)>64: del self.updates[next(iter(self.updates))]
            self.model.rollout_buffer=TimedBuffer(self.config['n_steps'],self.model.observation_space,self.model.action_space,device='cpu',gamma=self.config['gamma'],gae_lambda=self.config['gae_lambda'],n_envs=1)
            return copy.deepcopy(result)
        except Exception: self.restore(before);raise
    def set_frozen(self,frozen=True):
        if self.pending: raise ValueError('unsettled_action')
        if self.frozen!=frozen: self.model.rollout_buffer.reset()
        self.frozen=bool(frozen)
    def export(self):
        buffer=self.model.rollout_buffer
        return copy.deepcopy({'version':self.VERSION,'encoding':ENCODING,'config':self.config,'seed':self.seed,'revision':self.revision,'frozen':self.frozen,
            'parameters':self.model.policy.state_dict(),'optimizer':self.model.policy.optimizer.state_dict(),
            'buffer':{'arrays':{k:getattr(buffer,k).copy() for k in BUFFER_ARRAYS},'size':buffer.buffer_size,'pos':buffer.pos,'full':buffer.full,'generator_ready':buffer.generator_ready},
            'rng':self.rng,'pending':self.pending,'last_tick':self.last_tick,'last_settled':self.last_settled,'updates':self.updates,'episode_start':self.episode_start,
            'num_timesteps':self.model.num_timesteps,'n_updates':self.model._n_updates})
    def restore(self,state):
        state=copy.deepcopy(state)
        if state['version']!=self.VERSION or state['encoding']!=ENCODING or state['config']!=self.config: raise ValueError('checkpoint_version_or_config')
        self.model.policy.load_state_dict(state['parameters']);self.model.policy.optimizer.load_state_dict(state['optimizer'])
        raw=state['buffer']; buffer=TimedBuffer(raw['size'],self.model.observation_space,self.model.action_space,device='cpu',gamma=self.config['gamma'],gae_lambda=self.config['gae_lambda'],n_envs=1)
        for key,value in raw['arrays'].items(): setattr(buffer,key,value)
        for key in ('pos','full','generator_ready'): setattr(buffer,key,raw[key])
        self.model.rollout_buffer=buffer;self.model.num_timesteps=state['num_timesteps'];self.model._n_updates=state['n_updates']
        for key in ('seed','revision','frozen','rng','pending','last_tick','last_settled','updates','episode_start'): setattr(self,key,state[key])
    @classmethod
    def from_state(cls,state):
        policy=cls(state['seed'],state['config']);policy.restore(state);return policy
