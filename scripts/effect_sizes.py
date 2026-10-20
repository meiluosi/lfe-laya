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

T975 = {2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365}   # 双侧 95% t 临界值（自由度 = n−1）
def t_interval(xs):
    n = len(xs); m = sum(xs) / n; sd = (sum((v - m) ** 2 for v in xs) / (n - 1)) ** .5; h = T975[n - 1] * sd / n ** .5; return m - h, m + h

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
    rows.append((prereg, label, len(xs), mean, lo, hi, sign_p(xs, thr if noninf else 0.0), thr, formal, tier(mean, lo, hi, thr, noninf), t_interval(xs) if len(xs) - 1 in T975 else (None, None)))
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
r = load('social-eval-01'); P = {h['id']: h for h in r['primary']}
add('09', '社会观察：laya 真实外观 − 不显示', P['H1']['perSeed'], 0.02, '成立')
add('09', '错误的社会信息有代价：laya 不显示 − 错配', P['H2']['perSeed'], 0.05, '成立')
add('09', '社会收益 laya − vader（真实 − 不显示）', P['H3']['perSeed'], 0.01, '成立')
r = load('ripening-eval-01'); P = {h['id']: h for h in r['primary']}
add('10', '成熟周期：真实线索下 laya − none（none 多数停在退化策略）', P['H1']['perSeed'], 0.03, '成立')
add('10', '成熟周期：laya 真实线索 − 错配线索', P['H2']['perSeed'], 0.05, '成立')
add('10', '成熟周期：真实线索下 laya − vader', P['H3']['perSeed'], 0.01, '不成立')
r = load('ripening11-eval-01'); P = {h['id']: h for h in r['primary']}
add('11', '公平比较（K=4）：真实线索下 laya − none', P['H1']['perSeed'], 0.03, '不成立')
add('11', '公平比较：laya 真实线索 − 错配线索', P['H2']['perSeed'], 0.05, '成立')
add('11', '公平比较：真实线索下 laya − vader', P['H3']['perSeed'], 0.01, '不成立')
r = load('heldout-rep-eval-01')
for h in r['primary']:
    xs = [p['diff'] for p in h['perRun']]; add('03', f"{h['id']} {h['claim']}（3 个训练种子）", xs, None, '不成立（交集检验）')

print('# 效应量总表（事后、探索性）\n')
print('> 本表不改变任何已冻结的正式结论。它把“方向是否确认”和“幅度是否达到预设阈值”分开报告，数据来自各预注册的 `results.json`（种子层面），区间为种子间百分位 bootstrap（20000 次）；方向 p 为符号翻转精确检验（非劣效行为相对阈值）。**区间只有 3–8 个种子，应视为粗略。**\n')
print('| 预注册 | 比较 | 种子数 | 均值 | 95% 区间（bootstrap） | 95% t 区间 | 方向 p | 阈值 | 正式结论 | 分类 |')
print('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for p, l, n, m, lo, hi, sp, thr, f, t, ti in rows:
    tt = '' if ti[0] is None else f'[{ti[0]:+.4f}, {ti[1]:+.4f}]'
    print(f"| {p} | {l} | {n} | {m:+.4f} | [{lo:+.4f}, {hi:+.4f}] | {tt} | {sp:.4f} | {'' if thr is None else f'{thr:+.2f}'} | {f} | {t} |")
print('\n说明：预注册 02 只有 1 个训练种子，不在表中；预注册 04 的稳定性假设（H2，标准差比）不是差值，未列入。')
print('''
## 解读（事后）

1. **正式结论没有被这张表推翻。** 成立的比较里，幅度也大多确认（预注册 07、09 的 H1/H2、10 的 H1/H2、11 的 H2 区间下界都高于阈值）；预注册 06 H2 与 09 H3 的区间含阈值，说明它们“成立”的幅度证据偏弱。
2. **有两处“方向确认、但幅度未达”**：预注册 04 H1（+0.032，区间含阈值 0.04，阈值略偏严）和预注册 08 H2（+0.032，区间 [+0.026, +0.038] 低于阈值 0.05，阈值定得偏高）。两处都说明“先验在延迟世界里有一个中等偏小、方向确定的收益”，正式结论“不成立”不应被读成“没有效应”。
3. **预注册 04 的“先验价值随延迟增加”**：自身幅度与方向都确认，被判“不宣称”只是因为协议里并列 p 的逐步规则没有预见到；预注册 06 起已改为“Holm 只基于 p，效应量条件只决定该假设自己是否成立”。
4. **预注册 10 → 11 是最重要的对照**：10 的 H1 成立（+0.060，但无先验个体 75% 停在“什么都不吃”的退化策略），11 在“双方都能学会”的公平世界里 laya − none = −0.005（区间 [−0.031, +0.032]，含 0），laya − vader = −0.014（区间上界仍 < 阈值，Laya 略差于词典）。所以先验的收益有一部分来自“经验学习学不会的世界”，不能当作普遍的先验价值。
5. **预注册 03 只有 3 个种子**，区间很宽，只能说明异质性大。
6. 对未来预注册的建议：分层判定（先判方向，再判幅度），阈值事先用开发期的种子间区间而不是点估计来定；等价区间（±0.02）只用于声明“无实际差异”。
''')
