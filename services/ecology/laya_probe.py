"""固定 Laya 的反事实能力诊断：在受控世界里把食物放到个体周围各相对位置，看动作偏好是否朝向食物。
纯模型能力测试：不执行动作、不训练、不产生世界轨迹；真实 Laya（MPS）。结果只说明这个提示模板下的偏好，不说明生存收益。"""
import argparse
import json
import math
import statistics
import sys
from pathlib import Path
from provider import EcologyProvider

parser = argparse.ArgumentParser()
parser.add_argument('output')
parser.add_argument('--energies', default='8,30')
parser.add_argument('--amounts', default='2,6,12')
parser.add_argument('--order', default='forward', choices=['forward', 'reverse'], help='候选顺序：reverse 用于区分标签偏置与位置偏置')
args = parser.parse_args()
out = Path(args.output); out.mkdir(parents=True, exist_ok=False)
energies = [float(x) for x in args.energies.split(',')]; amounts = [float(x) for x in args.amounts.split(',')]
from probe_scenes import MOVES, sensible, build_scenes
scenes = build_scenes(energies, amounts)
provider = EcologyProvider()
if args.order == 'reverse':
    for sc in scenes: sc['request']['candidates'] = list(reversed(sc['request']['candidates']))
records = []
for i in range(0, len(scenes), 48): records.extend(provider.predict([s['request'] for s in scenes[i:i + 48]], memory=True))
rows = []
for sc, rec in zip(scenes, records):
    dist = rec['proposal']['distribution']; legal = set(dist)
    row = {'kind': sc['kind'], 'energy': sc['energy'], 'amount': sc['amount'], 'cell': sc['cell'], 'argmax': rec['proposal']['action'], 'distribution': dist}
    if sc['kind'] == 'food':
        good = sensible(*sc['cell'], legal); row['sensible'] = sorted(good)
        row['sensibleMass'] = sum(dist[a] for a in good); row['uniformMass'] = len(good) / len(legal); row['argmaxSensible'] = rec['proposal']['action'] in good
        row['distance'] = math.hypot(*sc['cell'])
    rows.append(row)
food = [r for r in rows if r['kind'] == 'food']; nofood = [r for r in rows if r['kind'] == 'no-food']
def mean(xs): return round(statistics.mean(xs), 4) if xs else None
by_distance = {}
for r in food: by_distance.setdefault(round(r['distance']), []).append(r)
here = [r for r in food if r['distance'] < .5]
summary = {
    'order': args.order, 'modelCalls': len(records), 'scenes': len(rows), 'model': provider.metadata(),
    'foodScenes': len(food), 'sensibleMassMean': mean([r['sensibleMass'] for r in food]), 'uniformMassMean': mean([r['uniformMass'] for r in food]),
    'argmaxSensibleRate': mean([r['argmaxSensible'] for r in food]),
    'byDistance': {str(k): {'n': len(v), 'sensibleMass': mean([r['sensibleMass'] for r in v]), 'uniform': mean([r['uniformMass'] for r in v]), 'argmaxSensible': mean([r['argmaxSensible'] for r in v])} for k, v in sorted(by_distance.items())},
    'foodHere': {'n': len(here), 'meanPEat': mean([r['distribution'].get('eat', 0) for r in here]), 'byEnergy': {str(e): mean([r['distribution'].get('eat', 0) for r in here if r['energy'] == e]) for e in energies}},
    'noFoodBias': {'n': len(nofood), 'meanDistribution': {a: mean([r['distribution'].get(a, 0) for r in nofood]) for a in ['north', 'east', 'south', 'west', 'eat', 'rest']}},
    'directionBias': {a: mean([r['distribution'].get(a, 0) for r in food]) for a in ['north', 'east', 'south', 'west', 'eat', 'rest']},
    'limits': '受控单食物场景；只测偏好方向，不测生存。单一提示模板 ecology-local-en-v1。',
}
# 方向对称性：食物在 (dx,dy) 与镜像位置 (dx,-dy)/( -dx,dy) 时，朝向概率应互换
def lookup(e, amount, cell): return next((r for r in food if r['energy'] == e and r['amount'] == amount and r['cell'] and abs(r['cell'][0] - cell[0]) < .31 and abs(r['cell'][1] - cell[1]) < .31), None)
sym = []
for r in food:
    if abs(r['cell'][1]) >= 1 and abs(r['cell'][0]) < .6:
        m = lookup(r['energy'], r['amount'], [r['cell'][0], -r['cell'][1]])
        if m: sym.append(abs(r['distribution']['north'] - m['distribution']['south']) if r['cell'][1] < 0 else abs(r['distribution']['south'] - m['distribution']['north']))
summary['mirrorNorthSouthMeanAbsDiff'] = mean(sym)
(out / 'raw.json').write_text(json.dumps({'rows': rows}, indent=1)); (out / 'summary.json').write_text(json.dumps(summary, indent=2, ensure_ascii=False))
print(json.dumps(summary, indent=2, ensure_ascii=False))
