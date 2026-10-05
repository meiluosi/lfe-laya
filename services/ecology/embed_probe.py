"""Laya 编码器的描述向量是否带语义？取描述文本的平均池化隐状态，用 k 近邻（留一）预测营养/有毒。只读，不训练。"""
import json, sys, time
import numpy as np
import torch
from provider import EcologyProvider

pool = json.load(open('../../packages/evo/pools/test.json'))[:int(sys.argv[1]) if len(sys.argv) > 1 else 500]
p = EcologyProvider(); a = p.agent; tok = a.tok
t0 = time.perf_counter(); vecs = []
with torch.no_grad():
    for i in range(0, len(pool), 32):
        texts = [e['text'] for e in pool[i:i + 32]]
        enc = tok(texts, padding=True, truncation=True, max_length=128, return_tensors='pt')
        ids, mask = enc['input_ids'].to(a.device), enc['attention_mask'].to(a.device)
        with torch.autocast(device_type=a.device.type, dtype=torch.float16):
            h = a.model.encoder(input_ids=ids, attention_mask=mask).last_hidden_state.float()
        m = mask.unsqueeze(-1).float(); vecs.append(((h * m).sum(1) / m.sum(1)).cpu().numpy())
X = np.concatenate(vecs); X /= np.linalg.norm(X, axis=1, keepdims=True); y = np.array([e['factor'] > 0 for e in pool])
S = X @ X.T; np.fill_diagonal(S, -1)
for k in (1, 5, 15):
    nn = np.argsort(-S, axis=1)[:, :k]; pred = y[nn].mean(1) > .5
    print(f'k={k}: leave-one-out class accuracy {np.mean(pred == y):.3f}  (majority baseline {max(y.mean(), 1 - y.mean()):.3f})')
tiers = np.array([e['tier'] for e in pool]); nn = np.argmax(S, axis=1)
print('nearest neighbour same tier rate', round(float(np.mean(tiers[nn] == tiers)), 3), '| dims', X.shape[1], '| seconds', round(time.perf_counter() - t0, 1))
