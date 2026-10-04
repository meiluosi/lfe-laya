"""HTTP 状态与完整恢复；不加载模型，使用真实独立 PPO 与 TS 世界。"""
import sys
from pathlib import Path
import threading
import copy
import pytest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'services/ecology'))
from bridge import Bridge
import serve
from fastapi.testclient import TestClient

@pytest.fixture
def client(tmp_path,monkeypatch):
    serve.S.reset()
    monkeypatch.setattr(serve,'checkpoint_root',tmp_path)
    return TestClient(serve.app)

def prepare(client,bridge,run_id,tx='first'):
    requests=bridge.call('observe')
    return client.post('/learning/prepare',json={'run_id':run_id,'transaction_id':tx,'requests':requests,'world':bridge.call('snapshot')})

def test_real_no_laya_http_commit_retry_checkpoint_download_import_restore(client):
    run='http-real-ppo'
    with Bridge() as bridge:
        bridge.call('reset',config={'runId':run,'initialAgents':2,'reproduction':False})
        assert client.post('/learning/create',json={'run_id':run,'seed':1,'mode':'no-laya'}).status_code==200
        response=prepare(client,bridge,run);assert response.status_code==200,response.text
        prepared=response.json();assert prepared['records']==[];assert prepare(client,bridge,run).json()==prepared
        result=bridge.call('step',proposals=prepared['proposals']);assert result['accepted']
        feedback={'run_id':run,'transaction_id':'first','result':result}
        receipt=client.post('/learning/commit',json=feedback);assert receipt.status_code==200,receipt.text
        assert client.post('/learning/commit',json=feedback).json()==receipt.json()
        state=client.post('/learning/checkpoint',json={'run_id':run,'world':result['snapshot']});assert state.status_code==200,state.text
        digest=state.json()['checkpoint_id'];data=client.get('/learning/checkpoint/'+digest).content
        assert client.post('/learning/import',content=data).json()['checkpoint_id']==digest
        restored=client.post('/learning/restore',json={'run_id':'copy','checkpoint_id':digest});assert restored.status_code==200,restored.text
        snapshot=restored.json()['world'];snapshot['config']['runId']=run;assert snapshot==result['snapshot']
        # 同一动作边界，完整 RNG/经验恢复后的提案（除了身份）一致。
        a=prepare(client,bridge,run,'next').json()
        bridge.call('reset',config={'runId':'copy','initialAgents':2});bridge.call('restore',snapshot=restored.json()['world'])
        b=prepare(client,bridge,'copy','copy-next').json()
        assert [p['distribution'] for p in a['proposals']]==[p['distribution'] for p in b['proposals']]
        assert [p['action'] for p in a['proposals']]==[p['action'] for p in b['proposals']]
        assert client.post('/learning/close',json={'run_id':'copy'}).status_code==422
        assert client.post('/learning/abort',json={'run_id':'copy','transaction_id':'copy-next'}).status_code==200
        assert client.post('/learning/close',json={'run_id':'copy'}).status_code==200

def test_cancel_tombstone_prevents_late_prepare_and_world_mismatch(client):
    with Bridge() as bridge:
        bridge.call('reset',config={'runId':'cancel'})
        assert client.post('/learning/abort',json={'run_id':'cancel','transaction_id':'first'}).status_code==200
        client.post('/learning/create',json={'run_id':'cancel','seed':1,'mode':'no-laya'})
        assert prepare(client,bridge,'cancel').status_code==422
        requests=bridge.call('observe');requests[0]['observation']['energy']=10
        response=client.post('/learning/prepare',json={'run_id':'cancel','transaction_id':'next','world':bridge.call('snapshot'),'requests':requests})
        assert response.status_code==422;assert 'world_observation_mismatch' in response.text

def test_horizon_flush_is_atomic_and_retry_does_not_train_twice(client,monkeypatch):
    from learning import IndividualPolicy
    run='horizon-atomic'
    with Bridge() as bridge:
        bridge.call('reset',config={'runId':run,'initialAgents':2,'horizon':5,'reproduction':False})
        client.post('/learning/create',json={'run_id':run,'seed':1,'mode':'no-laya'})
        prepared=prepare(client,bridge,run).json()
        result=bridge.call('step',proposals=prepared['proposals'])
        assert all(o['truncated'] and not o['terminated'] for o in result['outcomes'])
        feedback={'run_id':run,'transaction_id':'first','result':result}
        original=IndividualPolicy.update;calls=[]
        def fail_second(policy,*args,**kwargs):
            calls.append(policy.seed)
            if len(calls)==2: raise RuntimeError('injected_final_update_failure')
            return original(policy,*args,**kwargs)
        with monkeypatch.context() as patch:
            patch.setattr(IndividualPolicy,'update',fail_second)
            response=client.post('/learning/commit',json=feedback)
            assert response.status_code==503,response.text
        r=serve.S.runs[run]
        assert len(calls)==2 and r.policies=={} and r.receipts=={} and r.staged
        assert serve.S.worlds[run]['tick']==0
        response=client.post('/learning/commit',json=feedback)
        assert response.status_code==200,response.text
        receipt=response.json()
        assert len(receipt['updates'])==2 and set(receipt['revisions'].values())=={1}
        assert receipt['bootstrap']['records']==[]
        assert all(q['identity']['tick']==5 for q in receipt['bootstrap']['requests'])
        fingerprints={key:p.fingerprint() for key,p in r.policies.items()}
        assert all(p.model.rollout_buffer.pos==0 for p in r.policies.values())
        assert client.post('/learning/commit',json=feedback).json()==receipt
        assert {key:p.fingerprint() for key,p in r.policies.items()}==fingerprints

def test_late_old_commit_cannot_rewind_newer_world_boundary(client):
    run='late-commit'
    with Bridge() as bridge:
        bridge.call('reset',config={'runId':run,'initialAgents':1,'reproduction':False})
        client.post('/learning/create',json={'run_id':run,'seed':1,'mode':'no-laya'})
        old_feedback=None;old_receipt=None
        for tx in ['first','second']:
            prepared=prepare(client,bridge,run,tx).json()
            result=bridge.call('step',proposals=prepared['proposals'])
            feedback={'run_id':run,'transaction_id':tx,'result':result}
            response=client.post('/learning/commit',json=feedback)
            assert response.status_code==200,response.text
            if tx=='first':old_feedback=feedback;old_receipt=response.json()
        assert client.post('/learning/commit',json=old_feedback).json()==old_receipt
        assert serve.S.worlds[run]['tick']==20
        response=prepare(client,bridge,run,'third')
        assert response.status_code==200,response.text

def test_busy_inference_can_be_cancelled_before_staging(client,monkeypatch):
    entered=threading.Event();release=threading.Event()
    class SlowProvider:
        def predict(self,*args,**kwargs): entered.set();assert release.wait(5);return []
    monkeypatch.setitem(serve.S.runtime,'provider',SlowProvider())
    with Bridge() as bridge:
        bridge.call('reset',config={'runId':'busy'})
        client.post('/learning/create',json={'run_id':'busy','seed':1,'mode':'learning'})
        replies=[]
        t=threading.Thread(target=lambda:replies.append(prepare(client,bridge,'busy')));t.start();assert entered.wait(5)
        abort=threading.Thread(target=lambda:replies.append(client.post('/learning/abort',json={'run_id':'busy','transaction_id':'first'})));abort.start()
        # 等待取消接口写入墓碑，不以 sleep 猜测执行时序。
        for _ in range(10000):
            with serve.S.cancel_lock:
                if ('busy','first') in serve.S.cancelled: break
            threading.Event().wait(.001)
        release.set();t.join(5);abort.join(5)
        assert sorted(r.status_code for r in replies)==[200,422];assert serve.S.runs['busy'].staged is None

def test_busy_lock_waits_then_times_out_and_metrics_are_reported(client,monkeypatch):
    monkeypatch.setattr(serve.S,'lock_wait_seconds',.2)
    assert serve.S.lock.acquire(timeout=1)
    try:
        r=client.post('/learning/create',json={'run_id':'q','seed':1,'mode':'no-laya'})
        assert r.status_code==503 and r.json()['detail']=='service_busy' and r.headers['retry-after']=='1'
    finally: serve.S.lock.release()
    # 释放后同一请求成功：排队语义只在持锁期间等待，不改变结果。
    assert client.post('/learning/create',json={'run_id':'q','seed':1,'mode':'no-laya'}).status_code==200
    health=client.get('/health').json()
    assert health['learning_runs']==1 and health['metrics']['requests']['/learning/create 503']==1
    assert health['metrics']['latency']['/learning/create']['n']==2

def test_checkpoint_storage_is_idempotent_and_stale_temporaries_are_removed(client,tmp_path,monkeypatch):
    (tmp_path/'dead.tmp').write_bytes(b'partial'); keep=tmp_path/('a'*64+'.pt'); keep.write_bytes(b'x')
    serve.remove_stale_temporaries()
    assert not (tmp_path/'dead.tmp').exists() and keep.exists()
    first=serve.store_checkpoint(b'payload'); assert serve.store_checkpoint(b'payload')==first
    assert serve.checkpoint_usage()['files']==2
    monkeypatch.setattr(serve,'CHECKPOINT_DISK_LIMIT',3)
    import pytest
    with pytest.raises(ValueError,match='checkpoint_disk_capacity'): serve.store_checkpoint(b'more bytes')
