"""诊断（开发期）：36 条线索句（train+eval 合并）留一最近中心分类，看向量里有没有“状态”信息；对照词袋与随机基线（置换标签 1000 次）。"""
import numpy as np, re, hashlib
z = np.load('experiments/evo/cue-probe-01/cues-raw.npz'); X, state, split, text = z['X'], z['state'], z['split'], z['text']
m = split != 'noise'; X, y, T = X[m], state[m], text[m]
pca = np.load('experiments/evo/laya-embed-v1/pca.npz'); fm, comps = pca['mean'], pca['components']
def bow(t, d=256):
    v = np.zeros(d)
    for w in re.findall(r"[a-z']+", t.lower()): v[int(hashlib.md5(w.encode()).hexdigest(), 16) % d] += 1
    return v
def loo(M, labels):
    M = M / np.maximum(np.linalg.norm(M, axis=1, keepdims=True), 1e-9); ok = 0
    for i in range(len(M)):
        keep = np.arange(len(M)) != i; best = max('ABC', key=lambda s: (lambda c: M[i] @ (c / np.linalg.norm(c)))(M[keep & (labels == s)].mean(0))); ok += best == labels[i]
    return ok / len(M)
rng = np.random.default_rng(0)
for name, M in {'raw1024': X, 'pca32_food': (X - fm) @ comps.T, 'bow': np.array([bow(t) for t in T])}.items():
    null = np.array([loo(M, rng.permutation(y)) for _ in range(200)]); acc = loo(M, y)
    print(name.ljust(12), 'LOO acc', round(acc, 3), '| 置换基线均值', round(float(null.mean()), 3), '95% 分位', round(float(np.quantile(null, .95)), 3))
