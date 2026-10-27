"""向固定 Laya 对每条环境线索句提 5 个固定的二选一问题（两种选项顺序各一次取平均），得到 5 维“语义特征”（每维 = 选第一个选项的概率）。
问题与措辞在看到任何结果前固定（设计见 docs/DESIGN_SEMANTIC_CONTEXT.md §12 的选项 B），不调整。
用法：python cue_questions.py <cues.json> <输出 jsonl>"""
import json
import sys
from pathlib import Path
from provider import EcologyProvider

QUESTIONS = [
    ('temperature', 'Is the air around the creature warm or cold?', 'It is warm here.', 'It is cold here.'),
    ('wetness', 'Is the ground around the creature wet or dry?', 'The ground is wet.', 'The ground is dry.'),
    ('wind', 'Is the air around the creature windy or still?', 'It is windy.', 'The air is still.'),
    ('fog', 'Is the creature surrounded by fog and haze, or is the view clear?', 'There is fog or haze.', 'The view is clear.'),
    ('light', 'Does the light look strange and unnatural, or ordinary?', 'The light looks strange.', 'The light looks ordinary.'),
]
doc = json.load(open(sys.argv[1]))
rows = [(t, s, sp) for s in 'ABC' for sp in ('train', 'eval') for t in doc[s][sp]] + [(t, 'noise', 'noise') for t in doc['noise']]
agent = EcologyProvider().agent
def state(text): return f"A small creature is standing in an open field. Here is how the weather and surroundings feel to it: {text}"
def ask(texts, instr, first, second, flip):
    opts = [second, first] if flip else [first, second]
    q = {'a': {'type': 'choice', 'instructions': instr, 'criteria': {f'option_{i}': o for i, o in enumerate(opts)}}}
    res = agent.predict_batch([state(t) for t in texts], q, batch_size=len(texts), max_len=1024, head_max_len=256); out = []
    for r in res:
        if r.get('usage', {}).get('truncated'): raise RuntimeError('truncated')
        p = r['answers']['a']['probabilities']; z = sum(p.values()); pf = p['option_1' if flip else 'option_0'] / z; out.append(pf)
    return out
texts = [r[0] for r in rows]; feats = [[] for _ in rows]
for name, instr, first, second in QUESTIONS:
    a, b = ask(texts, instr, first, second, False), ask(texts, instr, first, second, True)
    for i in range(len(rows)): feats[i].append((a[i] + b[i]) / 2)
    print(json.dumps({'question': name, 'forward_reverse_corr': float(__import__('numpy').corrcoef(a, b)[0, 1])}), flush=True)
with open(sys.argv[2], 'w') as w:
    for (t, s, sp), f in zip(rows, feats): w.write(json.dumps({'text': t, 'state': s, 'split': sp, 'p': [round(x, 4) for x in f]}) + '\n')
