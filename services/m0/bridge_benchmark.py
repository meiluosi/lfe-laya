import json,time
from bridge import ROOT,Bridge
from gym_env import features,mask
from policy import PolicySession
import torch
if __name__=='__main__':
    torch.set_num_threads(2);rows=[]
    with Bridge() as bridge:
        for count in [1,8,16,32,48]:
            requests={str(i):bridge.call('reset',id=str(i),config={'seed':i+1,'runId':f'bridge-{count}-{i}','horizon':96}) for i in range(count)}
            start=time.perf_counter();calls_before=bridge.calls;time_before=bridge.elapsed
            for _ in range(32):
                for identifier,r in requests.items():
                    result=bridge.call('step',id=identifier,proposal={'identity':r['identity'],'action':'rest','provider':'bridge-benchmark'})
                    assert result['accepted'];requests[identifier]=bridge.call('observe',id=identifier)
            elapsed=time.perf_counter()-start
            rows.append({'worlds':count,'transitions':32*count,'seconds':elapsed,'bridge_calls':bridge.calls-calls_before,'bridge_seconds':bridge.elapsed-time_before,'purpose':'TS/Python transport+world update only; no Laya or learning'})
    (ROOT/'experiments/m0/evidence/bridge-benchmark.json').write_text(json.dumps(rows,indent=2));print(json.dumps(rows,indent=2))
