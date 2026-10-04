"""按运行前的判据汇总所有种子；不筛选幸存者或挑最好的一次。"""
import argparse,hashlib,json,statistics
from bridge import ROOT

def average(values):return statistics.mean(values) if values else None

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('run');args=parser.parse_args()
    source=ROOT/args.run;report=json.loads((source/'report.json').read_text());assert not report['pilot']
    cfg=json.loads((source/'config.json').read_text())
    aggregates={}
    for stage in ['online','heldout']:
        aggregates[stage]={}
        for mode in dict.fromkeys(r['mode'] for r in report[stage]):
            rows=[r for r in report[stage] if r['mode']==mode]
            aggregates[stage][mode]={'n':len(rows),'mean_reward':average([r['reward'] for r in rows]),
                'deaths':sum(r['death'] for r in rows),'mean_steps':average([r['steps'] for r in rows]),
                'mean_eaten':average([r['eaten'] for r in rows]),'updates':sum(len(r['update_log']) for r in rows)}
    gates={}
    for name,baseline in [('learning_gain','frozen-B'),('laya_value','no-laya')]:
        pairs=[]
        for seed in cfg['seed_heldout']:
            b=next(r for r in report['heldout'] if r['seed']==seed and r['mode']=='B')
            c=next(r for r in report['heldout'] if r['seed']==seed and r['mode']==baseline)
            pairs.append({'seed':seed,'B':b['reward'],'baseline':c['reward'],'difference':b['reward']-c['reward']})
        diff=average([p['difference'] for p in pairs]);raw_wins=sum(p['difference']>0 for p in pairs)
        # 纯累计浮点误差不算行为胜出；同时保留原始差值与严格原始计数。
        tolerance=1e-9;wins=sum(p['difference']>tolerance for p in pairs)
        gates[name]={'baseline':baseline,'pairs':pairs,'mean_difference':diff,'positive_seeds':wins,
            'raw_positive_seeds':raw_wins,'numeric_ties':sum(abs(p['difference'])<=tolerance for p in pairs),'numeric_tolerance':tolerance,
            'pass':diff>=.1 and wins>=2 and aggregates['heldout']['B']['deaths']<=aggregates['heldout'][baseline]['deaths']}
    adaptation=[]
    for r in report['online']:
        first=r['window_mean_rewards'].get('0');returned=r['window_mean_rewards'].get('12')
        adaptation.append({'id':r['id'],'stage_means':r['mean_reward_by_stage'],'stage_observed_steps':r['stage_observed_steps'],
            'initial_A_first20':first,'return_A_first20':returned,'return_minus_initial':None if returned is None else returned-first,
            'windows':r['window_mean_rewards'],'death':r['death']})
    model_calls=0;model_amortized_ms=0;executions=0
    for stage in ['online','heldout']:
        with (source/f'{stage}-decisions.jsonl').open() as lines:
            for line in lines:
                row=json.loads(line);executions+='transition' in row
                if row.get('model'):model_calls+=1;model_amortized_ms+=row['model']['amortized_ms']
    updates=[u for r in report['online'] for u in r['update_log']]
    frozen=[r for stage in ['online','heldout'] for r in report[stage] if stage=='heldout' or r['mode']=='frozen-B']
    assert all(r['initial_parameters']==r['final_parameters'] and not r['update_log'] for r in frozen)
    hashes=json.loads((source/'source-sha256.json').read_text())
    changes=[name for name,digest in hashes.items() if hashlib.sha256((ROOT/name).read_bytes()).hexdigest()!=digest]
    runtime={'services/m0/run_experiment.py','services/m0/bridge.py','services/m0/gym_env.py','services/m0/policy.py','services/m0/laya_provider.py'}
    summary={'aggregates':aggregates,'gates':gates,'adaptation':adaptation,'cost':{
        'wall_seconds':report['elapsed_seconds'],'model_decisions_including_bootstrap':model_calls,'actual_transitions':executions,
        'model_amortized_seconds':model_amortized_ms/1000,'training_updates':len(updates),
        'update_median_ms':statistics.median(u['milliseconds'] for u in updates),
        'update_max_ms':max(u['milliseconds'] for u in updates),'bridge_seconds':report['bridge_seconds']},
        'frozen_parameter_checks':len(frozen),'changed_recorded_sources':changes,
        'changed_experiment_runtime_sources':[p for p in changes if p in runtime or p.startswith('packages/')],
        'limits':['3 seeds only; exploratory signal, no statistical significance claim',
            'heldout worlds paired; learned versus initial policy RNG follows own history and is not reset to identical evaluation draw state',
            'dead suffix is unobserved; no zero fill, no resurrection',
            'first20 window comparison is predefined recovery proxy; no time-to-recovery threshold was defined',
            'B uses Laya probabilities as features, not fixed logit prior; conclusions apply to this fusion and short budget']}
    (source/'analysis.json').write_text(json.dumps(summary,indent=2))
    print(json.dumps({k:v for k,v in summary.items() if k!='adaptation'},indent=2))
