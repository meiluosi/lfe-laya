"""固定 Laya 的“感知问题”接口（系统 1）：只问“最近的可见食物在哪个方向”，不让它挑动作。
输入仍是白名单局部观测（与 provider.encode 相同的状态文本）；单次查询、固定标签顺序。
固定顺序存在对首位标签的固有偏置，由下游决策层（先天参数）校准，不在此处修正。"""
import hashlib
import json
import math
import time
from provider import EcologyProvider, encode

PERCEPT_TEMPLATE = 'ecology-percept-v1'
LABELS = ('north', 'east', 'south', 'west', 'here', 'none')
TEXTS = {'north': 'The nearest visible food is to the north.', 'east': 'The nearest visible food is to the east.', 'south': 'The nearest visible food is to the south.',
         'west': 'The nearest visible food is to the west.', 'here': "The nearest food is in the creature's current cell.", 'none': 'No food is visible.'}
QUESTION = {'where': {'type': 'choice', 'instructions': 'Where is the nearest visible food relative to the creature?',
                      'criteria': {f'option_{i}': TEXTS[label] for i, label in enumerate(LABELS)}}}

def truth_label(observation):
    """评估用真值：来自该个体自己的局部观测（不含隐藏信息）。不进入任何模型输入。"""
    food = [c for c in observation['local'] if not c['blocked'] and c['food'] >= .05]
    if not food: return 'none'
    c = min(food, key=lambda c: math.hypot(c['dx'], c['dy']))
    if math.hypot(c['dx'], c['dy']) < .5: return 'here'
    return ('south' if c['dy'] > 0 else 'north') if abs(c['dy']) >= abs(c['dx']) else ('east' if c['dx'] > 0 else 'west')

class PerceptProvider(EcologyProvider):
    def metadata(self): return {**super().metadata(), 'percept_template': PERCEPT_TEMPLATE}

    def percept(self, requests, batch_size=48):
        import torch
        records = []
        for start in range(0, len(requests), batch_size):
            chunk = requests[start:start + batch_size]
            states = [encode(r)[0] for r in chunk]; t = time.perf_counter()
            raw = self.agent.predict_batch(states, QUESTION, batch_size=len(chunk), max_len=1024, head_max_len=256)
            if str(self.agent.device) == 'mps': torch.mps.synchronize()
            elapsed = (time.perf_counter() - t) * 1000
            if str(self.agent.device) != self.requested_device or self.agent.cpu_fallback_count: raise RuntimeError('unexpected_cpu_fallback')
            if len(raw) != len(chunk): raise RuntimeError('incomplete_model_batch')
            for state, result in zip(states, raw):
                usage = result.get('usage', {})
                if usage.get('truncated') or usage.get('options'): raise RuntimeError('model_input_truncated')
                p = result['answers']['where']['probabilities']
                if set(p) != set(QUESTION['where']['criteria']) or any(not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0 for v in p.values()): raise RuntimeError('invalid_percept')
                total = sum(p.values())
                if not .99 < total < 1.01: raise RuntimeError('invalid_probability_sum')
                probs = [p[f'option_{i}'] / total for i in range(len(LABELS))]
                records.append({'probs': probs, 'labels': list(LABELS), 'input_sha256': hashlib.sha256(json.dumps({'state': state, 'question': QUESTION}, sort_keys=True).encode()).hexdigest(),
                                'batch_ms': elapsed, 'batch_size': len(chunk)})
        return records
