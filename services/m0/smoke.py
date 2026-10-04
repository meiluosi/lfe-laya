import json,time,resource
from pathlib import Path
from bridge import Bridge,ROOT
from laya_provider import LayaProvider
out=ROOT/'experiments/m0/evidence'
print('Loading fixed local Laya on MPS',flush=True)
provider=LayaProvider('mps')
print(json.dumps(provider.metadata()),flush=True)
with Bridge() as bridge, (out/'real-smoke.jsonl').open('w') as log:
    request=bridge.call('reset',config={'runId':'real-smoke','seed':11})
    for i in range(12):
        record=provider.predict([request])[0]
        result=bridge.call('step',proposal=record['proposal'])
        if not result['accepted']:raise RuntimeError(result)
        log.write(json.dumps({'decision':record,'transition':result},allow_nan=False)+'\n');log.flush()
        print(json.dumps({'step':i+1,'action':result['action'],'energy':result['snapshot']['energy'],'ms':record['batch_ms']}),flush=True)
        if result['terminated'] or result['truncated']:break
        request=bridge.call('observe')
    (out/'real-smoke-summary.json').write_text(json.dumps({'model':provider.metadata(),'steps':i+1,'peak_rss_bytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,'bridge_calls':bridge.calls,'bridge_seconds':bridge.elapsed},indent=2))
