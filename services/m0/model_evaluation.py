import copy,json,threading,time,resource,argparse
import numpy as np
import psutil
import torch
from bridge import ROOT,Bridge
from laya_provider import LayaProvider
OUT=ROOT/'experiments/m0/evidence'

def cases():
    from bridge import Bridge
    with Bridge() as b: base=b.call('reset',config={'runId':'context','initialFood':0,'seed':1})
    rows=[]
    for i in range(36):
        r=copy.deepcopy(base);o=r['observation'];o['energy']=float(5+i%4);o['memory']=[]
        for c in o['local']:c['food']=0
        kind=i//6
        expected=None
        if kind<4:
            action=['north','east','south','west'][kind];dx,dy={'north':(0,-1),'east':(1,0),'south':(0,1),'west':(-1,0)}[action]
            next(c for c in o['local'] if c['dx']==dx and c['dy']==dy)['food']=float(5+i%3)
            expected=action
        elif kind==4:
            for c in o['local']:
                if (c['dx'],c['dy']) in [(1,0),(-1,0)]:c['food']=5.
        else:
            o['memory']=[{'dx':1,'dy':0,'food':5.,'stepsAgo':20+i%6}]
        rows.append({'case':i,'split':'development' if i%2==0 else 'heldout','kind':'clear_rule' if expected else 'strategy','expected':expected,'request':r})
    # Six rule fixtures explicitly inspect eat vs movement without giving hidden labels to the model.
    for row in rows[:6]:
        r=row['request'];o=r['observation'];row['expected']='eat'
        for c in o['local']:c['food']=5. if c['dx']==c['dy']==0 else 0.
        r['candidates'].insert(-1,{'id':'eat','dx':0,'dy':0,'description':'Eat food at the current location.'})
    return rows

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--split',choices=['development','heldout','all'],default='development');parser.add_argument('--label',default='v1');parser.add_argument('--benchmark',action='store_true');args=parser.parse_args()
    OUT=OUT/args.label;OUT.mkdir(parents=True,exist_ok=True)
    cfg=json.loads((ROOT/'experiments/m0/config/model-evaluation.json').read_text())
    fixtures=cases();(OUT/'model-contexts.json').write_text(json.dumps(fixtures,indent=2))
    p=LayaProvider();print(json.dumps(p.metadata()),flush=True)
    summaries=[]
    with (OUT/'model-context-results.jsonl').open('w') as log:
        for split in (['development','heldout'] if args.split=='all' else [args.split]):
            subset=[x for x in fixtures if x['split']==split]
            outputs=p.predict([x['request'] for x in subset])
            for case,result in zip(subset,outputs):
                correct=result['proposal']['action']==case['expected'] if case['expected'] else None
                log.write(json.dumps({'case':case['case'],'split':split,'kind':case['kind'],'expected':case['expected'],'correct':correct,'decision':result})+'\n');log.flush()
                summaries.append({'case':case['case'],'split':split,'correct':correct,'chosen':result['proposal']['action']})
    rows=[];request=fixtures[6]['request'];stop=threading.Event();peaks={}
    def sample():
        while not stop.wait(.02):
            peaks['rss']=max(peaks.get('rss',0),psutil.Process().memory_info().rss)
            peaks['mps_driver']=max(peaks.get('mps_driver',0),torch.mps.driver_allocated_memory())
    with (OUT/'model-benchmark-raw.jsonl').open('w') as log:
        for n in (cfg['batches'] if args.benchmark else []):
            for repeat in range(cfg['repetitions']):
                peaks={'rss':psutil.Process().memory_info().rss,'mps_driver':torch.mps.driver_allocated_memory()};stop.clear();thread=threading.Thread(target=sample);thread.start()
                start=time.perf_counter()
                try:
                    result=p.predict([request]*n);torch.mps.synchronize()
                    ms=(time.perf_counter()-start)*1000
                    row={'batch':n,'repeat':repeat,'wall_ms':ms,'decisions_per_second':1000*n/ms,'status':'ok','metadata':p.metadata(),'results':result}
                except Exception as e:
                    row={'batch':n,'repeat':repeat,'status':'error','error':str(e),'metadata':p.metadata()}
                finally:stop.set();thread.join()
                row['sampled_peak_bytes']=dict(peaks);rows.append({k:v for k,v in row.items() if k!='results'})
                log.write(json.dumps(row)+'\n');log.flush();print(json.dumps(rows[-1]),flush=True)
                if row['status']=='error':break
    summary={'model':p.metadata(),'contexts':summaries,'batches':rows,'process_peak_rss_bytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}
    for split in ['development','heldout']:
        clear=[r['correct'] for r in summaries if r['split']==split and r['correct'] is not None]
        summary[split+'_accuracy']=sum(clear)/len(clear) if clear else None
    (OUT/'model-evaluation-summary.json').write_text(json.dumps(summary,indent=2))
    print(json.dumps({k:v for k,v in summary.items() if k not in ['contexts','batches']}),flush=True)
