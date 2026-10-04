"""批量开发或预注册留出实验；合并推理不合并学习。"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
from bridge import Bridge
from provider import EcologyProvider
from experiment import run_grouped,write_json
from runtime import LearningRuntime,stable_seed
from learning import IndividualPolicy
import checkpoint


def initial_state(seed,count,config,no_laya=False):
    r=LearningRuntime('evaluation-initial',seed,config,True,no_laya)
    for i in range(count):
        key=f'life-{i}';r.policies[key]=IndividualPolicy(stable_seed(seed,key),config);r.policies[key].set_frozen(True)
    return r.export()


def main():
    parser=argparse.ArgumentParser();parser.add_argument('config');parser.add_argument('output');args=parser.parse_args()
    spec=json.loads(Path(args.config).read_text());out=Path(args.output);out.mkdir(parents=True,exist_ok=False);write_json(out/'config.json',spec)
    sources=out/'source';sources.mkdir();hashes={}
    for path in [*Path('services/ecology').glob('*.py'),*Path('packages/sim').glob('*.ts'),Path('packages/protocol/ecology.ts')]:
        data=path.read_bytes();hashes[str(path)]=hashlib.sha256(data).hexdigest();(sources/str(path).replace('/','__')).write_bytes(data)
    write_json(out/'source-sha256.json',hashes)
    provider=EcologyProvider();provider.max_batch=8;write_json(out/'model.json',provider.metadata())
    jobs=[]
    for item in spec['jobs']:
        config={**spec['world'],**item.get('world',{}),'runId':f"{spec['name']}-{item['name']}"}
        initial=None;learning_config=item.get('learning',spec.get('learning',{'fusion':'features'}))
        if 'checkpoint' in item:
            data=Path(item['checkpoint']).read_bytes();initial=checkpoint.loads(data)['learning']
            if not initial:raise ValueError('training_checkpoint_required')
            write_json(out/f"{item['name']}-training.json",{'path':item['checkpoint'],'sha256':hashlib.sha256(data).hexdigest()})
            # 记忆消融只屏蔽输入，保留同一检查点权重和相同参数量。
            initial=copy.deepcopy(initial);initial['config']['mask_memory']=bool(item.get('mask_memory',False))
            learning_config={**initial['config']}
        elif 'initial_seed' in item:
            initial=initial_state(item['initial_seed'],config['initialAgents'],learning_config,item.get('no_laya',False))
        jobs.append(dict(config=config,mode=item['mode'],output=out/config['runId'],learning_config=learning_config,initial_learning=initial,eval_seed=item.get('eval_seed')))
    reports=[]
    with Bridge() as bridge:
        for offset in range(0,len(jobs),spec.get('parallel_worlds',3)):
            for report,state in run_grouped(bridge,provider,jobs[offset:offset+spec.get('parallel_worlds',3)]):
                reports.append(report);write_json(out/'reports.json',reports)
    if spec.get('diagnostics_trajectory'):
        from model_diagnostics import run as diagnose
        diagnose(provider,out/'model-diagnostics',spec['diagnostics_trajectory'])
    write_json(out/'completion.json',{'status':'complete','runs':len(reports),'model_calls':sum(r['model_calls'] for r in reports)})
    print(json.dumps({'complete':True,'runs':len(reports)}),flush=True)

if __name__=='__main__':main()
