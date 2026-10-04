import sys,copy,json
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'services/m0'))
from bridge import Bridge
from laya_provider import encode
from gym_env import ForagingEnv,features,mask

def test_input_whitelist_and_candidate_mapping():
    with Bridge() as b:
        r=b.call('reset',config={'seed':7})
        state,q,mapping=encode(r)
        assert 'runId' not in json.dumps(state) and 'phaseSteps' not in json.dumps(state)
        r['observation']['global']=1
        import pytest
        with pytest.raises(ValueError):encode(r)
        del r['observation']['global'];r['candidates'].reverse()
        _,_,new=encode(r);assert list(new.values())==list(mapping.values())[::-1]

def test_bridge_snapshot_replay_and_cost():
    with Bridge() as b:
        r=b.call('reset',config={'seed':8,'runId':'bridge'})
        snap=b.call('snapshot');results=[]
        for _ in range(5):
            results.append(b.call('step',proposal={'identity':r['identity'],'provider':'test-rule','action':'rest'}));r=b.call('observe')
        end=b.call('snapshot');b.call('restore',snapshot=snap)
        for _ in range(5):
            r=b.call('observe');b.call('step',proposal={'identity':r['identity'],'provider':'test-rule','action':'rest'})
        assert b.call('snapshot')==end
        assert all(t['accepted'] for t in results)

def test_gym_checks_and_masks():
    from gymnasium.utils.env_checker import check_env
    from stable_baselines3.common.env_checker import check_env as sb3_check
    env=ForagingEnv()
    try:
        check_env(env,skip_render_check=True);sb3_check(env,warn=True)
        obs,_=env.reset(seed=1)
        assert env.observation_space.contains(obs)
        before=env.bridge.call('snapshot')
        if not mask(env.request)[4]:
            _,reward,terminated,truncated,info=env.step(4)
            assert info['executed'] is False and reward==0
            assert env.bridge.call('snapshot')==before
    finally:env.close()

def equal_tree(a,b):
    import torch
    if isinstance(a,torch.Tensor):return torch.equal(a,b)
    if isinstance(a,np.ndarray):return np.array_equal(a,b)
    if isinstance(a,dict):return a.keys()==b.keys() and all(equal_tree(a[k],b[k]) for k in a)
    if isinstance(a,(tuple,list)):return len(a)==len(b) and all(equal_tree(x,y) for x,y in zip(a,b))
    return a==b

def test_individual_update_isolation_duplicate_and_restore():
    import torch,pytest
    from policy import PolicySession
    torch.set_num_threads(2)
    a=PolicySession(12);b=PolicySession(13)
    original_b=b.export();ambient=torch.get_rng_state().clone()
    with Bridge() as bridge:
        r=bridge.call('reset',config={'seed':9,'runId':'isolation'})
        for _ in range(8):
            obs=features(r);decision=a.act(r,obs,mask(r))
            assert decision==a.act(r,obs,mask(r))
            tr=bridge.call('step',proposal=decision);a.settle(tr);assert a.settle(tr)['duplicate']
            r=bridge.call('observe')
        checkpoint=a.export();world=bridge.call('snapshot');obs=features(r)
        result=a.update(obs,False,'batch-1',0)
        assert result['before']!=result['after'] and a.revision==1
        assert a.update(obs,False,'batch-1',0)==result
        with pytest.raises(ValueError):a.update(obs,False,'old',0)
        assert equal_tree(original_b['parameters'],b.export()['parameters'])
        assert equal_tree(original_b['optimizer'],b.export()['optimizer'])
        assert equal_tree(original_b['rng'],b.export()['rng'])
        assert equal_tree(original_b['buffer'].__dict__,b.export()['buffer'].__dict__)
        assert torch.equal(ambient,torch.get_rng_state())
        restored=PolicySession(12);restored.restore(checkpoint)
        repeated=restored.update(obs,False,'batch-1',0)
        assert repeated['after']==result['after']
        assert equal_tree(restored.export()['optimizer'],a.export()['optimizer'])
        assert restored.act(r,obs,mask(r))==a.act(r,obs,mask(r))
        # 重新恢复到结算边界后冻结，动作与记忆可继续但参数及优化器不变。
        restored.restore(checkpoint);restored.freeze();frozen=restored.export()
        decision=restored.act(r,obs,mask(r));tr=bridge.call('step',proposal=decision);restored.settle(tr)
        assert equal_tree(frozen['parameters'],restored.export()['parameters'])
        assert equal_tree(frozen['optimizer'],restored.export()['optimizer'])
        with pytest.raises(ValueError):restored.update(obs,False,'frozen',restored.revision)

def test_invalid_numeric_observation_rejected_before_model():
    import pytest
    with Bridge() as b:
        r=b.call('reset')
        for value in [float('nan'),float('inf'),-1]:
            bad=copy.deepcopy(r);bad['observation']['energy']=value
            with pytest.raises(ValueError):encode(bad)
        bad=copy.deepcopy(r);bad['observation']['local'][0]['dx']=100
        with pytest.raises(ValueError):encode(bad)

def test_service_failure_and_explicit_retry_protocol_only():
    from fastapi.testclient import TestClient
    import serve
    class FailingProvider:
        def predict(self,*args,**kw):raise RuntimeError('synthetic-provider-failure')
        def metadata(self):return {'provider':'synthetic-test-only'}
    saved=dict(serve.runtime)
    try:
        serve.runtime.update(status='ready',provider=FailingProvider(),last_error=None)
        client=TestClient(serve.app)
        with Bridge() as b:
            r=b.call('reset')
            response=client.post('/decide',json={'requests':[r]})
            assert response.status_code==503
            assert client.get('/health').json()['last_error']=='synthetic-provider-failure'
            bad=copy.deepcopy(r);bad['observation']['global_map']=[]
            assert client.post('/decide',json={'requests':[bad]}).status_code==422
            assert b.call('snapshot')['tick']==0
            retried=b.call('retry');assert retried['identity']['attemptId']!=r['identity']['attemptId']
    finally:serve.runtime.clear();serve.runtime.update(saved)

def test_failed_update_rolls_back_parameters_optimizer_buffer_and_rng():
    import pytest,torch
    from policy import PolicySession
    a=PolicySession(15)
    with Bridge() as bridge:
        r=bridge.call('reset',config={'seed':4})
        d=a.act(r,features(r),mask(r));a.settle(bridge.call('step',proposal=d));r=bridge.call('observe')
        before=a.export();original=a.model.train
        def fail():
            with torch.no_grad():next(a.model.policy.parameters()).add_(1)
            raise RuntimeError('injected-training-failure')
        a.model.train=fail
        with pytest.raises(RuntimeError):a.update(features(r),False,'failure',0)
        a.model.train=original;after=a.export()
        for key in ['parameters','optimizer','rng','revision','consumed','committed']:
            assert equal_tree(before[key],after[key])
        assert equal_tree(before['buffer'].__dict__,after['buffer'].__dict__)


def test_gym_truncation_has_final_observation_not_previous_one():
    env=ForagingEnv({'horizon':1})
    try:
        initial,_=env.reset(seed=1)
        final,_,terminated,truncated,info=env.step(5)
        assert truncated and not terminated
        assert final[0]<initial[0] and final[1]>initial[1]
    finally:env.close()
