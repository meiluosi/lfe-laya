"""事后描述性诊断，不用于替换预定学习收益判据。"""
import argparse,collections,json,statistics
from bridge import ROOT

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('run');args=parser.parse_args();source=ROOT/args.run
    rows=collections.defaultdict(list)
    for line in (source/'online-decisions.jsonl').read_text().splitlines():
        row=json.loads(line)
        if 'transition' in row:rows[row['id']].append(row)
    reverse={'north':'south','south':'north','east':'west','west':'east'}
    result=[]
    for identifier,trajectory in rows.items():
        actions=[r['transition']['action'] for r in trajectory]
        reversals=sum(reverse.get(a)==b for a,b in zip(actions,actions[1:]))
        edible=[]
        for row in trajectory:
            t=row['transition'];r=t['request'];o=r['observation']
            if o['energy']<=o['capacity']-5 and any(c['id']=='eat' for c in r['candidates']):edible.append(t)
        final=trajectory[-1]['transition']
        result.append({'id':identifier,'mode':trajectory[0]['mode'],'steps':len(actions),'actions':dict(collections.Counter(actions)),
            'immediate_move_reversals':reversals,'eligible_full_bite_steps':len(edible),
            'eligible_full_bite_taken':sum(t['action']=='eat' for t in edible),
            'final_environment_food':sum(final['snapshot']['food']),'death':final['terminated']})
    payload={'scope':'post-hoc descriptive diagnostics, not preregistered success metrics; all online seeds included','trajectories':result}
    (source/'behavior-diagnostics.json').write_text(json.dumps(payload,indent=2))
    print(json.dumps(result,indent=2))
