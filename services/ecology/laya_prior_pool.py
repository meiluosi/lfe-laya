"""对描述词池逐条询问固定 Laya（两种选项顺序各一次，取平均），增量写入 JSONL，可断点续跑。
先验只取决于描述文本，所以可缓存；进化沙盒用的是 Laya 的真实输出，不是代理模型。
用法：python laya_prior_pool.py <pool.json> <输出.jsonl>"""
import json
import sys
import time
from pathlib import Path
from provider import EcologyProvider

TEMPLATE = 'semantic-prior-pool-v1'
pool_path, out_path = Path(sys.argv[1]), Path(sys.argv[2])
pool = json.loads(pool_path.read_text()); out_path.parent.mkdir(parents=True, exist_ok=True)
done = set()
if out_path.exists():
    for line in out_path.open(): done.add(json.loads(line)['text'])
todo = [e['text'] for e in pool if e['text'] not in done]
print(json.dumps({'pool': len(pool), 'done': len(done), 'todo': len(todo)}), flush=True)
provider = EcologyProvider(); agent = provider.agent
def state(text, energy=18): return f"You are a hungry creature with {energy:.1f} of 40.0 energy. In front of you is this food: {text} Eating something harmful would cost you energy; eating something nutritious would restore it."
LABELS = {'eat': 'Eat it: it looks safe and nutritious.', 'avoid': 'Avoid it: it looks harmful or spoiled.'}
def ask(texts, order):
    q = {'a': {'type': 'choice', 'instructions': 'Should the creature eat the food in front of it?', 'criteria': {f'option_{i}': LABELS[k] for i, k in enumerate(order)}}}
    res = agent.predict_batch([state(t) for t in texts], q, batch_size=len(texts), max_len=1024, head_max_len=256); out = []
    for r in res:
        if r.get('usage', {}).get('truncated'): raise RuntimeError('truncated')
        p = r['answers']['a']['probabilities']; z = sum(p.values()); out.append({order[int(k.split('_')[1])]: v / z for k, v in p.items()}['eat'])
    return out
started = time.perf_counter()
with out_path.open('a') as f:
    for i in range(0, len(todo), 48):
        chunk = todo[i:i + 48]; fwd = ask(chunk, ['eat', 'avoid']); rev = ask(chunk, ['avoid', 'eat'])
        for t, a, b in zip(chunk, fwd, rev): f.write(json.dumps({'text': t, 'pEatForward': a, 'pEatReverse': b, 'pEat': (a + b) / 2}) + '\n')
        f.flush()
        if (i // 48) % 20 == 0: print(json.dumps({'done': len(done) + i + len(chunk), 'of': len(pool), 'seconds': round(time.perf_counter() - started)}), flush=True)
print(json.dumps({'finished': True, 'metadata': provider.metadata(), 'template': TEMPLATE, 'seconds': round(time.perf_counter() - started)}), flush=True)
