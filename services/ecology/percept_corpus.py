"""从真实模拟轨迹采集 Laya 方向感知语料。规则/随机控制器交替推进世界（只为产生多样观测，不是学习实验）；
每行含完整请求、Laya 方向概率、真值标签（评估用）。支持中断后续跑。"""
import argparse
import json
import sys
import time
from pathlib import Path
from bridge import Bridge  # 必须先于 percept/provider：provider 会把 services/m0 放到搜索路径最前
from percept import PerceptProvider, truth_label, PERCEPT_TEMPLATE

parser = argparse.ArgumentParser()
parser.add_argument('output'); parser.add_argument('--worlds', type=int, default=40); parser.add_argument('--rounds', type=int, default=50); parser.add_argument('--seed-base', type=int, default=9000)
args = parser.parse_args()
out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
corpus = out / 'corpus.jsonl'
done = {}
if corpus.exists():
    for line in corpus.open():
        row = json.loads(line); done[row['world']] = max(done.get(row['world'], -1), row['round'])
provider = PerceptProvider()
(out / 'manifest.json').write_text(json.dumps({'model': provider.metadata(), 'template': PERCEPT_TEMPLATE, 'worlds': args.worlds, 'rounds': args.rounds, 'seedBase': args.seed_base,
    'purpose': '感知语料：控制器仅用于产生多样观测；不是学习实验，不含生存结论'}, indent=2))
PRESETS = [{}, {'width': 16, 'height': 12, 'initialAgents': 8, 'reproduction': False, 'mutation': False, 'maxAge': 100000, 'horizon': 3600, 'phaseTicks': 1200, 'initialEnergy': 32, 'metabolism': .012, 'initialFood': 100, 'supplyAmount': 6, 'foodDecay': .003, 'diffusion': .002}]
started = time.perf_counter(); total = 0; GROUP = 8  # 多个世界同步推进，合并为大批次查询，提高 GPU 利用率
with Bridge() as b, corpus.open('a') as f:
    for g0 in range(0, args.worlds, GROUP):
        ids = list(range(g0, min(args.worlds, g0 + GROUP)))
        for w in ids:
            b.call('reset', id=f'w{w}', config={**PRESETS[(w // 2) % 2], 'runId': f'corpus-{args.seed_base + w}', 'seed': args.seed_base + w})
        alive = set(ids)
        for r in range(args.rounds):
            batch = []
            for w in sorted(alive):
                requests = b.call('observe', id=f'w{w}')
                if not requests: alive.discard(w); continue
                batch.append((w, requests))
            if not batch: break
            todo = [(w, req) for w, reqs in batch for req in reqs if r > done.get(w, -1)]
            if todo:
                records = provider.percept([req for _, req in todo], batch_size=64)
                for (w, request), rec in zip(todo, records):
                    f.write(json.dumps({'world': w, 'seed': args.seed_base + w, 'round': r, 'controller': 'rule' if w % 2 == 0 else 'random', 'request': request, 'truth': truth_label(request['observation']), **rec}) + '\n'); total += 1
                f.flush()
            for w, _ in batch:
                result = b.call('step', id=f'w{w}', proposals=b.call('controller', id=f'w{w}', mode='rule' if w % 2 == 0 else 'random'))
                if not result['accepted']: raise RuntimeError(result['reason'])
        print(json.dumps({'worlds': ids, 'rows': total, 'elapsed': round(time.perf_counter() - started), 'rowsPerSecond': round(total / max(1, time.perf_counter() - started), 2)}), flush=True)
