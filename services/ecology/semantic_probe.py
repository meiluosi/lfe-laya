"""Laya 的零样本语义直觉能力：给一个食物的自然语言描述，判断能不能吃。不接模拟器、不训练、不执行动作。
对照组使用没有语义的编造词（应接近随机），用来区分“语言先验”与提示格式带来的偏置。选项顺序两种都测并平均。"""
import argparse
import itertools
import json
import random
import statistics
import time
from pathlib import Path
from provider import EcologyProvider

parser = argparse.ArgumentParser(); parser.add_argument('output'); parser.add_argument('--n', type=int, default=120)
args = parser.parse_args()
out = Path(args.output); out.mkdir(parents=True, exist_ok=False)
rng = random.Random(7)
NOUNS = ['berry', 'fruit', 'nectar', 'seed', 'leaf', 'root', 'sap', 'mushroom', 'bud', 'moss', 'pollen', 'petal']
GOOD = ['ripe and sweet', 'fresh and juicy', 'plump and fragrant', 'golden and warm-smelling', 'soft, sweet-smelling', 'clean and nutritious', 'glossy, firm and ripe', 'honey-scented', 'tender and fresh']
BAD = ['rotten and foul-smelling', 'moldy and slimy', 'bitter and withered', 'covered in poisonous spots', 'shriveled, sour and decayed', 'oozing a sharp chemical stench', 'dull, spoiled and fuzzy with mold', 'bright with warning stripes and acrid', 'putrid and crawling with maggots']
SYLL = ['zor', 'blim', 'quen', 'trax', 'vul', 'mep', 'dro', 'siff', 'kel', 'nub', 'yar', 'pho']
def nonsense(): return ' '.join(rng.choice(SYLL) + rng.choice(SYLL) for _ in range(2)) + '-' + rng.choice(['colored', 'textured', 'shaped']) + ' ' + rng.choice(['lump', 'thing', 'bit', 'piece'])
items = []
for i in range(args.n):
    good = i % 2 == 0
    items.append({'kind': 'semantic', 'edible': good, 'text': f"{rng.choice(GOOD if good else BAD)} {rng.choice(NOUNS)}"})
for i in range(args.n):
    items.append({'kind': 'nonsense', 'edible': i % 2 == 0, 'text': nonsense()})   # 标签随机分配：无语义可依，期望 ≈ 随机
provider = EcologyProvider(); agent = provider.agent
def state(text, energy=18): return f"You are a hungry creature with {energy:.1f} of 40.0 energy. In front of you is a {text}. Eating something harmful would cost you energy; eating something nutritious would restore it."
def predict(states, questions):
    res = []
    for i in range(0, len(states), 48): res.extend(agent.predict_batch(states[i:i + 48], questions, batch_size=48, max_len=1024, head_max_len=256))
    return res
t0 = time.perf_counter(); states = [state(x['text']) for x in items]
noul = predict(states, {'safe': {'type': 'noul', 'instructions': 'Is this thing safe and nutritious to eat?'}})
for it, r in zip(items, noul): it['pNoul'] = r['answers']['safe']['noul']
def choice(order):
    labels = {'eat': 'Eat it: it looks safe and nutritious.', 'avoid': 'Avoid it: it looks harmful or spoiled.'}; ks = order
    q = {'a': {'type': 'choice', 'instructions': 'Should the creature eat the thing in front of it?', 'criteria': {f'option_{i}': labels[k] for i, k in enumerate(ks)}}}
    res = predict(states, q); outp = []
    for r in res:
        p = r['answers']['a']['probabilities']; t = sum(p.values()); outp.append({ks[int(k.split('_')[1])]: v / t for k, v in p.items()})
    return outp
c1 = choice(['eat', 'avoid']); c2 = choice(['avoid', 'eat'])
for it, a, b in zip(items, c1, c2): it['pEatFwd'] = a['eat']; it['pEatRev'] = b['eat']; it['pEatAvg'] = (a['eat'] + b['eat']) / 2
def auc(xs):
    pos = [x['s'] for x in xs if x['edible']]; neg = [x['s'] for x in xs if not x['edible']]
    return sum((p > n) + .5 * (p == n) for p in pos for n in neg) / (len(pos) * len(neg))
summary = {'items': len(items), 'seconds': round(time.perf_counter() - t0, 1), 'model': provider.metadata()}
for kind in ['semantic', 'nonsense']:
    sub = [x for x in items if x['kind'] == kind]
    summary[kind] = {'n': len(sub), 'auc_noul': round(auc([{'s': x['pNoul'], 'edible': x['edible']} for x in sub]), 4),
        'auc_choice_forward': round(auc([{'s': x['pEatFwd'], 'edible': x['edible']} for x in sub]), 4), 'auc_choice_reverse': round(auc([{'s': x['pEatRev'], 'edible': x['edible']} for x in sub]), 4),
        'auc_choice_orderAveraged': round(auc([{'s': x['pEatAvg'], 'edible': x['edible']} for x in sub]), 4),
        'accuracy_choice_orderAveraged': round(statistics.mean((x['pEatAvg'] > .5) == x['edible'] for x in sub), 4),
        'meanPEat': {'edible': round(statistics.mean(x['pEatAvg'] for x in sub if x['edible']), 3), 'harmful': round(statistics.mean(x['pEatAvg'] for x in sub if not x['edible']), 3)},
        'positionBias_meanPEatForward_vs_Reverse': [round(statistics.mean(x['pEatFwd'] for x in sub), 3), round(statistics.mean(x['pEatRev'] for x in sub), 3)]}
summary['limits'] = '模板化描述，英文；零样本；标签由描述词决定；只测语义直觉，不测生存。nonsense 的标签是随机分配的，用来测格式偏置。'
(out / 'items.json').write_text(json.dumps(items, indent=1, ensure_ascii=False)); (out / 'summary.json').write_text(json.dumps(summary, indent=2, ensure_ascii=False)); print(json.dumps(summary, indent=2, ensure_ascii=False))
