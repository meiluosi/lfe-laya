"""从真实逐轮记录计算诊断；不向策略或训练反馈任何全局评价。"""
import argparse
import json
from pathlib import Path
from experiment import write_json

OPPOSITE={'north':'south','south':'north','east':'west','west':'east'}

def analyze_run(directory):
    initial=json.loads((directory/'initial.json').read_text());report=json.loads((directory/'report.json').read_text());c=initial['config']
    cohort={a['id'] for a in initial['agents']};boundaries=[initial];previous={};oscillations=0;max_ledger_error=0.;model_ms=0.;updates=0
    phase_rewards=[0.,0.,0.];phase_food=[0.,0.,0.];latest=initial
    for line in (directory/'rounds.jsonl').open():
        row=json.loads(line);result=row['result'];s=result['snapshot'];before={a['id']:a for a in latest['agents']};after={a['id']:a for a in s['agents']}
        phase=min(2,result['requests'][0]['identity']['tick']//c['phaseTicks'])
        ate={e['agentId'] for e in result['events'] if e['kind']=='ate'}
        for p,o in zip(row['result']['proposals'],row['result']['outcomes']):
            ident=o['agentId'];last=previous.get(ident)
            if ident in cohort:phase_rewards[phase]+=o['reward']/len(cohort)
            if last and p['action']==OPPOSITE.get(last['action']) and ident in after and ident not in ate and not last['ate']:
                a=after[ident]
                if abs(a['x']-last['start'][0])+abs(a['y']-last['start'][1])<1e-7:oscillations+=1
            previous[ident]={'action':p['action'],'ate':ident in ate,'start':(before[ident]['x'],before[ident]['y'])}
        phase_food[phase]+=sum(e['amount'] for e in result['events'] if e['kind']=='ate' and e['agentId'] in cohort)/len(cohort)
        model_ms+=sum(r.get('amortized_ms',0) for r in row['modelRecords']);updates+=len((row.get('receipt') or {}).get('updates',[]))
        ledger=s['ledger'];loss=sum(v for key,v in ledger.items() if key not in ('initial','supplied'))
        max_ledger_error=max(max_ledger_error,abs(sum(s['food'])+sum(a['energy'] for a in s['agents'])+loss-ledger['initial']-ledger['supplied']))
        boundaries.append(s);latest=s
    recovered=[]
    for phase in range(3):
        start=phase*c['phaseTicks'];end=min((phase+1)*c['phaseTicks'],c['horizon']);window=[s for s in boundaries if start<=s['tick']<=end]
        for ident in sorted(cohort):
            streak=[];latency=None
            for s in window:
                a=next((a for a in s['agents'] if a['id']==ident),None)
                healthy=a and a['energy']>=c['capacity']*a['traits']['size']*.25
                if healthy:
                    if streak and s['tick']-streak[-1]!=c['decisionTicks']:streak=[]
                    streak.append(s['tick'])
                    if len(streak)==10:latency=streak[0]-start;break
                else:streak=[]
            died=next(l['died'] for l in latest['lineage'] if l['id']==ident)
            recovered.append({'phase':phase,'agentId':ident,'latencyTicks':latency,'censored':latency is None,'diedByPhaseEnd':died is not None and died<=end,'phaseEnteredAlive':died is None or died>start})
    return {'runId':c['runId'],'mode':report['mode'],'seed':c['seed'],'complete':True,'initialCohort':len(cohort),'finalLiving':report['living'],'deaths':report['metrics']['deaths'],
        'cohortReward':report['cohort_mean_reward'],'survivalFraction':report['survival_fraction'],'lowEnergyLivingTimeFraction':latest['metrics']['lowEnergyTicks']/max(1,latest['metrics']['agentTicks']),
        'finalCohortEnergy':sum(a['energy'] for a in latest['agents'] if a['id'] in cohort)/len(cohort),'movementCostPerFood':latest['ledger']['movement']/latest['metrics']['eaten'] if latest['metrics']['eaten'] else None,
        'nonfeedingReturnPairs':oscillations,'phaseCohortRewards':phase_rewards,'phaseFoodPerInitialAgent':phase_food,'recovery':recovered,'maxLedgerResidual':max_ledger_error,
        'modelSecondsSummedAmortized':model_ms/1000,'wallSeconds':report['elapsed_seconds'],'modelCalls':report['model_calls'],'updatesIncludingFinalBootstrap':report['updates'],
        'notes':['恢复按十步边界测量；低能量比例分母仅为实际存活时间，须与死亡和全队列存活指标一起读。','返回 A 的变化不是单独的遗忘因果检验。']}


def gate(rows,prefix,a,b):
    by={row['runId']:row for row in rows};pairs=[]
    for seed in [1009,1013,1019]:
        left=by.get(f'{prefix}-{a}-{seed}');right=by.get(f'{prefix}-{b}-{seed}')
        if not left or not right:return {'status':'incomplete','comparison':[a,b]}
        pairs.append({'seed':seed,'rewardDifference':left['cohortReward']-right['cohortReward'],'deathDifference':left['deaths']-right['deaths'],'survivalDifference':left['survivalFraction']-right['survivalFraction']})
    mean=sum(p['rewardDifference'] for p in pairs)/3;deaths=sum(p['deathDifference'] for p in pairs);positive=sum(p['rewardDifference']>0 for p in pairs)
    return {'status':'complete','comparison':[a,b],'pairs':pairs,'meanRewardDifference':mean,'deathDifference':deaths,'positiveWorlds':positive,'exploratoryGatePassed':mean>=.1 and deaths<=0 and positive>=2,'statisticalSignificanceClaim':False}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('directory');args=parser.parse_args();root=Path(args.directory)
    rows=[analyze_run(p.parent) for p in sorted(root.glob('*/report.json'))]
    summary={'completedRuns':len(rows),'experimentComplete':(root/'completion.json').exists(),'runs':rows}
    if root.name=='heldout-01':summary['gates']=[gate(rows,'heldout-01',a,b) for a,b in [('features-trained','features-initial'),('features-trained','no-laya-trained'),('residual-trained','residual-initial'),('residual-trained','features-trained'),('features-trained','memory-masked')]]
    write_json(root/'analysis.json',summary);print(json.dumps({'runs':len(rows),'complete':summary['experimentComplete'],'gates':summary.get('gates')},ensure_ascii=False))

if __name__=='__main__':main()
