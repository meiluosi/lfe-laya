"""导出固定 Laya 编码器对描述词池的向量（W5b 层次信念用）。只依赖文本，不用标签。
做法：对每条描述取平均池化隐状态（1024 维）→ 在训练方言池上拟合 PCA（只用训练池，避免把其他方言的信息放进降维）→ 投影到 DIM 维并 L2 归一化。
输出：<out_dir>/pca.npz（均值与主成分）与 <out_dir>/<dialect>.jsonl（每行 {"text","v"}，v 保留 4 位小数）。可断点续跑（按方言文件是否存在）。
用法：python embed_pool.py <out_dir> [dim=32]"""
import json
import sys
import time
from pathlib import Path
import numpy as np
import torch
from provider import EcologyProvider

out_dir = Path(sys.argv[1]); DIM = int(sys.argv[2]) if len(sys.argv) > 2 else 32
out_dir.mkdir(parents=True, exist_ok=True)
POOLS = Path(__file__).resolve().parents[2] / 'packages' / 'evo' / 'pools'
provider = EcologyProvider(); a = provider.agent; tok = a.tok


def embed(texts):
    vecs = []
    with torch.no_grad():
        for i in range(0, len(texts), 32):
            enc = tok(texts[i:i + 32], padding=True, truncation=True, max_length=128, return_tensors='pt')
            ids, mask = enc['input_ids'].to(a.device), enc['attention_mask'].to(a.device)
            with torch.autocast(device_type=a.device.type, dtype=torch.float16):
                h = a.model.encoder(input_ids=ids, attention_mask=mask).last_hidden_state.float()
            m = mask.unsqueeze(-1).float(); vecs.append(((h * m).sum(1) / m.sum(1)).cpu().numpy())
    return np.concatenate(vecs)


pca_path = out_dir / 'pca.npz'
raw_cache = {}
t0 = time.perf_counter()
if pca_path.exists():
    z = np.load(pca_path); mean, comps = z['mean'], z['components']
else:
    train = [e['text'] for e in json.load(open(POOLS / 'train.json'))]
    X = embed(train); raw_cache['train'] = X
    mean = X.mean(0); _, _, vt = np.linalg.svd(X - mean, full_matrices=False); comps = vt[:DIM]
    np.savez(pca_path, mean=mean, components=comps)
    print(json.dumps({'pca_fit_seconds': round(time.perf_counter() - t0, 1), 'dim': DIM}), flush=True)


def project(X):
    P = (X - mean) @ comps.T; return P / np.maximum(np.linalg.norm(P, axis=1, keepdims=True), 1e-9)


for dialect in ('train', 'test', 'heldout', 'factual'):
    f = out_dir / f'{dialect}.jsonl'
    path = POOLS / f'{dialect}.json'
    if f.exists() or not path.exists(): continue
    texts = [e['text'] for e in json.load(open(path))]
    X = raw_cache.get(dialect); X = embed(texts) if X is None else X
    P = project(X)
    with f.open('w') as w:
        for t, v in zip(texts, P): w.write(json.dumps({'text': t, 'v': [round(float(x), 4) for x in v]}) + '\n')
    print(json.dumps({'dialect': dialect, 'n': len(texts), 'seconds': round(time.perf_counter() - t0, 1)}), flush=True)
