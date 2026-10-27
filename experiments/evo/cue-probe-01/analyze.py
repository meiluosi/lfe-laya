"""向量可分性探针（开发期，非确认性）。判定规则在看到数据前写在 docs/DESIGN_SEMANTIC_CONTEXT.md §8：
训练句的状态中心 → 最近中心分类评估句，准确率 ≥ 0.9 且 train×eval 句对的“同状态 vs 不同状态”AUC ≥ 0.9，才继续。
对照：词袋哈希向量（非 Laya）、打乱的 Laya 向量（把向量随机配给别的句子）。"""
import json, re, sys, hashlib
import numpy as np
rows = [json.loads(l) for l in open(sys.argv[1])]
texts = [r['text'] for r in rows]; state = np.array([r['state'] for r in rows]); split = np.array([r['split'] for r in rows])
def bow(t, d=256):
    v = np.zeros(d)
    for w in re.findall(r"[a-z']+", t.lower()): v[int(hashlib.md5(w.encode()).hexdigest(), 16) % d] += 1
    return v / max(np.linalg.norm(v), 1e-9)
rng = np.random.default_rng(0)
V = {'laya': np.array([r['v'] for r in rows]), 'bow': np.array([bow(t) for t in texts])}
V['shuffled'] = V['laya'][rng.permutation(len(rows))]
def auc(pos, neg):
    pos, neg = np.asarray(pos), np.asarray(neg); return float(((pos[:, None] > neg[None, :]).sum() + .5 * (pos[:, None] == neg[None, :]).sum()) / (len(pos) * len(neg)))
out = {}
for name, X in V.items():
    X = X / np.maximum(np.linalg.norm(X, axis=1, keepdims=True), 1e-9)
    tr, ev, nz = split == 'train', split == 'eval', split == 'noise'
    cent = {s: X[tr & (state == s)].mean(0) for s in 'ABC'}; cent = {s: c / np.linalg.norm(c) for s, c in cent.items()}
    pred = np.array([max('ABC', key=lambda s: X[i] @ cent[s]) for i in np.where(ev)[0]]); acc = float((pred == state[ev]).mean())
    S = X[tr] @ X[ev].T; same = state[tr][:, None] == state[ev][None, :]
    a = auc(S[same], S[~same])
    # 阈值：最大的 θ 使得评估句到“自己状态中心”的相似度都 ≥ θ；以及同分布下不同状态中心的最大相似度
    own = np.array([X[i] @ cent[state[i]] for i in np.where(ev)[0]]); other = np.array([max(X[i] @ cent[s] for s in 'ABC' if s != state[i]) for i in np.where(ev)[0]])
    nzmax = np.array([max(X[i] @ cent[s] for s in 'ABC') for i in np.where(nz)[0]])
    out[name] = {'nearest_centroid_acc': acc, 'pair_auc_train_x_eval': a, 'own_centroid_cos_min': float(own.min()), 'own_centroid_cos_mean': float(own.mean()), 'other_centroid_cos_max': float(other.max()), 'other_centroid_cos_mean': float(other.mean()), 'noise_best_centroid_cos_mean': float(nzmax.mean()), 'noise_best_centroid_cos_max': float(nzmax.max()),
                 'state_centroid_cos': {f'{a}{b}': float(cent[a] @ cent[b]) for a, b in ['AB', 'AC', 'BC']}}
print(json.dumps(out, indent=1, ensure_ascii=False))
json.dump(out, open(sys.argv[2], 'w'), indent=1, ensure_ascii=False)
