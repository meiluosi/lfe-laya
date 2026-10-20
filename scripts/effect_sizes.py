"""效应量总表（事后、探索性）：对已完成的确认性预注册，不重判正式结论，只补充：
种子层面的均值、百分位 bootstrap 95% 区间、方向证据（符号翻转精确 p；全部同向时为 2^-n）、与预设阈值的关系，
以及按三档分类：方向确认 / 幅度确认（区间下界 ≥ 阈值）/ 低于阈值（区间上界 < 阈值）/ 幅度不定（区间含阈值）。
等价区间默认 ±0.02（只用于 laya − 对照 ≈ 0 的描述）。数据全部来自 experiments/evo/*/results.json，无新计算。
用法：python scripts/effect_sizes.py > docs/EFFECT_SIZES_table.md"""
import json, random, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
random.seed(20261021); B = 20000; EQ = 0.02

def load(name): return json.loads((ROOT / 'experiments' / 'evo' / name / 'results.json').read_text())

def boot(xs):
    n = len(xs); m = sorted(sum(random.choice(xs) for _ in xs) / n for _ in range(B))
    return sum(xs) / n, m[int(.025 * B)], m[int(.975 * B)]

def sign_p(xs, shift=0.0):
    x = [v - shift for v in xs]; n = len(x); obs = sum(x) / n; ge = 0
    for mask in range(1 << n):
        s = sum(-x[i] if mask >> i & 1 else x[i] for i in range(n))
        if s / n >= obs - 1e-12: ge += 1
    return ge / (1 << n)

def tier(mean, lo, hi, thr, noninf=False):
    if noninf: return '非劣效确认（区间下界 > 阈值）' if lo > thr else ('非劣效不定' if hi > thr else '劣于阈值')
    if lo > 0 and all_pos[0]: d = '方向确认'
    else: d = '方向不定'
    if thr is None: return d
    if lo >= thr: return d + '；幅度确认（下界 ≥ 阈值）'
    if hi < thr: return d + '；幅度低于阈值（上界 < 阈值）'
    return d + '；幅度不定（区间含阈值）'

rows = []
def add(prereg, label, xs, thr, formal, noninf=False):
    mean, lo, hi = boot(xs); all_pos[0] = all(v > 0 for v in xs)
    rows.append((prereg, label, len(xs), mean, lo, hi, sign_p(xs, thr if noninf else 0.0), thr, formal, tier(mean, lo, hi, thr, noninf)))
all_pos = [False]

r = load('heldout-long-eval-01'); P = {h['id']: h for h in r['primary']}
add('04', '延迟 40：laya − none（错配训练）', P['H1']['perSeed'], 0.04, '不成立（效应量未达）')
add('04', '先验价值随延迟增加（D40 − D0）', P['H3']['perSeed'], 0.03, '按逐步规则不宣称（p 并列）')
r = load('factorial-eval-01'); P = {h['id']: h for h in r['analysis']['heldout']['primary']}
add('06', '延迟 0：laya − none（匹配训练，非劣效 > −0.04）', P['H1']['perSeed'], -0.04, '成立', noninf=True)
add('06', '延迟 40：laya − none（匹配训练）', P['H2']['perSeed'], 0.04, '成立')
add('06', '层次信念对 laya（欺骗 0.40）', P['H3']['perSeed'], 0.03, '不成立')
r = load('lexicon-eval-01'); P = {h['id']: h for h in r['primary']}
add('07', '事实方言、延迟 40：laya − vader', P['H1']['perSeed'], 0.03, '成立')
add('07', '留出方言、延迟 80：laya − none', P['H2']['perSeed'], 0.04, '成立')
add('07', '先验价值随延迟增加（d80 − d40）', P['H3']['perSeed'], 0.02, '成立')
for pool in ('heldout', 'factual'):
    s = r['secondary'][pool]
    add('07', f'（描述性）{pool}、延迟 40：laya − vader', s['layaMinusVader']['d40'], None, '次要')
    add('07', f'（描述性）{pool}、延迟 80：laya − vader', s['layaMinusVader']['d80'], None, '次要')
    add('07', f'（描述性）{pool}、延迟 40：laya − none', s['layaMinusNone']['d40'], None, '次要')
    add('07', f'（描述性）{pool}、延迟 80：laya − none', s['layaMinusNone']['d80'], None, '次要')
r = load('factual-train-eval-01'); P = {h['id']: h for h in r['primary']}
add('08', '差距放大：(laya−vader)@事实训练 − @情感训练', P['H1']['perSeed'], 0.02, '不成立')
add('08', '事实方言训练：laya − none（事实方言）', P['H2']['perSeed'], 0.05, '不成立（效应量未达）')
add('08', '迁移：事实训练的个体在留出方言 laya − vader（非劣效 > −0.02）', P['H3']['perSeed'], -0.02, '成立', noninf=True)
for pool in ('factual', 'heldout'):
    s = r['secondary'][pool]
    for t in ('sentiment', 'factual'): add('08', f'（描述性）{pool}、{t} 训练：laya − vader', s['layaMinusVader'][t], None, '次要')
r = load('heldout-rep-eval-01')
for h in r['primary']:
    xs = [p['diff'] for p in h['perRun']]; add('03', f"{h['id']} {h['claim']}（3 个训练种子）", xs, None, '不成立（交集检验）')

print('# 效应量总表（事后、探索性）\n')
print('> 本表不改变任何已冻结的正式结论。它把“方向是否确认”和“幅度是否达到预设阈值”分开报告，数据来自各预注册的 `results.json`（种子层面），区间为种子间百分位 bootstrap（20000 次）；方向 p 为符号翻转精确检验（非劣效行为相对阈值）。**区间只有 3–8 个种子，应视为粗略。**\n')
print('| 预注册 | 比较 | 种子数 | 均值 | 95% 区间 | 方向 p | 阈值 | 正式结论 | 分类 |')
print('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for p, l, n, m, lo, hi, sp, thr, f, t in rows:
    print(f"| {p} | {l} | {n} | {m:+.4f} | [{lo:+.4f}, {hi:+.4f}] | {sp:.4f} | {'' if thr is None else f'{thr:+.2f}'} | {f} | {t} |")
print('\n说明：预注册 02 只有 1 个训练种子，不在表中；预注册 04 的稳定性假设（H2，标准差比）不是差值，未列入。')
