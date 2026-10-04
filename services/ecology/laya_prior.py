"""预计算固定 Laya 对每个语义食物描述词的先验（P(吃)）。系统 1 的判断只取决于描述文本，所以可以缓存：
进化沙盒用的是这张表里 Laya 的真实输出，不是代理模型。两种选项顺序各问一次并平均，抵消位置偏置。"""
import argparse
import hashlib
import json
import statistics
import time
from pathlib import Path
from provider import EcologyProvider

TEMPLATE = 'semantic-prior-v1'
parser = argparse.ArgumentParser(); parser.add_argument('output'); args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
descriptors_path = root / 'packages/evo/semantic-descriptors.json'; descriptors = json.loads(descriptors_path.read_text())
provider = EcologyProvider(); agent = provider.agent
def state(text, energy=18): return f"You are a hungry creature with {energy:.1f} of 40.0 energy. In front of you is a {text}. Eating something harmful would cost you energy; eating something nutritious would restore it."
LABELS = {'eat': 'Eat it: it looks safe and nutritious.', 'avoid': 'Avoid it: it looks harmful or spoiled.'}
def ask(order):
    q = {'a': {'type': 'choice', 'instructions': 'Should the creature eat the thing in front of it?', 'criteria': {f'option_{i}': LABELS[k] for i, k in enumerate(order)}}}
    states = [state(d['text']) for d in descriptors]; out = []
    for i in range(0, len(states), 48):
        for r in agent.predict_batch(states[i:i + 48], q, batch_size=48, max_len=1024, head_max_len=256):
            if r.get('usage', {}).get('truncated'): raise RuntimeError('truncated')
            p = r['answers']['a']['probabilities']; t = sum(p.values()); out.append({order[int(k.split('_')[1])]: v / t for k, v in p.items()}['eat'])
    return out
t0 = time.perf_counter(); fwd = ask(['eat', 'avoid']); rev = ask(['avoid', 'eat'])
priors = {d['text']: {'split': d['split'], 'pEatForward': fwd[i], 'pEatReverse': rev[i], 'pEat': (fwd[i] + rev[i]) / 2} for i, d in enumerate(descriptors)}
def auc(items):
    pos = [p for p, y in items if y]; neg = [p for p, y in items if not y]; return sum((a > b) + .5 * (a == b) for a in pos for b in neg) / (len(pos) * len(neg))
GOOD_WORDS = None
report = {}
for split in ['train', 'test']:
    # 描述词的“常识标签”来自词表：词表里 good 短语为可吃。这里用 packages/evo/semantic-vocab.json 重建。
    vocab = json.loads((root / 'packages/evo/semantic-vocab.json').read_text()); good = set(vocab['good'][split])
    items = [(priors[d['text']]['pEat'], any(d['text'].startswith(g + ' ') for g in good)) for d in descriptors if d['split'] == split]
    report[split] = {'n': len(items), 'auc': round(auc(items), 4), 'accuracy@0.5': round(statistics.mean((p > .5) == y for p, y in items), 4), 'meanPEatEdible': round(statistics.mean(p for p, y in items if y), 3), 'meanPEatHarmful': round(statistics.mean(p for p, y in items if not y), 3)}
nons = [priors[d['text']]['pEat'] for d in descriptors if d['split'] == 'nonsense']; report['nonsense'] = {'n': len(nons), 'meanPEat': round(statistics.mean(nons), 3), 'stdev': round(statistics.pstdev(nons), 3)}
doc = {'template': TEMPLATE, 'model': provider.metadata(), 'descriptorsSha256': hashlib.sha256(descriptors_path.read_bytes()).hexdigest(), 'seconds': round(time.perf_counter() - t0, 1),
       'orders': ['eat,avoid', 'avoid,eat'], 'report': report, 'priors': priors, 'note': '先验是 Laya 对描述文本的真实输出（两种顺序平均）。语义标签按常识词表；nonsense 无标签。'}
Path(args.output).write_text(json.dumps(doc, indent=1, ensure_ascii=False)); print(json.dumps({'report': report, 'seconds': doc['seconds']}, indent=2))
