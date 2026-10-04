"""真实多体动作、原始输入输出、固定动作回放；不用于学习效果结论。"""
import argparse
import hashlib
import json
import time
from pathlib import Path
from bridge import Bridge, ROOT
from provider import EcologyProvider

parser = argparse.ArgumentParser()
parser.add_argument('output')
parser.add_argument('--rounds', type=int, default=8)
args = parser.parse_args()
out = Path(args.output); out.mkdir(parents=True, exist_ok=False)
provider = EcologyProvider()
config = {'runId': 'real-ecology-smoke', 'seed': 311, 'initialAgents': 8, 'reproduction': False, 'horizon': args.rounds * 10}
manifest = {'model': provider.metadata(), 'config': config, 'source': {}}
for path in ['packages/sim/ecology.ts', 'packages/protocol/ecology.ts', 'services/ecology/provider.py', 'services/ecology/smoke.py']:
    manifest['source'][path] = hashlib.sha256((ROOT / path).read_bytes()).hexdigest()
(out / 'manifest.json').write_text(json.dumps(manifest, indent=2))
started = time.perf_counter()
with Bridge() as bridge:
    initial = bridge.call('reset', config=config)
    (out / 'initial.json').write_text(json.dumps(initial['snapshot']))
    rows = []
    for step in range(args.rounds):
        requests = bridge.call('observe')
        records = provider.predict(requests)
        result = bridge.call('step', proposals=[r['proposal'] for r in records])
        if not result['accepted']: raise RuntimeError(result['reason'])
        row = {'requests': requests, 'records': records, 'result': result}; rows.append(row)
        with (out / 'decisions.jsonl').open('a') as f: f.write(json.dumps(row) + '\n')
        print(json.dumps({'round': step + 1, 'tick': result['snapshot']['tick'], 'living': len(result['snapshot']['agents']), 'actions': [r['proposal']['action'] for r in records]}), flush=True)
        if not result['snapshot']['agents']: break
    bridge.call('reset', id='replay', config=config)
    bridge.call('restore', id='replay', snapshot=initial['snapshot'])
    for row in rows:
        current = bridge.call('observe', id='replay')
        proposals = [{**old['proposal'], 'identity': request['identity']} for old, request in zip(row['records'], current)]
        replay = bridge.call('step', id='replay', proposals=proposals)
        if replay['snapshot'] != row['result']['snapshot']: raise RuntimeError('replay_mismatch')
    report = {'status': 'passed', 'real_model_decisions': sum(len(r['records']) for r in rows), 'rounds': len(rows), 'replay': 'all complete snapshots equal', 'elapsed_seconds_excluding_load': time.perf_counter() - started, 'model': provider.metadata()}
    (out / 'report.json').write_text(json.dumps(report, indent=2)); print(json.dumps(report), flush=True)
