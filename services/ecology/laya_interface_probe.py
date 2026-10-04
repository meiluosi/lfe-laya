"""比较向固定 Laya 提问的几种方式，在同一批受控场景上用“朝食物”作为判据。
指标：AUC（朝食物的动作得分高于不朝食物动作的概率，0.5 为随机）、朝食物概率质量对均匀、最高分动作命中率。
这是模型接口诊断：不执行动作、不训练，不构成生存收益证据。"""
import argparse
import json
import math
import statistics
from pathlib import Path
from probe_scenes import MOVES, sensible, build_scenes  # 必须先于 provider：provider 会把 services/m0 放到搜索路径最前，其同名 bridge 会遮蔽本目录的 bridge
from provider import EcologyProvider, encode

parser = argparse.ArgumentParser(); parser.add_argument('output'); args = parser.parse_args()
out = Path(args.output); out.mkdir(parents=True, exist_ok=False)
scenes = build_scenes(); provider = EcologyProvider(); agent = provider.agent
ACTIONS = ['north', 'east', 'south', 'west', 'eat', 'rest']

def batch_predict(states, questions):
    results = []
    for i in range(0, len(states), 24):
        r = agent.predict_batch(states[i:i + 24], questions, batch_size=24, max_len=1024, head_max_len=256)
        for x in r:
            if x.get('usage', {}).get('truncated') or x.get('usage', {}).get('options'): raise RuntimeError('truncated')
        results.extend(r)
    return results

def states_of(requests): return [encode(r)[0] for r in requests]

def choice_scores(requests, order):
    """原始多选题：order 为候选排列函数；返回每个场景的 {动作: 概率}。"""
    reqs = []
    for r in requests:
        c = list(r['candidates']); c = order(c); q = dict(r); q['candidates'] = c; reqs.append(q)
    encoded = [encode(r) for r in reqs]; groups = {}
    for i, (state, questions, labels) in enumerate(encoded): groups.setdefault(json.dumps(questions, sort_keys=True), []).append(i)
    scores = [None] * len(reqs)
    for idxs in groups.values():
        res = batch_predict([encoded[i][0] for i in idxs], encoded[idxs[0]][1])
        for i, x in zip(idxs, res):
            p = x['answers']['action']['probabilities']; labels = encoded[i][2]; t = sum(p.values())
            scores[i] = {labels[k]: v / t for k, v in p.items()}
    return scores

def noul_scores(requests):
    """逐动作是非题：每个合法动作单独问“这是不是好选择”，得分 = P(是)；与选项位置无关。"""
    scores = [None] * len(requests); groups = {}
    for i, r in enumerate(requests): groups.setdefault(tuple(c['id'] for c in r['candidates']), []).append(i)
    for ids, idxs in groups.items():
        desc = {c['id']: c['description'] for c in requests[idxs[0]]['candidates']}
        questions = {a: {'type': 'noul', 'instructions': f'The creature wants to obtain food and survive. Is the following a good action for it right now? Action: {desc[a]}'} for a in ids}
        res = batch_predict(states_of([requests[i] for i in idxs]), questions)
        for i, x in zip(idxs, res): scores[i] = {a: x['answers'][a]['noul'] for a in ids}
    return scores

def direction_scores(requests, order):
    """多选题“最近的食物在哪个方向”，再映射为动作得分：朝向 north/east/south/west，here → eat，none → rest。"""
    labels = ['north', 'east', 'south', 'west', 'here', 'none']
    texts = {'north': 'The nearest visible food is to the north.', 'east': 'The nearest visible food is to the east.', 'south': 'The nearest visible food is to the south.',
             'west': 'The nearest visible food is to the west.', 'here': 'The nearest food is in the creature\'s current cell.', 'none': 'No food is visible.'}
    ordered = order(labels); keys = {f'option_{i}': l for i, l in enumerate(ordered)}
    questions = {'where': {'type': 'choice', 'instructions': 'Where is the nearest visible food relative to the creature?', 'criteria': {f'option_{i}': texts[l] for i, l in enumerate(ordered)}}}
    res = batch_predict(states_of(requests), questions); out_scores = []
    for r, x in zip(requests, res):
        p = x['answers']['where']['probabilities']; t = sum(p.values()); d = {keys[k]: v / t for k, v in p.items()}
        legal = [c['id'] for c in r['candidates']]
        mapped = {a: d[a] for a in ['north', 'east', 'south', 'west'] if a in legal}
        if 'eat' in legal: mapped['eat'] = d['here']
        if 'rest' in legal: mapped['rest'] = d['none']
        out_scores.append(mapped)
    return out_scores

def cyclic(k): return lambda xs: xs[k:] + xs[:k]
def average(list_of_scores):
    return [{a: statistics.mean(s[i][a] for s in list_of_scores) for a in list_of_scores[0][i]} for i in range(len(list_of_scores[0]))]

requests = [s['request'] for s in scenes]
variants = {}
variants['V0 原始多选·固定顺序'] = choice_scores(requests, cyclic(0))
variants['V0r 原始多选·反序'] = choice_scores(requests, lambda xs: list(reversed(xs)))
variants['V1 原始多选·4 个循环顺序平均'] = average([choice_scores(requests, cyclic(k)) for k in range(4)])
variants['V2 逐动作是非题'] = noul_scores(requests)
variants['V3 方向多选题·固定顺序'] = direction_scores(requests, lambda xs: xs)
variants['V3r 方向多选题·反序'] = direction_scores(requests, lambda xs: list(reversed(xs)))
variants['V3a 方向多选题·两个顺序平均'] = average([variants['V3 方向多选题·固定顺序'], variants['V3r 方向多选题·反序']])

def auc(pairs):
    pos = [s for s, y in pairs if y]; neg = [s for s, y in pairs if not y]
    if not pos or not neg: return None
    wins = sum((p > n) + .5 * (p == n) for p in pos for n in neg); return wins / (len(pos) * len(neg))
summary = {'scenes': len(scenes), 'model': provider.metadata(), 'variants': {}}
for name, scores in variants.items():
    pairs = []; mass = []; uni = []; top = []; byd = {}
    for sc, sc_scores in zip(scenes, scores):
        if sc['kind'] != 'food': continue
        legal = set(sc_scores); good = sensible(*sc['cell'], legal)
        z = sum(sc_scores.values()) or 1; norm = {a: v / z for a, v in sc_scores.items()}
        pairs.extend((sc_scores[a], a in good) for a in legal); mass.append(sum(norm[a] for a in good)); uni.append(len(good) / len(legal))
        top.append(max(sc_scores, key=sc_scores.get) in good)
        byd.setdefault(round(math.hypot(*sc['cell'])), []).append(pairs[-len(legal):])
    summary['variants'][name] = {'auc': round(auc(pairs), 4), 'sensibleMass': round(statistics.mean(mass), 4), 'uniformMass': round(statistics.mean(uni), 4), 'argmaxSensible': round(statistics.mean(top), 4),
        'aucByDistance': {str(k): round(auc([p for ps in v for p in ps]), 4) for k, v in sorted(byd.items())}}
# 无食物场景的偏置（V3）：“none”是否被识别
summary['noFood'] = {n: round(statistics.mean(s['rest'] if 'rest' in s else 0 for sc, s in zip(scenes, scores) if sc['kind'] == 'no-food'), 4) for n, scores in variants.items() if n.startswith('V3')}
(out / 'summary.json').write_text(json.dumps(summary, indent=2, ensure_ascii=False)); print(json.dumps({k: v for k, v in summary.items() if k != 'model'}, indent=2, ensure_ascii=False))
