"""共享生态真实对照运行器；所有世界由 TS 桥推进，逐轮原始证据落盘。"""
import argparse
import copy
import hashlib
import json
import time
from pathlib import Path
from bridge import Bridge, ROOT
from provider import EcologyProvider
from runtime import LearningRuntime
import checkpoint

MODES=('rule','laya','memory','learning','no-laya','frozen')

def write_json(path,data):
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2,allow_nan=False))

def run_world(bridge,provider,config,mode,output,learning_config=None,initial_learning=None,eval_seed=None):
    output.mkdir(exist_ok=False)
    reset=bridge.call('reset',config=config);initial=reset['snapshot'];write_json(output/'initial.json',initial)
    learning=None
    if mode in ('learning','no-laya','frozen'):
        learning=LearningRuntime(config['runId'],config['seed'],learning_config,mode=='frozen',mode=='no-laya')
        if initial_learning:
            learning=LearningRuntime.from_state(initial_learning,run_id=config['runId'])
            # 新留出世界是独立评估；重置时间身份/经验，参数和优化器保持检查点值。
            all_states={**initial_learning['retired'],**initial_learning['policies']}
            from learning import IndividualPolicy
            learning.policies={key:IndividualPolicy.from_state(state) for key,state in all_states.items() if int(key.split('-')[1])<config['initialAgents']}
            learning.retired={};learning.last_tick=-1;learning.last_world_hash=None;learning.receipts={}
            learning.set_frozen(True)
            for index,(key,p) in enumerate(sorted(learning.policies.items())):
                p.last_tick=-1;p.last_settled=None;p.pending=None;p.episode_start=True
                p.reset_exploration(eval_seed+index)
    started=time.perf_counter();rounds=0;decisions=0;updates=0;model_calls=0;phases=[]
    action_counts={};cohort={a['id']:{'alive_ticks':0,'reward':0.,'low_ticks':0,'eaten':0.,'energy_sum':0.} for a in initial['agents']}
    latest=initial
    with (output/'rounds.jsonl').open('w') as log:
        while latest['agents'] and latest['tick']<latest['config']['horizon']:
            requests=bridge.call('observe');records=[]
            if mode not in ('rule','no-laya'):
                records=provider.predict(requests,memory=mode!='laya');model_calls+=len(records)
            prepared=None;receipt=None
            if learning:
                tx=f"{config['runId']}:{latest['tick']}";prepared=learning.prepare(tx,requests,records);proposals=prepared['proposals']
            elif mode=='rule':proposals=bridge.call('controller',mode='rule')
            else:proposals=[r['proposal'] for r in records]
            result=bridge.call('step',proposals=proposals)
            if not result['accepted']:raise RuntimeError(result['reason'])
            if learning:receipt=learning.commit(tx,result);updates+=len(receipt['updates'])
            latest=result['snapshot'];rounds+=1;decisions+=len(proposals)
            for proposal,outcome in zip(proposals,result['outcomes']):
                action_counts[proposal['action']]=action_counts.get(proposal['action'],0)+1
                ident=outcome['agentId']
                if ident in cohort:
                    row=cohort[ident];row['alive_ticks']+=outcome['endTick']-outcome['startTick'];row['reward']+=outcome['reward'];row['energy_sum']+=outcome['energyAfter']
                    if outcome['energyAfter']<requests[[r['identity']['agentId'] for r in requests].index(ident)]['observation']['capacity']*.25:row['low_ticks']+=outcome['endTick']-outcome['startTick']
            for event in result['events']:
                if event['kind']=='ate' and event.get('agentId') in cohort:cohort[event['agentId']]['eaten']+=event['amount']
            row={'requests':requests,'modelRecords':records,'prepared':prepared,'receipt':receipt,'result':result}
            log.write(json.dumps(row,allow_nan=False)+'\n');log.flush()
            if rounds%32==0 or not latest['agents'] or latest['tick']>=latest['config']['horizon']:
                checkpoint.save(output/'checkpoint.pt',{'format':'ecology-experiment-v1','world':latest,'learning':learning.export() if learning else None,'mode':mode})
                print(json.dumps({'run':config['runId'],'round':rounds,'tick':latest['tick'],'living':len(latest['agents']),'updates':updates,'elapsed':round(time.perf_counter()-started,2)}),flush=True)
            if latest['tick']%config['phaseTicks']==0 or not latest['agents']:
                phases.append({'tick':latest['tick'],'living':len(latest['agents']),'metrics':copy.deepcopy(latest['metrics']),'cohort':copy.deepcopy(cohort)})
        if learning and latest['agents'] and not learning.frozen:
            requests=bridge.call('inspect');records=[] if learning.no_laya else provider.predict(requests,memory=True);model_calls+=len(records)
            final_updates=learning.finish(requests,records);updates+=len(final_updates)
            write_json(output/'truncation.json',{'requests':requests,'records':records,'updates':final_updates})
        state={'format':'ecology-experiment-v1','world':latest,'learning':learning.export() if learning else None,'mode':mode}
        checkpoint_info=checkpoint.save(output/'checkpoint.pt',state)
    report={'runId':config['runId'],'mode':mode,'seed':config['seed'],'rounds':rounds,'decisions':decisions,'model_calls':model_calls,'updates':updates,'living':len(latest['agents']),
        'tick':latest['tick'],'elapsed_seconds':time.perf_counter()-started,'metrics':latest['metrics'],'ledger':latest['ledger'],'cohort':cohort,'phases':phases,'action_counts':action_counts,
        'survival_fraction':sum(r['alive_ticks'] for r in cohort.values())/(config['initialAgents']*config['horizon']),
        'cohort_mean_reward':sum(r['reward'] for r in cohort.values())/config['initialAgents'],'checkpoint':checkpoint_info}
    write_json(output/'report.json',report)
    return report,state


def main():
    parser=argparse.ArgumentParser();parser.add_argument('config');parser.add_argument('output');args=parser.parse_args()
    spec=json.loads(Path(args.config).read_text());out=Path(args.output);out.mkdir(parents=True,exist_ok=False)
    write_json(out/'config.json',spec)
    source_paths=[*Path('services/ecology').glob('*.py'),*Path('packages/sim').glob('*.ts'),Path('packages/protocol/ecology.ts')]
    source_dir=out/'source';source_dir.mkdir();hashes={}
    for path in source_paths:
        data=path.read_bytes();hashes[str(path)]=hashlib.sha256(data).hexdigest();(source_dir/str(path).replace('/','__')).write_bytes(data)
    write_json(out/'source-sha256.json',hashes)
    provider=EcologyProvider() if any(mode not in ('rule','no-laya') for mode in spec['modes']) else None
    if provider:write_json(out/'model.json',provider.metadata())
    reports=[]
    with Bridge() as bridge:
        for mode in spec['modes']:
            if mode not in MODES:raise ValueError('experiment_mode')
            for seed in spec['seeds']:
                config={**spec['world'],'seed':seed,'runId':f"{spec['name']}-{mode}-{seed}"}
                report,state=run_world(bridge,provider,config,mode,out/config['runId'],spec.get('learning'))
                reports.append(report);write_json(out/'reports.json',reports)
    write_json(out/'completion.json',{'status':'complete','runs':len(reports),'model_calls':sum(r['model_calls'] for r in reports)})
    print(json.dumps({'complete':True,'runs':len(reports)}),flush=True)

if __name__=='__main__':main()
