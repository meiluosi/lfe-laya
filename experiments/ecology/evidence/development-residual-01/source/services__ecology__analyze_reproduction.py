"""描述恢复繁殖后的真实出生/学习记录；不将出生数解释为学习收益。"""
import argparse
import json
from pathlib import Path


def analyze(directory):
    reports=[]
    for path in sorted(directory.glob('*/report.json')):
        report=json.loads(path.read_text());initial=json.loads((path.parent/'initial.json').read_text())
        initial_ids={a['id'] for a in initial['agents']};first_inputs={};updated=set();last=initial
        for line in (path.parent/'rounds.jsonl').open():
            row=json.loads(line);last=row['result']['snapshot']
            for entry in (row.get('prepared') or {}).get('policyInputs',[]):
                first_inputs.setdefault(entry['agentId'],{'tick':row['requests'][0]['identity']['tick'],'revision':entry['revision']})
            updated.update(u['agentId'] for u in (row.get('receipt') or {}).get('updates',[]))
        if (path.parent/'truncation.json').exists():
            updated.update(u['agentId'] for u in json.loads((path.parent/'truncation.json').read_text())['updates'])
        children=[a for a in last['lineage'] if a['id'] not in initial_ids]
        observed=[a for a in children if a['id'] in first_inputs]
        reports.append({'runId':report['runId'],'mode':report['mode'],'seed':report['seed'],'tick':last['tick'],
            'births':report['metrics']['births'],'deaths':report['metrics']['deaths'],'finalLiving':report['living'],
            'maxGeneration':max(a['generation'] for a in last['lineage']),
            'childrenWithLearningInputs':len(observed),'childrenWithUpdates':len({a['id'] for a in children}&updated),
            'allObservedChildrenStartAtRevisionZero':all(first_inputs[a['id']]['revision']==0 for a in observed) if observed else None,
            'childrenWithoutNextDecision':len(children)-len(observed) if report['mode'] in ('learning','no-laya') else None,
            'childFirstInputs':{a['id']:first_inputs[a['id']] for a in observed},
            'updates':report['updates'],'modelCalls':report['model_calls']})
    result={'experimentComplete':(directory/'completion.json').exists(),'runs':reports,
        'limits':['描述性繁殖观察，不是预注册留出收益检验。','新生首轮版本为零不单独证明权重/优化器隔离；隔离另由个体初始化测试验证。','最后一轮出生的个体可能尚无下一次决策。']}
    (directory/'reproduction-analysis.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('directory');args=parser.parse_args()
    result=analyze(Path(args.directory));print(json.dumps([{k:v for k,v in row.items() if k!='childFirstInputs'} for row in result['runs']],ensure_ascii=False,indent=2))
