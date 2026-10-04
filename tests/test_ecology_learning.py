"""独立学习与事务的无模型验证；合成偏好只用于协议测试。"""
import copy
import json
import sys
from pathlib import Path
import numpy as np
import pytest
import torch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'services/ecology'))
from learning import IndividualPolicy, TimedBuffer, features, action_mask, OBS_SIZE
from runtime import LearningRuntime
import checkpoint
from services.ecology.bridge import Bridge

def test_record(r):
    return {'proposal':{'identity':copy.deepcopy(r['identity']),'action':'rest','provider':'laya','distribution':{c['id']:1/len(r['candidates']) for c in r['candidates']}}}
test_record.__test__=False

def drive(bridge,runtime,count=1):
    rows=[]
    for _ in range(count):
        requests=bridge.call('observe');records=[] if runtime.no_laya else [test_record(r) for r in requests]
        tx=f"tx-{requests[0]['identity']['tick']}";prepared=runtime.prepare(tx,requests,records)
        result=bridge.call('step',proposals=prepared['proposals']);receipt=runtime.commit(tx,result)
        rows.append((prepared,result,receipt))
    return rows

def test_features_local_only_and_residual_prior_keeps_equal_parameter_budget():
    with Bridge() as bridge:
        request=bridge.call('reset',config={'initialAgents':1})['requests'][0]
        prior={c['id']:(.8 if c['id']=='rest' else .2/(len(request['candidates'])-1)) for c in request['candidates']}
        obs=features(request,prior);assert obs.shape==(OBS_SIZE,)
        altered=copy.deepcopy(request);altered['identity']['runId']='hidden-change';altered['observation']['globalSchedule']='B'
        assert np.array_equal(obs,features(altered,prior))
        a=IndividualPolicy(7);b=IndividualPolicy(7,{'fusion':'residual'})
        assert sum(p.numel() for p in a.model.policy.parameters())==sum(p.numel() for p in b.model.policy.parameters())
        probs=b.distribution(obs,action_mask(request));assert probs[5]>.75

def test_timed_discount_matches_two_step_reward_and_bootstrap():
    p=IndividualPolicy(1,{'n_steps':2,'batch_size':2});b=p.model.rollout_buffer
    b.pos=2;b.full=True;b.rewards[:,0]=[1,2];b.values[:,0]=[.3,.4];b.episode_starts[:,0]=[1,0];b.durations[:,0]=[2,5]
    b.compute_returns_and_advantage(torch.tensor([.7]),np.array([False]))
    gamma=p.config['gamma'];lam=p.config['gae_lambda']
    last=2+gamma**5*.7-.4;first=1+gamma**2*.4-.3+(gamma*lam)**2*last
    assert np.allclose(b.advantages[:,0],[first,last])

def test_real_feedback_changes_policy_and_keeps_other_individual_isolated():
    with Bridge() as bridge:
        bridge.call('reset',config={'initialAgents':2,'reproduction':False,'runId':'learning-test'})
        runtime=LearningRuntime('learning-test',23,{'n_steps':4,'batch_size':4},no_laya=True)
        rows=drive(bridge,runtime,5)
        assert all(r[1]['accepted'] for r in rows)
        assert len(rows[-1][0]['updates'])==2
        assert all(u['before']!=u['after'] for u in rows[-1][0]['updates'])
        assert all(u['probe']['maxDelta']>0 for u in rows[-1][0]['updates'])
        a,b=runtime.policies.values();before=b.fingerprint()
        with torch.no_grad():next(a.model.policy.parameters()).add_(1)
        assert b.fingerprint()==before
        assert a.model.rollout_buffer is not b.model.rollout_buffer
        assert a.model.policy.optimizer is not b.model.policy.optimizer

def test_prepare_abort_pause_and_duplicate_commit_are_transactional():
    with Bridge() as bridge:
        bridge.call('reset',config={'initialAgents':2,'reproduction':False,'runId':'tx'})
        runtime=LearningRuntime('tx',1,{'n_steps':2,'batch_size':2},no_laya=True)
        drive(bridge,runtime,2);before={k:p.fingerprint() for k,p in runtime.policies.items()}
        requests=bridge.call('observe');prepared=runtime.prepare('will-abort',requests,[])
        assert len(prepared['updates'])==2
        assert {k:p.fingerprint() for k,p in runtime.policies.items()}==before
        assert runtime.prepare('will-abort',requests,[])==prepared
        with pytest.raises(ValueError):runtime.export()
        runtime.abort('will-abort');assert {k:p.fingerprint() for k,p in runtime.policies.items()}==before
        prepared2=runtime.prepare('will-commit',requests,[]);assert prepared2['proposals']==prepared['proposals']
        result=bridge.call('step',proposals=prepared2['proposals'])
        broken=copy.deepcopy(result);broken['outcomes'][1]['reward']=float('nan')
        with pytest.raises(ValueError):runtime.commit('will-commit',broken)
        assert {k:p.fingerprint() for k,p in runtime.policies.items()}==before
        receipt=runtime.commit('will-commit',result);assert runtime.commit('will-commit',result)==receipt
        changed=copy.deepcopy(result);changed['afterHash']='fake'
        with pytest.raises(ValueError):runtime.commit('will-commit',changed)

def test_safe_checkpoint_restores_optimizer_buffer_and_rng_for_identical_continuation():
    with Bridge() as bridge:
        bridge.call('reset',config={'initialAgents':2,'reproduction':False,'runId':'resume'})
        runtime=LearningRuntime('resume',6,{'n_steps':4,'batch_size':4},no_laya=True);drive(bridge,runtime,3)
        state=checkpoint.loads(checkpoint.dumps({'world':bridge.call('snapshot'),'learning':runtime.export()}))
        a=LearningRuntime.from_state(state['learning']);b=LearningRuntime.from_state(state['learning'])
        requests=bridge.call('observe');pa=a.prepare('a',requests,[]);pb=b.prepare('b',requests,[])
        assert pa['proposals']==pb['proposals']
        result=bridge.call('step',proposals=pa['proposals']);a.commit('a',result);b.commit('b',result)
        requests=bridge.call('observe');pa=a.prepare('a2',requests,[]);pb=b.prepare('b2',requests,[])
        assert pa['proposals']==pb['proposals']
        assert [u['after'] for u in pa['updates']]==[u['after'] for u in pb['updates']]
        a.abort('a2');b.abort('b2');a.policies['life-0'].set_frozen(True)
        assert not b.policies['life-0'].frozen

def test_frozen_evaluation_does_not_modify_weights_optimizer_or_revision():
    with Bridge() as bridge:
        bridge.call('reset',config={'initialAgents':1,'reproduction':False,'runId':'frozen'})
        runtime=LearningRuntime('frozen',9,{'n_steps':2,'batch_size':2},no_laya=True);drive(bridge,runtime,3)
        runtime.set_frozen(True);policy=runtime.policies['life-0'];before=policy.export();drive(bridge,runtime,5);after=runtime.policies['life-0'].export()
        assert before['revision']==after['revision']
        assert before['num_timesteps']==after['num_timesteps']
        assert before['n_updates']==after['n_updates']
        assert all(torch.equal(v,after['parameters'][k]) for k,v in before['parameters'].items())
        for key,state in before['optimizer']['state'].items():
            for name,value in state.items():assert torch.equal(value,after['optimizer']['state'][key][name]) if isinstance(value,torch.Tensor) else value==after['optimizer']['state'][key][name]
        assert after['buffer']['pos']==0

def test_terminal_flush_and_truncation_bootstrap_are_distinct():
    with Bridge() as bridge:
        bridge.call('reset',config={'initialAgents':1,'reproduction':False,'runId':'terminal','maxAge':1})
        runtime=LearningRuntime('terminal',2,no_laya=True);rows=drive(bridge,runtime)
        assert rows[0][1]['outcomes'][0]['terminated'];assert not runtime.policies
        assert runtime.retired['life-0']['revision']==1
        assert runtime.retired['life-0']['buffer']['pos']==0
        bridge.call('reset',config={'initialAgents':1,'reproduction':False,'runId':'truncated','horizon':5})
        runtime=LearningRuntime('truncated',2,no_laya=True);rows=drive(bridge,runtime)
        assert rows[0][1]['outcomes'][0]['truncated'];assert runtime.policies['life-0'].revision==0
        updates=runtime.finish(bridge.call('inspect'),[]);assert len(updates)==1;assert runtime.policies['life-0'].revision==1

def test_newborn_starts_with_fresh_policy_without_parent_experience():
    with Bridge() as bridge:
        bridge.call('reset',config={'initialAgents':2,'initialEnergy':40,'birthCooldown':1,'runId':'birth-learning','mutation':False})
        runtime=LearningRuntime('birth-learning',51,{'n_steps':2,'batch_size':2},no_laya=True)
        found=False
        for i in range(50):
            drive(bridge,runtime)
            requests=bridge.call('observe');new=[r for r in requests if r['identity']['agentId'] not in runtime.policies]
            if not new:continue
            from runtime import stable_seed
            prepared=runtime.prepare('newborn',requests,[])
            for r in new:
                key=r['identity']['agentId'];p=runtime.staged['working'][key]
                fresh=IndividualPolicy(stable_seed(51,key),runtime.config)
                assert p.revision==0;assert p.fingerprint()==fresh.fingerprint();assert p.model.rollout_buffer.pos==0
                assert p.model.policy.optimizer.state_dict()['state']=={}
            runtime.abort('newborn');found=True;break
        assert found
