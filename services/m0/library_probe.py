"""开发集上的库适配验证，不使用真实 Laya，不报告主路线学习收益。"""
import json,time,copy,hashlib
import torch
import numpy as np
from sb3_contrib import MaskablePPO
from gym_env import ForagingEnv,mask
from bridge import ROOT

def digest(state):
    h=hashlib.sha256()
    for name,value in sorted(state.items()):h.update(name.encode());h.update(value.cpu().numpy().tobytes())
    return h.hexdigest()

if __name__=='__main__':
    torch.set_num_threads(2)
    out=ROOT/'experiments/m0/evidence/library-probe';out.mkdir(exist_ok=True)
    env=ForagingEnv({'horizon':96,'phaseSteps':32})
    try:
        model=MaskablePPO('MlpPolicy',env,seed=71,device='cpu',n_steps=32,batch_size=16,n_epochs=2,
                          policy_kwargs={'net_arch':dict(pi=[32],vf=[32])},verbose=0)
        before=digest(model.policy.state_dict());start=time.perf_counter();model.learn(512);duration=time.perf_counter()-start
        after=digest(model.policy.state_dict());obs,_=env.reset(seed=72)
        with torch.no_grad():probs=model.policy.get_distribution(torch.as_tensor(obs).unsqueeze(0),action_masks=env.action_masks()).distribution.probs
        model.save(out/'sb3-policy')
        restored=MaskablePPO.load(out/'sb3-policy',env=env,device='cpu')
        with torch.no_grad():again=restored.policy.get_distribution(torch.as_tensor(obs).unsqueeze(0),action_masks=env.action_masks()).distribution.probs
        assert before!=after and torch.equal(probs,again)
        assert float(probs[0,~torch.as_tensor(env.action_masks())].sum())==0.
        report={'purpose':'library integration on development seeds; no Laya', 'sb3':{'steps':512,'seconds':duration,'parameters':sum(p.numel() for p in model.policy.parameters()),'changed':before!=after,'reload_distribution_equal':torch.equal(probs,again),'mask_zero':True,'bridge_calls':env.bridge.calls,'bridge_seconds':env.bridge.elapsed}}
        # TorchRL 的单步有掩码 actor-critic 损失兼容性，只作组件对比。
        from tensordict import TensorDict
        from tensordict.nn import TensorDictModule
        from torchrl.modules import ProbabilisticActor,MaskedCategorical,ValueOperator
        from torchrl.objectives import A2CLoss
        actor=ProbabilisticActor(TensorDictModule(torch.nn.Linear(66,6),in_keys=['observation'],out_keys=['logits']),
            in_keys={'logits':'logits','mask':'mask'},distribution_class=MaskedCategorical,return_log_prob=True)
        critic=ValueOperator(torch.nn.Linear(66,1),in_keys=['observation'])
        loss=A2CLoss(actor,critic,entropy_coeff=.01)
        td=TensorDict({'observation':torch.as_tensor(np.stack([obs]*4)),
            'mask':torch.as_tensor(np.stack([env.action_masks()]*4)),
            'advantage':torch.ones(4,1),'value_target':torch.zeros(4,1)},batch_size=[4])
        with torch.no_grad():actor(td)
        losses=loss(td);total=sum(v for k,v in losses.items() if k.startswith('loss_'));total.backward()
        report['torchrl']={'masked_a2c_loss_finite':bool(torch.isfinite(total)), 'gradient_available':any(p.grad is not None for p in loss.parameters()),'probe_only':True}
        (out/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
    finally:env.close()
