"""诊断：(1) 管线能否复现 laya-embed-v1 里已缓存的向量；(2) 线索句子的原始 1024 维平均池化向量（不经 PCA）。"""
import json, sys
from pathlib import Path
import numpy as np, torch
sys.path.insert(0, '.')
from provider import EcologyProvider
root = Path('../../'); doc = json.load(open(root / 'packages/evo/cues.json'))
rows = [(t, s, sp) for s in 'ABC' for sp in ('train', 'eval') for t in doc[s][sp]] + [(t, 'noise', 'noise') for t in doc['noise']]
cached = [json.loads(l) for _, l in zip(range(5), open(root / 'experiments/evo/laya-embed-v1/test.jsonl'))]
provider = EcologyProvider(); a = provider.agent; tok = a.tok
def embed(texts):
    vecs = []
    with torch.no_grad():
        for i in range(0, len(texts), 16):
            enc = tok(texts[i:i + 16], padding=True, truncation=True, max_length=128, return_tensors='pt')
            ids, mask = enc['input_ids'].to(a.device), enc['attention_mask'].to(a.device)
            with torch.autocast(device_type=a.device.type, dtype=torch.float16):
                h = a.model.encoder(input_ids=ids, attention_mask=mask).last_hidden_state.float()
            m = mask.unsqueeze(-1).float(); vecs.append(((h * m).sum(1) / m.sum(1)).cpu().numpy())
    return np.concatenate(vecs)
pca = np.load(root / 'experiments/evo/laya-embed-v1/pca.npz'); mean, comps = pca['mean'], pca['components']
P = (embed([c['text'] for c in cached]) - mean) @ comps.T; P /= np.linalg.norm(P, axis=1, keepdims=True)
print('reproduce max abs diff vs cache:', float(np.abs(P - np.array([c['v'] for c in cached])).max()))
X = embed([r[0] for r in rows]); np.savez(root / 'experiments/evo/cue-probe-01/cues-raw.npz', X=X, state=np.array([r[1] for r in rows]), split=np.array([r[2] for r in rows]), text=np.array([r[0] for r in rows]))
print('raw saved', X.shape)
