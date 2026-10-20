"""论文表格（LaTeX）：复用 scripts/effect_sizes.py 的种子层面数据，输出英文标签的 booktabs 表。
用法：python3 scripts/make_tables.py → docs/paper/tables/*.tex。数字全部来自 experiments/evo/*/results.json。"""
import io, contextlib, runpy
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]; OUT = ROOT / 'docs' / 'paper' / 'tables'; OUT.mkdir(parents=True, exist_ok=True)
with contextlib.redirect_stdout(io.StringIO()):
    ns = runpy.run_path(str(ROOT / 'scripts' / 'effect_sizes.py'), run_name='effect_sizes')
rows = ns['rows']   # (prereg, label, n, mean, lo, hi, p, thr, formal, tier)
LABELS = {  # 按 effect_sizes.py 中各预注册内的出现顺序（只含非描述性行）
 '04': ['Delay 40: laya $-$ none (mismatched training)', 'Prior value grows with delay (D40 $-$ D0)'],
 '06': ['Delay 0: laya $-$ none (non-inferiority)', 'Delay 40: laya $-$ none (matched training)', 'Hierarchical belief, laya (deception 0.40)'],
 '07': ['Factual dialect, delay 40: laya $-$ vader', 'Held-out dialect, delay 80: laya $-$ none', 'Prior value grows with delay (d80 $-$ d40)'],
 '08': ['Gap widening: (laya $-$ vader) factual vs.\\ sentiment training', 'Factual training: laya $-$ none (factual dialect)', 'Transfer: factual-trained, held-out dialect, laya $-$ vader (non-inferiority)'],
 '09': ['Social looks: true $-$ absent (laya)', 'Social looks: absent $-$ mismatched (laya)', 'Social gain: laya $-$ vader'],
 '10': ['Ripening: laya $-$ none (true cues)', 'Ripening: true $-$ mismatched (laya)', 'Ripening: laya $-$ vader'],
 '11': ['Fair ripening ($K{=}4$): laya $-$ none', 'Fair ripening: true $-$ mismatched (laya)', 'Fair ripening: laya $-$ vader'],
 '03': ['laya $-$ shuffled (3 seeds)', 'laya $-$ none (3 seeds)', 'laya $-$ vader (3 seeds)'],
}
FORMAL = {'成立': 'supported', '不成立': 'not supported', '不成立（效应量未达）': 'not supported (magnitude)', '按逐步规则不宣称（p 并列）': 'not claimed (tied $p$)', '不成立（交集检验）': 'not supported (intersection)'}
TIER = [('方向确认', 'direction confirmed'), ('方向不定', 'direction unclear'), ('幅度确认（下界 ≥ 阈值）', 'magnitude confirmed'), ('幅度低于阈值（上界 < 阈值）', 'magnitude below threshold'), ('幅度不定（区间含阈值）', 'magnitude unclear'), ('非劣效确认（区间下界 > 阈值）', 'non-inferiority confirmed'), ('非劣效不定', 'non-inferiority unclear'), ('劣于阈值', 'worse than margin')]
def tier_en(t):
    for zh, en in TIER: t = t.replace(zh, en)
    return t.replace('；', '; ')
seen = {}; main_rows, all_rows = [], []
for r in rows:
    if r[8] == '次要': continue
    k = seen.get(r[0], 0); seen[r[0]] = k + 1; lab = LABELS[r[0]][k]
    line = (r[0], lab, r[2], f'{r[3]:+.3f}', f'[{r[4]:+.3f}, {r[5]:+.3f}]', f'{r[6]:.4f}', '' if r[7] is None else f'{r[7]:+.2f}', FORMAL.get(r[8], r[8]), tier_en(r[9]))
    all_rows.append(line)
    if r[0] != '03': main_rows.append(line)
def table(lines, caption, label):
    head = '\\begin{table}[t]\\centering\\small\\caption{' + caption + '}\\label{' + label + '}\n\\begin{tabular}{@{}llrrrrll@{}}\\toprule\nPre-reg. & Comparison & $n$ & Mean & 95\\% interval & $p$ & Threshold & Formal outcome \\\\\\midrule\n'
    body = ''.join(f'{a} & {b} & {c} & {d} & {e} & {f} & {g} & {h} \\\\\n' for a, b, c, d, e, f, g, h, _ in lines)
    return head + body + '\\bottomrule\\end{tabular}\\end{table}\n'
(OUT / 'table_confirmatory.tex').write_text(table(main_rows, 'Confirmatory comparisons (pre-registrations 04--11). Mean and 95\\% percentile bootstrap interval over training seeds; $p$ is the exact one-sided sign-flip test (non-inferiority rows are tested against the margin). Threshold is the pre-registered effect size.', 'tab:confirmatory'))
(OUT / 'table_all_tiers.tex').write_text(table(all_rows, 'All confirmatory comparisons including pre-registration 03, with the tiered reading of each result in the last column of the supplementary table.', 'tab:all'))
tiers = '\\begin{table}[t]\\centering\\small\\caption{Tiered reading of every confirmatory comparison. ``Direction confirmed'' means all seeds agree in sign (exact sign-flip $p=2^{-n}$); ``magnitude confirmed'' means the lower bound of the seed-level interval is at or above the pre-registered threshold; ``unclear'' means the interval contains it.}\\label{tab:tiers}\n\\begin{tabular}{@{}llrl@{}}\\toprule\nPre-reg. & Comparison & Mean & Tiered reading \\\\\\midrule\n' + ''.join(f'{l[0]} & {l[1]} & {l[3]} & {l[8]} \\\\\n' for l in all_rows) + '\\bottomrule\\end{tabular}\\end{table}\n'
(OUT / 'table_tiers.tex').write_text(tiers)
(OUT / 'tiers.txt').write_text('\n'.join(f'{l[0]}\t{l[1]}\t{l[8]}' for l in all_rows) + '\n')
print('rows', len(main_rows), len(all_rows))
