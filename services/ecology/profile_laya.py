"""Laya 推理剖析与数值基线：重放 real-smoke-01 记录的真实请求，分解耗时并比较概率输出。
只读取既有证据，不修改；结果写到 experiments/perf/。不训练，不改世界。"""
import argparse
import json
import statistics
import sys
import time
from pathlib import Path
from provider import EcologyProvider, encode
from bridge import ROOT

parser = argparse.ArgumentParser()
parser.add_argument('--source', default='experiments/ecology/evidence/real-smoke-01/decisions.jsonl')
parser.add_argument('--output', required=True)
parser.add_argument('--repeats', type=int, default=2)
args = parser.parse_args()
rows = [json.loads(line) for line in (ROOT / args.source).read_text().splitlines()]
provider = EcologyProvider()
agent = provider.agent
from laya.common import build_sequence

def phases(requests):
    t = time.perf_counter(); enc = [encode(r) for r in requests]; t_encode = time.perf_counter() - t
    t = time.perf_counter()
    for state, questions, _ in enc:
        internal = agent._to_internal(questions['action'])
        build_sequence(agent.tok, state, internal, max_len=100000, head_max_len=100000)
        build_sequence(agent.tok, state, internal, max_len=1024, head_max_len=256)
    return t_encode, time.perf_counter() - t

report = {'model': provider.metadata(), 'source': args.source, 'rounds': []}
provider.predict(rows[0]['requests'])  # 预热，不计入
for index, row in enumerate(rows):
    requests, recorded = row['requests'], row['records']
    t_encode, t_tokenize = phases(requests)
    totals, diffs, same_action = [], [], True
    for _ in range(args.repeats):
        t = time.perf_counter(); records = provider.predict(requests); totals.append(time.perf_counter() - t)
    for new, old in zip(records, recorded):
        a, b = new['proposal']['distribution'], old['proposal']['distribution']
        diffs.append(max(abs(a[k] - b[k]) for k in b)); same_action &= new['proposal']['action'] == old['proposal']['action']
    report['rounds'].append({'round': index, 'agents': len(requests), 'encode_ms': t_encode * 1000, 'tokenize_x2_ms': t_tokenize * 1000,
        'predict_total_ms': statistics.median(totals) * 1000, 'model_batch_ms': records[0]['batch_ms'], 'max_prob_diff_vs_recorded': max(diffs), 'same_actions': same_action})
    print(json.dumps(report['rounds'][-1]), flush=True)
r = report['rounds']
report['summary'] = {k: statistics.median(x[k] for x in r) for k in ('encode_ms', 'tokenize_x2_ms', 'predict_total_ms', 'model_batch_ms')}
report['summary']['max_prob_diff_vs_recorded'] = max(x['max_prob_diff_vs_recorded'] for x in r)
report['summary']['all_same_actions'] = all(x['same_actions'] for x in r)
Path(args.output).write_text(json.dumps(report, indent=2)); print(json.dumps(report['summary']), flush=True)
