"""真实 Laya + 独立 PPO 的 M0 小规模对照。所有世界均来自同一 TS 核心。"""
import argparse,copy,json,os,time,hashlib
from pathlib import Path
import numpy as np
import torch
from bridge import Bridge,ROOT
from gym_env import ACTIONS,features,mask
from policy import PolicySession
from laya_provider import LayaProvider

def rule(request,rng):
    legal={c['id'] for c in request['candidates']};o=request['observation']
    if 'eat' in legal and o['energy']<o['capacity']-1:return 'eat'
    targets=[c for c in o['local'] if c['food']>0 and (c['dx'] or c['dy'])]
    if not targets:targets=[m for m in o['memory'] if m['dx'] or m['dy']]
    if targets:
        t=min(targets,key=lambda c:abs(c['dx'])+abs(c['dy']))
        options=[]
        if t['dx']:options.append('east' if t['dx']>0 else 'west')
        if t['dy']:options.append('south' if t['dy']>0 else 'north')
        for action in options:
            if action in legal:return action
    moves=[a for a in ACTIONS[:4] if a in legal]
    return str(rng.choice(moves)) if moves else 'rest'

def create_population(bridge,cfg,seeds,stage,learned=None):
    population=[]
    modes=['rule','fixed-current','fixed-memory','B','no-laya','frozen-B'] if stage=='online' else ['B','no-laya','frozen-B']
    for i,seed in enumerate(seeds):
        for mode in modes:
            identifier=f'{stage}-{seed}-{mode}'
            init_seed=cfg['seed_training'][i]
            policy=PolicySession(init_seed,cfg) if mode in ['B','no-laya','frozen-B'] else None
            if stage=='heldout' and mode in ['B','no-laya']:policy.restore(learned[(i,mode)])
            if policy and (mode=='frozen-B' or stage=='heldout'):policy.freeze()
            request=bridge.call('reset',id=identifier,config={**cfg['world'],'runId':identifier,'seed':seed})
            population.append({'id':identifier,'seed':seed,'seed_index':i,'mode':mode,'policy':policy,'request':request,
                'rng':np.random.default_rng(init_seed+500),'done':False,'needs_update':False,'steps':0,'reward':0.,'eaten':0.,'death':False,
                'reward_by_stage':[[],[],[]],'windows':{},'update_log':[],'initial_parameters':policy.fingerprint() if policy else None})
    return population

def run_population(bridge,provider,population,cfg,out,stage):
    with (out/f'{stage}-decisions.jsonl').open('w') as log:
        iteration=0
        while any(not p['done'] for p in population):
            active=[p for p in population if not p['done']]
            model_records={}
            for memory in [False,True]:
                model_members=[p for p in active if p['mode'] in (['fixed-current'] if not memory else ['fixed-memory','B','frozen-B'])]
                if not model_members:continue
                records=provider.predict([p['request'] for p in model_members],memory=memory)
                for p,record in zip(model_members,records):model_records[p['id']]=record
            for p in active:
                request=p['request'];record=model_records.get(p['id']);prior=record['proposal']['distribution'] if record else None
                obs=features(request,prior);policy=p['policy']
                if p['needs_update']:
                    update=policy.update(obs,False,f"{p['id']}:update:{policy.revision}",policy.revision)
                    p['update_log'].append(update);p['needs_update']=False
                if policy:
                    proposal=policy.act(request,obs,mask(request),provider=f"{'laya+' if p['mode']!='no-laya' else ''}individual-ppo{'-frozen' if policy.frozen else ''}")
                elif p['mode']=='rule':proposal={'identity':request['identity'],'action':rule(request,p['rng']),'provider':'rule'}
                else:proposal=record['proposal']
                transition=bridge.call('step',id=p['id'],proposal=proposal)
                if not transition['accepted']:raise RuntimeError(transition)
                if policy:policy.settle(transition)
                log.write(json.dumps({'id':p['id'],'stage':stage,'seed':p['seed'],'mode':p['mode'],
                    'model':record,'transition':transition},allow_nan=False)+'\n')
                p['steps']+=1;p['reward']+=transition['reward'];p['death']=transition['terminated']
                p['eaten']+=sum(e.get('amount',0) for e in transition['events'] if e['kind']=='ate')
                phase=min((transition['tick']-1)//cfg['world']['phaseSteps'],2)
                p['reward_by_stage'][phase].append(transition['reward']);window=(transition['tick']-1)//20
                p['windows'].setdefault(window,[]).append(transition['reward'])
                p['done']=bool(transition['terminated'] or transition['truncated'])
                if p['done']:
                    if policy and not policy.frozen and policy.model.rollout_buffer.pos:
                        if transition['terminated']:next_obs=np.zeros_like(obs)
                        else:
                            final=bridge.call('inspect',id=p['id'])
                            final_record=provider.predict([final])[0] if p['mode']=='B' else None
                            next_obs=features(final,final_record['proposal']['distribution'] if final_record else None)
                            if final_record:log.write(json.dumps({'id':p['id'],'purpose':'truncation_bootstrap_only','model':final_record})+'\n')
                        p['update_log'].append(policy.update(next_obs,transition['terminated'],f"{p['id']}:final",policy.revision))
                else:
                    p['request']=bridge.call('observe',id=p['id'])
                    if policy and not policy.frozen and policy.model.rollout_buffer.full:p['needs_update']=True
            log.flush();iteration+=1
            if iteration%32==0 or not any(not p['done'] for p in population):
                checkpoint={p['id']:{'world':bridge.call('snapshot',id=p['id']),'policy':p['policy'].export() if p['policy'] else None,
                    'rng':p['rng'].bit_generator.state,'needs_update':p['needs_update'],'done':p['done'],'steps':p['steps']} for p in population}
                temp=out/f'{stage}-checkpoint.tmp';torch.save(checkpoint,temp);os.replace(temp,out/f'{stage}-checkpoint.pt')
                print(json.dumps({'stage':stage,'iteration':iteration,'active':sum(not p['done'] for p in population),'steps':sum(p['steps'] for p in population)}),flush=True)
    summaries=[]
    for p in population:
        summary={k:p[k] for k in ['id','seed','mode','steps','reward','eaten','death','initial_parameters','update_log']}
        summary['final_parameters']=p['policy'].fingerprint() if p['policy'] else None
        summary['mean_reward_by_stage']=[float(np.mean(a)) if a else None for a in p['reward_by_stage']]
        summary['stage_observed_steps']=[len(a) for a in p['reward_by_stage']]
        summary['window_mean_rewards']={k:float(np.mean(v)) for k,v in p['windows'].items()}
        summaries.append(summary)
    (out/f'{stage}-summary.json').write_text(json.dumps(summaries,indent=2))
    return summaries

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);parser.add_argument('--pilot',action='store_true');args=parser.parse_args()
    out=ROOT/args.output;out.mkdir(parents=True,exist_ok=False)
    torch.set_num_threads(2)
    cfg=json.loads((ROOT/'experiments/m0/config/learning.json').read_text())
    if args.pilot:cfg['world']['horizon']=64;cfg['world']['phaseSteps']=24;cfg['seed_training']=[71];cfg['seed_heldout']=[72]
    (out/'config.json').write_text(json.dumps(cfg,indent=2))
    sources={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for base in ['packages','services/m0'] for p in (ROOT/base).rglob('*') if p.suffix in ['.ts','.py']}
    (out/'source-sha256.json').write_text(json.dumps(sources,indent=2))
    provider=LayaProvider();start=time.perf_counter();print(json.dumps(provider.metadata()),flush=True)
    try:
        with Bridge() as bridge:
            population=create_population(bridge,cfg,cfg['seed_training'],'online')
            online=run_population(bridge,provider,population,cfg,out,'online')
            learned={(p['seed_index'],p['mode']):p['policy'].export() for p in population if p['mode'] in ['B','no-laya']}
            evaluation=create_population(bridge,cfg,cfg['seed_heldout'],'heldout',learned)
            heldout=run_population(bridge,provider,evaluation,cfg,out,'heldout')
            report={'status':'completed','pilot':args.pilot,'elapsed_seconds':time.perf_counter()-start,'model':provider.metadata(),
                'bridge_calls':bridge.calls,'bridge_seconds':bridge.elapsed,'online':online,'heldout':heldout}
            (out/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k not in ['online','heldout']}),flush=True)
    except Exception as e:
        (out/'failure.json').write_text(json.dumps({'error':repr(e),'elapsed_seconds':time.perf_counter()-start},indent=2));raise
