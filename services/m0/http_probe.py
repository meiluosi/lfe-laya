"""真实 loopback HTTP 服务检查；临时服务结束后关闭，不修改系统网络。"""
import concurrent.futures, json, os, socket, subprocess, sys, time
from urllib.request import Request, build_opener, ProxyHandler
from urllib.error import HTTPError, URLError
from contextlib import contextmanager
from bridge import ROOT,Bridge
local_http=build_opener(ProxyHandler({}))

def call(port,path,payload=None):
    req=Request(f'http://127.0.0.1:{port}{path}',data=None if payload is None else json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
    try:
        with local_http.open(req,timeout=90) as response:return {'status':response.status,'body':json.load(response)}
    except HTTPError as e:
        raw=e.read().decode('utf-8',errors='replace')
        try:body=json.loads(raw)
        except json.JSONDecodeError:body=raw[:1000]
        return {'status':e.code,'body':body,'retry_after':e.headers.get('Retry-After')}

@contextmanager
def service(port,missing=False):
    with socket.socket() as sock:sock.bind(('127.0.0.1',port))
    env={**os.environ,'USE_TF':'0','HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1'}
    if missing:env['M0_MODEL_MANIFEST']='experiments/m0/intentionally-missing-manifest.json'
    with (ROOT/f'experiments/m0/evidence/http-{port}.log').open('w') as log:
        proc=subprocess.Popen([sys.executable,'-m','uvicorn','serve:app','--app-dir','services/m0','--host','127.0.0.1','--port',str(port)],cwd=ROOT,env=env,stdout=log,stderr=log)
        try:
            deadline=time.monotonic()+180
            while time.monotonic()<deadline:
                if proc.poll() is not None:raise RuntimeError('service exited; inspect log')
                try:
                    health=call(port,'/health')
                    break
                except (URLError,ConnectionError):time.sleep(.2)
            else:raise TimeoutError('service readiness')
            yield health
        finally:
            proc.terminate()
            try:proc.wait(timeout=10)
            except subprocess.TimeoutExpired:proc.kill();proc.wait()

if __name__=='__main__':
    result={}
    with service(8766,True) as health:
        assert health['body']['status']=='failed'
        failed=call(8766,'/decide',{'requests':[{}]})
        assert failed['status']==503
        result['missing_model']={'health':health,'decision':failed}
    with service(8765) as health,Bridge() as bridge:
        assert health['body']['status']=='ready'
        result['ready']=health
        request=bridge.call('reset',config={'seed':92,'runId':'http-real'})
        invalid=call(8765,'/decide',{'requests':[{}]});assert invalid['status']==422
        first=call(8765,'/decide',{'requests':[request]});assert first['status']==200
        old=first['body']['records'][0]['proposal'];retry=bridge.call('retry')
        stale=bridge.call('step',proposal=old);assert not stale['accepted']
        second=call(8765,'/decide',{'requests':[retry]});assert second['status']==200
        transition=bridge.call('step',proposal=second['body']['records'][0]['proposal']);assert transition['accepted']
        before=bridge.call('snapshot')
        duplicate=bridge.call('step',proposal=second['body']['records'][0]['proposal']);assert not duplicate['accepted']
        assert before==bridge.call('snapshot')
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future=pool.submit(call,8765,'/decide',{'requests':[request]*16})
            deadline=time.monotonic()+30
            while time.monotonic()<deadline:
                running=call(8765,'/health')
                if running['body']['status']=='running':break
                if future.done():raise RuntimeError('batch completed before busy observation')
                time.sleep(.02)
            busy=call(8765,'/decide',{'requests':[request]})
            assert busy['status']==503 and busy['retry_after']=='1'
            batch=future.result();assert batch['status']==200
        recovered=call(8765,'/decide',{'requests':[request]});assert recovered['status']==200
        result.update(invalid=invalid,first=first,retry=second,stale=stale,duplicate=duplicate,executed=transition,
            busy=busy,batch_completed_count=len(batch['body']['records']),recovered=recovered,final_health=call(8765,'/health'))
    result['scope']='real model HTTP; explicit missing-model and busy failure; identity retry; service processes stopped; no automatic rule fallback'
    (ROOT/'experiments/m0/evidence/http-probe.json').write_text(json.dumps(result,indent=2))
    print('Real HTTP health, failure, validation, busy, retry, stale and duplicate checks passed.')
