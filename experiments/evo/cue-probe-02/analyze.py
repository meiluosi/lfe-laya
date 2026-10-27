"""选项 B 探针（开发期）：5 维 Laya 问答特征的可分性。判定规则在运行前写定：
 通过 = ① train 状态中心 → eval 句最近中心准确率 ≥ 0.9；② train×eval 句对“同状态 vs 不同状态”AUC ≥ 0.9；③ “eval 句到最近状态中心的相似度”对“无关句”的 AUC ≥ 0.8（无关句不应被当成已知环境）。
 相似度 = −欧氏距离（特征是概率，不再做余弦）。对照：关键词匹配（只用训练句里出现的词，作者按维度手写）、打乱的 Laya 特征。"""
import json, re, sys
import numpy as np
rows = [json.loads(l) for l in open(sys.argv[1])]; state = np.array([r['state'] for r in rows]); split = np.array([r['split'] for r in rows]); texts = [r['text'] for r in rows]
# 关键词：只取自训练句的措辞；每个维度的“第一个选项”词表（暖 / 湿 / 有风 / 有雾 / 光怪异）
KW = {'temperature': ['warm', 'hot', 'mild', 'sunny'], 'wetness': ['wet', 'soaked', 'damp', 'sodden', 'muddy', 'rain'], 'wind': ['wind', 'gusty', 'gusts', 'blustery', 'breeze', 'rushes'],
      'fog': ['mist', 'fog', 'haze', 'cloud', 'murky', 'shrouded'], 'light': ['strange', 'eerie', 'odd', 'uncanny', 'unusual', 'weird']}
COLD, DRY, CALM = ['cold', 'chilly', 'cool'], ['dry', 'parched', 'dusty', 'cracked'], ['still', 'windless', 'calm', 'quiet']
def kw(t):
    t = t.lower(); has = lambda ws: any(w in t for w in ws)
    return [1.0 if has(KW['temperature']) and not has(COLD) else 0.0 if has(COLD) else .5, 1.0 if has(KW['wetness']) and not has(DRY) else 0.0 if has(DRY) else .5,
            1.0 if has(KW['wind']) and not has(CALM) else 0.0 if has(CALM) else .5, 1.0 if has(KW['fog']) else 0.0, 1.0 if has(KW['light']) else 0.0]
F = {'laya_questions': np.array([r['p'] for r in rows]), 'keywords_from_train_words': np.array([kw(t) for t in texts])}
F['shuffled'] = F['laya_questions'][np.random.default_rng(0).permutation(len(rows))]
def auc(pos, neg):
    pos, neg = np.asarray(pos), np.asarray(neg); return float(((pos[:, None] > neg[None, :]).sum() + .5 * (pos[:, None] == neg[None, :]).sum()) / (len(pos) * len(neg)))
out = {}
for name, X in F.items():
    tr, ev, nz = split == 'train', split == 'eval', split == 'noise'; cent = {s: X[tr & (state == s)].mean(0) for s in 'ABC'}
    sim = lambda i, s: -np.linalg.norm(X[i] - cent[s])
    pred = np.array([max('ABC', key=lambda s: sim(i, s)) for i in np.where(ev)[0]])
    S = -np.linalg.norm(X[tr][:, None, :] - X[ev][None, :, :], axis=2); same = state[tr][:, None] == state[ev][None, :]
    best_ev = np.array([max(sim(i, s) for s in 'ABC') for i in np.where(ev)[0]]); best_nz = np.array([max(sim(i, s) for s in 'ABC') for i in np.where(nz)[0]])
    out[name] = {'acc': round(float((pred == state[ev]).mean()), 3), 'pair_auc': round(auc(S[same], S[~same]), 3), 'eval_vs_noise_auc': round(auc(best_ev, best_nz), 3),
                 'state_means': {s: [round(float(x), 2) for x in cent[s]] for s in 'ABC'}, 'noise_mean': [round(float(x), 2) for x in X[nz].mean(0)]}
    out[name]['pass'] = bool(out[name]['acc'] >= .9 and out[name]['pair_auc'] >= .9 and out[name]['eval_vs_noise_auc'] >= .8)
    print(name.ljust(28), json.dumps(out[name]))
json.dump(out, open(sys.argv[2], 'w'), indent=1)
