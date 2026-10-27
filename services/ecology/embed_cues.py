"""导出固定 Laya 编码器对环境线索句子的向量（语义环境记忆设计的向量可分性探针用）。
做法与 embed_pool.py 完全相同：平均池化隐状态 → 用已有的 PCA（训练池拟合，不重新拟合）投影到 32 维 → L2 归一化。
用法：python embed_cues.py <embed_dir 含 pca.npz> <cues.json> <输出 jsonl>"""
import json
import sys
from pathlib import Path
import numpy as np
import torch
from provider import EcologyProvider

pca = np.load(Path(sys.argv[1]) / 'pca.npz'); mean, comps = pca['mean'], pca['components']
doc = json.load(open(sys.argv[2]))
rows = []
for s in 'ABC':
    for split in ('train', 'eval'):
        rows += [(t, s, split) for t in doc[s][split]]
rows += [(t, 'noise', 'noise') for t in doc['noise']]
provider = EcologyProvider(); a = provider.agent; tok = a.tok
texts = [r[0] for r in rows]; vecs = []
with torch.no_grad():
    for i in range(0, len(texts), 16):
        enc = tok(texts[i:i + 16], padding=True, truncation=True, max_length=128, return_tensors='pt')
        ids, mask = enc['input_ids'].to(a.device), enc['attention_mask'].to(a.device)
        with torch.autocast(device_type=a.device.type, dtype=torch.float16):
            h = a.model.encoder(input_ids=ids, attention_mask=mask).last_hidden_state.float()
        m = mask.unsqueeze(-1).float(); vecs.append(((h * m).sum(1) / m.sum(1)).cpu().numpy())
X = np.concatenate(vecs); P = (X - mean) @ comps.T; P = P / np.maximum(np.linalg.norm(P, axis=1, keepdims=True), 1e-9)
with open(sys.argv[3], 'w') as w:
    for (t, s, split), v in zip(rows, P): w.write(json.dumps({'text': t, 'state': s, 'split': split, 'v': [round(float(x), 4) for x in v]}) + '\n')
print(json.dumps({'n': len(rows), 'device': str(a.device)}))
