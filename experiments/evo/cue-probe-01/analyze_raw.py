"""诊断（开发期）：同一批线索句子，不同降维方式下的可分性。raw = 1024 维原始平均池化；foodmean = 减去食物池均值；pca32food = 现有 32 维食物 PCA（对照，应与 analyze.py 一致）；pca_cue_k = 只在 train 线索句上拟合的 PCA（k 维，诊断用，不是可部署的向量，因为拟合用了线索标签之外的全部 train 句）。"""
import json, numpy as np
z = np.load('experiments/evo/cue-probe-01/cues-raw.npz'); X, state, split = z['X'], z['state'], z['split']
pca = np.load('experiments/evo/laya-embed-v1/pca.npz'); fm, comps = pca['mean'], pca['components']
def norm(M): return M / np.maximum(np.linalg.norm(M, axis=1, keepdims=True), 1e-9)
def auc(pos, neg):
    pos, neg = np.asarray(pos), np.asarray(neg); return float(((pos[:, None] > neg[None, :]).sum() + .5 * (pos[:, None] == neg[None, :]).sum()) / (len(pos) * len(neg)))
def metrics(M):
    M = norm(M); tr, ev, nz = split == 'train', split == 'eval', split == 'noise'
    cent = {s: (lambda c: c / np.linalg.norm(c))(M[tr & (state == s)].mean(0)) for s in 'ABC'}
    pred = np.array([max('ABC', key=lambda s: M[i] @ cent[s]) for i in np.where(ev)[0]])
    S = M[tr] @ M[ev].T; same = state[tr][:, None] == state[ev][None, :]
    own = np.array([M[i] @ cent[state[i]] for i in np.where(ev)[0]]); oth = np.array([max(M[i] @ cent[s] for s in 'ABC' if s != state[i]) for i in np.where(ev)[0]])
    nzb = np.array([max(M[i] @ cent[s] for s in 'ABC') for i in np.where(nz)[0]])
    return {'acc': round(float((pred == state[ev]).mean()), 3), 'auc': round(auc(S[same], S[~same]), 3), 'own_mean': round(float(own.mean()), 3), 'own_min': round(float(own.min()), 3), 'other_max_mean': round(float(oth.mean()), 3), 'noise_best_mean': round(float(nzb.mean()), 3), 'noise_best_max': round(float(nzb.max()), 3)}
out = {'raw1024': metrics(X), 'raw_centered_by_food_mean': metrics(X - fm), 'pca32_food': metrics((X - fm) @ comps.T)}
tr = split == 'train'; mu = X[tr].mean(0); _, _, vt = np.linalg.svd(X[tr] - mu, full_matrices=False)
for k in (2, 4, 8, 16): out[f'pca{k}_on_train_cues(diagnostic)'] = metrics((X - mu) @ vt[:k].T)
for k, v in out.items(): print(k.ljust(38), v)
json.dump(out, open('experiments/evo/cue-probe-01/results-raw.json', 'w'), indent=1)
