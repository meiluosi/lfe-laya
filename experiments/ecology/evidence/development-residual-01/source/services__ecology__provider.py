"""共享生态的固定 Laya 适配器。白名单局部输入，不持有世界或训练参数。"""
import copy
import hashlib
import json
import math
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'services/m0'))
from laya_provider import LayaProvider

TEMPLATE_VERSION = 'ecology-local-en-v1'
ACTIONS = ('north', 'east', 'south', 'west', 'eat', 'rest', 'reproduce')


def encode(request, memory=True):
    if set(request) != {'identity', 'observation', 'candidates'}:
        raise ValueError('request_schema')
    identity = request['identity']
    if set(identity) != {'protocol', 'runId', 'generation', 'epoch', 'decisionId', 'attemptId', 'tick', 'snapshotId', 'agentId'} or identity['protocol'] != 'ecology-decision-v1':
        raise ValueError('identity_schema')
    o = request['observation']
    if set(o) != {'energy', 'capacity', 'age', 'traits', 'heading', 'lastAction', 'lastRejected', 'costs', 'local', 'neighbors', 'memory'}:
        raise ValueError('observation_schema')
    finite = lambda x: isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)
    if not all(finite(o[k]) for k in ('energy', 'capacity', 'age', 'heading')) or o['capacity'] <= 0 or not 0 <= o['energy'] <= o['capacity'] or o['age'] < 0:
        raise ValueError('self_state')
    if o['lastAction'] not in ACTIONS or type(o['lastRejected']) is not bool:
        raise ValueError('action_state')
    if set(o['traits']) != {'size', 'speed', 'perception', 'metabolism'} or not all(finite(v) and v > 0 for v in o['traits'].values()) or o['traits']['perception'] > 4:
        raise ValueError('traits')
    if set(o['costs']) != {'metabolismPerTick', 'movementPerUnit', 'decisionTicks', 'bitePerTick'} or not all(finite(v) and v >= 0 for v in o['costs'].values()):
        raise ValueError('costs')
    if not 1 <= o['costs']['decisionTicks'] <= 100 or not 1 <= len(o['local']) <= 49 or len(o['memory']) > 16 or len(o['neighbors']) > 8:
        raise ValueError('observation_budget')
    for cell in o['local']:
        if set(cell) != {'dx', 'dy', 'food', 'blocked'} or not all(finite(cell[k]) for k in ('dx', 'dy', 'food')) or cell['food'] < 0 or abs(cell['dx']) + abs(cell['dy']) > o['traits']['perception'] + 1e-7 or type(cell['blocked']) is not bool or (cell['blocked'] and cell['food'] != 0):
            raise ValueError('local_cell')
    for item in o['memory']:
        if set(item) != {'dx', 'dy', 'food', 'stepsAgo'} or not all(finite(v) for v in item.values()) or item['food'] < 0 or item['stepsAgo'] < 0:
            raise ValueError('memory')
    for item in o['neighbors']:
        if set(item) != {'dx', 'dy', 'shape'} or not all(finite(v) for v in item.values()) or item['shape'] not in (0, 1, 2) or math.hypot(item['dx'], item['dy']) > o['traits']['perception'] + 1e-7:
            raise ValueError('neighbor')
    candidates = request['candidates']
    if not 1 <= len(candidates) <= 7 or len({c['id'] for c in candidates}) != len(candidates) or 'rest' not in {c['id'] for c in candidates}:
        raise ValueError('candidate_set')
    for item in candidates:
        if set(item) != {'id', 'dx', 'dy', 'description'} or item['id'] not in ACTIONS or not all(finite(item[k]) for k in ('dx', 'dy')) or not isinstance(item['description'], str) or not 1 <= len(item['description']) <= 250:
            raise ValueError('candidate_schema')

    def location(dx, dy):
        if abs(dx) < .51 and abs(dy) < .51:
            return 'your current cell'
        parts = []
        if abs(dy) >= .05: parts.append(f"{abs(dy):.1f} units {'south' if dy > 0 else 'north'}")
        if abs(dx) >= .05: parts.append(f"{abs(dx):.1f} units {'east' if dx > 0 else 'west'}")
        return ' and '.join(parts) or 'your current cell'

    costs = o['costs']
    text = [f"You are a creature with {o['energy']:.2f} of {o['capacity']:.2f} energy. Age: {o['age']} simulation ticks.",
            f"Each decision lasts {costs['decisionTicks']} ticks. Resting consumes {costs['metabolismPerTick'] * costs['decisionTicks']:.3f} energy. Moving also costs {costs['movementPerUnit']:.3f} per unit. Rest does not restore energy.",
            f"Eating transfers up to {costs['bitePerTick']:.2f} food energy per tick into your body. You must reach food before eating. Other creatures may consume it first.",
            f"Your last action was {o['lastAction']}; execution was {'blocked or depleted' if o['lastRejected'] else 'not rejected'}." ]
    food = [c for c in o['local'] if not c['blocked'] and c['food'] >= .01]
    # 明确量化精度；未显示的 <0.01 能量并非不可观察，原始观测仍完整记录。
    text.append('Visible food (rounded to 0.01; amounts below 0.01 omitted): ' + ('; '.join(f"{c['food']:.2f} at {location(c['dx'], c['dy'])}" for c in food) if food else 'none above 0.01') + '.')
    walls = [c for c in o['local'] if c['blocked']]
    if walls: text.append('Visible walls: ' + '; '.join(location(c['dx'], c['dy']) for c in walls) + '.')
    if o['neighbors']: text.append('Nearby creatures: ' + '; '.join(location(n['dx'], n['dy']) for n in o['neighbors']) + '.')
    if memory and o['memory']:
        text.append('Remembered food may be gone: ' + '; '.join(f"{m['food']:.2f} at {location(m['dx'], m['dy'])}, {m['stepsAgo']} ticks ago" for m in o['memory']) + '.')
    labels = {f'option_{i}': c['id'] for i, c in enumerate(candidates)}
    questions = {'action': {'type': 'choice', 'instructions': 'Choose one action to obtain food, survive and reproduce when affordable. Use only the observations. Eating requires food in your current cell.',
                             'criteria': {label: candidates[i]['description'] for i, label in enumerate(labels)}}}
    return ' '.join(text), questions, labels


class EcologyProvider(LayaProvider):
    def metadata(self):
        return {**super().metadata(), 'template': TEMPLATE_VERSION, 'observation_precision': 'food:0.01, distance:0.1; raw observation retained'}

    def predict(self, requests, memory=True):
        import torch
        from laya.common import build_sequence
        if not 1 <= len(requests) <= 64: raise ValueError('batch_budget')
        records = [None] * len(requests)
        groups = {}
        for i, request in enumerate(requests):
            state, questions, labels = encode(request, memory)
            internal = self.agent._to_internal(questions['action'])
            full, _ = build_sequence(self.agent.tok, state, internal, max_len=100000, head_max_len=100000)
            bounded, _ = build_sequence(self.agent.tok, state, internal, max_len=1024, head_max_len=256)
            if full != bounded: raise ValueError('model_input_would_be_truncated')
            groups.setdefault(json.dumps(questions, sort_keys=True), []).append((i, state, questions, labels))
        for group in groups.values():
            started = time.perf_counter()
            raw = self.agent.predict_batch([x[1] for x in group], group[0][2], batch_size=min(len(group),getattr(self,'max_batch',64)), max_len=1024, head_max_len=256)
            if str(self.agent.device) == 'mps': torch.mps.synchronize()
            elapsed = (time.perf_counter() - started) * 1000
            if str(self.agent.device) != self.requested_device or self.agent.cpu_fallback_count: raise RuntimeError('unexpected_cpu_fallback')
            if len(raw) != len(group): raise RuntimeError('incomplete_model_batch')
            for (i, state, questions, labels), result in zip(group, raw):
                usage = result.get('usage', {})
                if usage.get('truncated') or usage.get('options'): raise RuntimeError('model_input_truncated')
                probabilities = result['answers']['action']['probabilities']
                if set(probabilities) != set(labels) or any(not isinstance(v, (int, float)) or not math.isfinite(v) or not 0 <= v <= 1 for v in probabilities.values()): raise RuntimeError('invalid_model_distribution')
                total = sum(probabilities.values())
                if not .99 < total < 1.01: raise RuntimeError('invalid_probability_sum')
                distribution = {labels[k]: v / total for k, v in probabilities.items()}
                payload = {'state': state, 'questions': questions}
                records[i] = {'proposal': {'identity': copy.deepcopy(requests[i]['identity']), 'provider': 'laya', 'action': labels[result['answers']['action']['choice']], 'distribution': distribution},
                              'input': payload, 'raw_output': result, 'metadata': self.metadata(),
                              'input_sha256': hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest(),
                              'batch_ms': elapsed, 'batch_size': min(len(group),getattr(self,'max_batch',64)), 'logical_batch_size':len(group), 'amortized_ms': elapsed / len(group)}
        return records
