"""功效规划（点子 #5；Colas et al. 2018 的思路）：用已完成预注册的种子层面差值估计 σ，计算下一个预注册需要多少训练种子。
这是规划用的近似（正态近似 + 小样本修正 +2），不是确认性分析；精确符号翻转检验还要求 n ≥ log2(1/α)（α 为 Holm 的步长）。
用法：python3 scripts/power.py → 打印表（也可 > docs/POWER.md）。数据来自 effect_sizes.py 的 rows。"""
import io, contextlib, runpy, math
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
with contextlib.redirect_stdout(io.StringIO()): ns = runpy.run_path(str(ROOT / 'scripts' / 'effect_sizes.py'), run_name='effect_sizes')
def z(p):   # 标准正态分位数（Acklam 近似的简化：用二分法对 erf 求逆）
    lo, hi = -10.0, 10.0
    for _ in range(80):
        mid = (lo + hi) / 2
        if 0.5 * (1 + math.erf(mid / math.sqrt(2))) < p: lo = mid
        else: hi = mid
    return (lo + hi) / 2
def need(delta, sd, alpha, power=.8): return math.ceil(((z(1 - alpha) + z(power)) * sd / abs(delta)) ** 2 + 2) if delta else float('inf')
print('# 功效规划（近似，事后；用于决定下一个预注册的种子数）\n')
print('单侧 α = 0.0167（Holm 三个假设的第一步）与 0.05；功效 80%。σ 为种子间标准差（取自已完成的比较）；“按观测效应”假设真实效应等于观测均值，“按阈值”假设真实效应恰为预设阈值。精确符号翻转检验在 α = 0.0167 时至少需要 6 个种子（2^-6 = 0.0156）。\n')
print('| 预注册 | 比较 | 种子数 | 均值 | σ | 按观测效应所需种子数（α=.0167 / .05） | 按阈值所需种子数（α=.0167） |'); print('| --- | --- | --- | --- | --- | --- | --- |')
for p, label, n, m, lo, hi, sp, thr, formal, tier, ti in ns['rows']:
    if formal == '次要' or p == '03': continue
    sd = (((hi - lo) / 2) / 1.96) * math.sqrt(n)   # 由 bootstrap 区间半宽反推种子间 σ（近似）
    thr_need = '' if thr is None or thr <= 0 else need(thr, sd, .0167)
    print(f'| {p} | {label} | {n} | {m:+.3f} | {sd:.3f} | {need(m, sd, .0167)} / {need(m, sd, .05)} | {thr_need} |')
