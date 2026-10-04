"""将实际执行日志投影为只读显示数据；不计算新的动作或奖励。"""
import argparse,json,hashlib
from pathlib import Path
from bridge import ROOT
parser=argparse.ArgumentParser();parser.add_argument('run');args=parser.parse_args()
source=ROOT/args.run;report=json.loads((source/'report.json').read_text());runs={}
for stage in ['online','heldout']:
    for line in (source/f'{stage}-decisions.jsonl').read_text().splitlines():
        row=json.loads(line)
        if 'transition' not in row:continue
        t=row['transition'];snap=t['snapshot'];identifier=row['id']
        run=runs.setdefault(identifier,{'id':identifier,'mode':row['mode'],'stage':stage,'seed':row['seed'],'frames':[]})
        run['frames'].append({'tick':t['tick'],'world':{'size':snap['config']['size'],'x':snap['x'],'y':snap['y'],'energy':snap['energy'],'capacity':snap['config']['capacity'],'food':snap['food']},
          'action':t['action'],'events':t['events'],'reward':t['reward'],'revision':t['proposal'].get('revision'),
          'terminated':t['terminated'],'truncated':t['truncated'],'provider':t['proposal']['provider'],
          'model':row['model'],'final_distribution':t['proposal'].get('distribution')})
artifact={'kind':'recorded-real-experiment','pilot':report['pilot'],'source':args.run,'source_sha256':hashlib.sha256((source/'report.json').read_bytes()).hexdigest(),
    'runs':list(runs.values()),'summary':{'online':report['online'],'heldout':report['heldout']},'model':report['model']}
(ROOT/'public/m0/latest.json').write_text(json.dumps(artifact,ensure_ascii=False,allow_nan=False))
print(f'Exported {len(runs)} actual trajectories; no model calls or simulated events generated.')
