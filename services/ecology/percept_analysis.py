"""分析 Laya 方向感知语料：原始准确率、混淆矩阵、位置偏置、以及一个可学习校准层（多项逻辑回归，k 折交叉验证）能提升多少。
校准层代表“先天参数里对 Laya 直觉的读取”；这里只衡量方向识别，不涉及生存。"""
import argparse
import json
import math
from pathlib import Path
import numpy as np

parser = argparse.ArgumentParser(); parser.add_argument('corpus'); parser.add_argument('--output', default=None)
args = parser.parse_args()
rows = [json.loads(l) for l in Path(args.corpus).open()]
LABELS = rows[0]['labels']; idx = {l: i for i, l in enumerate(LABELS)}
P = np.array([r['probs'] for r in rows]); y = np.array([idx[r['truth']] for r in rows]); worlds = np.array([r['world'] for r in rows])
n = len(rows)

def nearest_distance(r):
    o = r['request']['observation']; d = [math.hypot(c['dx'], c['dy']) for c in o['local'] if not c['blocked'] and c['food'] >= .05]
    return min(d) if d else None
dist = [nearest_distance(r) for r in rows]
raw_pred = P.argmax(1)
out = {'rows': n, 'worlds': int(len(set(worlds))), 'truthCounts': {l: int((y == i).sum()) for i, l in enumerate(LABELS)}, 'chance_majority': float(np.bincount(y).max() / n)}
out['rawAccuracy'] = float((raw_pred == y).mean())
out['rawMeanProbOnTruth'] = float(P[np.arange(n), y].mean())
cm = np.zeros((6, 6), int)
for t, p in zip(y, raw_pred): cm[t, p] += 1
out['confusion_rows_truth_cols_pred'] = {LABELS[i]: dict(zip(LABELS, cm[i].tolist())) for i in range(6)}
out['predictionShare'] = {LABELS[i]: float((raw_pred == i).mean()) for i in range(6)}
out['truthShare'] = {LABELS[i]: float((y == i).mean()) for i in range(6)}
out['accuracyByNearestFoodDistance'] = {}
for lo, hi in [(0, .5), (.5, 1.5), (1.5, 2.5), (2.5, 4.5)]:
    m = np.array([d is not None and lo <= d < hi for d in dist]); out['accuracyByNearestFoodDistance'][f'[{lo},{hi})'] = {'n': int(m.sum()), 'accuracy': float((raw_pred[m] == y[m]).mean()) if m.any() else None}
m = np.array([d is None for d in dist]); out['accuracyNoFoodVisible'] = {'n': int(m.sum()), 'accuracy': float((raw_pred[m] == y[m]).mean()) if m.any() else None}
# 可学习校准：特征 = log 概率；按世界分组的 k 折交叉验证，避免同一世界同时出现在训练与测试
def softmax_regression(X, t, l2=1e-2, steps=300, lr=.5):
    W = np.zeros((X.shape[1], 6))
    for _ in range(steps):
        Z = X @ W; Z -= Z.max(1, keepdims=True); E = np.exp(Z); S = E / E.sum(1, keepdims=True)
        G = X.T @ (S - np.eye(6)[t]) / len(X) + l2 * W; W -= lr * G
    return W
X = np.hstack([np.log(np.clip(P, 1e-6, 1)), np.ones((n, 1))]); folds = 5; ids = sorted(set(worlds.tolist())); preds = np.zeros(n, int)
for k in range(folds):
    test_w = set(ids[k::folds]); te = np.array([w in test_w for w in worlds]); tr = ~te
    W = softmax_regression(X[tr], y[tr]); preds[te] = (X[te] @ W).argmax(1)
out['calibratedAccuracy_crossValidatedByWorld'] = float((preds == y).mean())
out['calibratedAccuracyByNearestFoodDistance'] = {k: None for k in out['accuracyByNearestFoodDistance']}
for lo, hi in [(0, .5), (.5, 1.5), (1.5, 2.5), (2.5, 4.5)]:
    m = np.array([d is not None and lo <= d < hi for d in dist]); out['calibratedAccuracyByNearestFoodDistance'][f'[{lo},{hi})'] = float((preds[m] == y[m]).mean()) if m.any() else None
m = np.array([d is None for d in dist]); out['calibratedAccuracyNoFoodVisible'] = float((preds[m] == y[m]).mean()) if m.any() else None
out['limits'] = '语料来自规则/随机控制器的真实模拟观测；真值来自个体自己的局部观测；只评估方向识别，不是生存收益。'
print(json.dumps(out, indent=2, ensure_ascii=False))
if args.output: Path(args.output).write_text(json.dumps(out, indent=2, ensure_ascii=False))
