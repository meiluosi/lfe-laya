"""开发情境与候选顺序诊断；真实 Laya 响应，不执行动作或产生训练样本。"""
import copy
import json
from pathlib import Path
from bridge import Bridge
from provider import encode
from experiment import write_json


def controlled_cases():
    cases=[]
    with Bridge() as b:
        for seed in range(41,61):
            s=b.call('reset',config={'runId':'diagnostic-controlled','seed':seed,'width':9,'height':9,'initialAgents':1,'initialEnergy':12,'initialFood':0,'reproduction':False})['snapshot']
            a=s['agents'][0]
            if 2<=a['x']<7 and 2<=a['y']<7:break
        else:raise RuntimeError('diagnostic_fixture_position')
        x=int(a['x']);y=int(a['y'])
        for name,dx,dy in [('north',0,-2),('south',0,2),('east',2,0),('west',-2,0),('eat',0,0)]:
            b.call('restore',snapshot=s);b.call('intervene',command={'kind':'nutrient','x':x+dx,'y':y+dy,'amount':12})
            cases.append({'name':f'controlled-{name}','source':'controlled TS world; not an ecological trajectory','expected':name,'request':b.call('observe')[0],'world':b.call('snapshot')})
        b.call('restore',snapshot=s);b.call('intervene',command={'kind':'nutrient','x':x,'y':y-2,'amount':12})
        b.call('intervene',command={'kind':'obstacle','x':x,'y':y-1,'blocked':True})
        cases.append({'name':'controlled-wall','source':'food first observed, then blocked by a real obstacle','expected':None,'request':b.call('observe')[0],'world':b.call('snapshot')})
    return cases


def trajectory_cases(path):
    found={}
    for line in Path(path).open():
        row=json.loads(line)
        for request in row['requests']:
            o=request['observation'];food=[c for c in o['local'] if c['food']>=.5 and not c['blocked']]
            flags={'many-food':len(food)>=3,'empty-view':not any(c['food']>=.01 for c in o['local']),
                   'old-memory':any(m['stepsAgo']>=100 for m in o['memory']),
                   'food-north':any(c['dy']<-1 and abs(c['dx'])<.51 for c in food)}
            for name,yes in flags.items():
                if yes and name not in found:found[name]={'name':f'trajectory-{name}','source':str(path),'expected':None,'request':request}
        if len(found)==4:break
    return list(found.values())


def run(provider,output,trajectory):
    output.mkdir(exist_ok=False);cases=controlled_cases()+trajectory_cases(trajectory);queries=[];manifest=[]
    for case in cases:
        encode(case['request']);candidates=case['request']['candidates'];n=len(candidates);orders=[list(range(n)),list(reversed(range(n))),list(range(1,n))+[0],list(range(n//2,n))+list(range(n//2))]
        seen=set()
        for order in orders:
            if tuple(order) in seen:continue
            seen.add(tuple(order));request=copy.deepcopy(case['request']);request['candidates']=[candidates[i] for i in order]
            queries.append(request);manifest.append({'case':case['name'],'order':order,'expected':case['expected']})
    records=[]
    for offset in range(0,len(queries),48):records.extend(provider.predict(queries[offset:offset+48],memory=True))
    write_json(output/'raw.json',{'purpose':'development model diagnostic only','executedInWorld':False,'cases':cases,'probes':[{'spec':m,'request':q,'record':r} for m,q,r in zip(manifest,queries,records)]})
    summary=[]
    for case in cases:
        pairs=[(m,r) for m,r in zip(manifest,records) if m['case']==case['name']];base=pairs[0][1]['proposal'];actions=[r['proposal']['action'] for _,r in pairs]
        distances=[sum(abs(r['proposal']['distribution'][a]-p) for a,p in base['distribution'].items())/2 for _,r in pairs]
        summary.append({'case':case['name'],'choices':actions,'choiceChanges':sum(a!=actions[0] for a in actions[1:]),'maxTotalVariation':max(distances),'expected':case['expected'],'expectedRate':sum(a==case['expected'] for a in actions)/len(actions) if case['expected'] else None})
    write_json(output/'summary.json',{'modelCalls':len(records),'cases':summary,'limits':'controlled examples and selected development observations; no broad capability or heldout claim'})
    return summary
