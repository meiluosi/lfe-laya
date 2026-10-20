"""论文图表（零依赖，Python 标准库，输出 SVG）。所有数字来自 experiments/evo/*/results.json，不手工改数。
用法：python3 scripts/make_figures.py   → docs/paper/figures/*.svg
图中文字用英文（arXiv 默认英文）；SVG 转 PDF/PNG 需要额外工具（rsvg-convert / inkscape / matplotlib 等），见 docs/paper/OUTLINE.md。
"""
import json, random, html, shutil, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]; OUT = ROOT / 'docs' / 'paper' / 'figures'; OUT.mkdir(parents=True, exist_ok=True)
random.seed(7)
C = {'laya': '#0072B2', 'none': '#E69F00', 'vader': '#009E73', 'gray': '#6b7280', 'ink': '#111827', 'grid': '#e5e7eb', 'bad': '#b91c1c'}
def load(n): return json.loads((ROOT / 'experiments' / 'evo' / n / 'results.json').read_text())
def esc(s): return html.escape(str(s))

class Svg:
    def __init__(s, w, h): s.w, s.h, s.parts = w, h, []
    def add(s, x): s.parts.append(x)
    def text(s, x, y, t, size=12, anchor='start', fill=None, weight='normal', rot=None):
        tr = f' transform="rotate({rot} {x} {y})"' if rot else ''
        s.add(f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" text-anchor="{anchor}" fill="{fill or C["ink"]}" font-weight="{weight}" font-family="Helvetica, Arial, sans-serif"{tr}>{esc(t)}</text>')
    def line(s, x1, y1, x2, y2, stroke=None, w=1, dash=None):
        d = f' stroke-dasharray="{dash}"' if dash else ''
        s.add(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{stroke or C["grid"]}" stroke-width="{w}"{d}/>')
    def rect(s, x, y, w, h, fill, op=1): s.add(f'<rect x="{x:.1f}" y="{y:.1f}" width="{max(w,0):.1f}" height="{max(h,0):.1f}" fill="{fill}" opacity="{op}"/>')
    def circle(s, x, y, r, fill, op=1): s.add(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{fill}" opacity="{op}"/>')
    def save(s, name):
        (OUT / name).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {s.w} {s.h}" width="{s.w}" height="{s.h}"><rect width="{s.w}" height="{s.h}" fill="white"/>' + ''.join(s.parts) + '</svg>')

def boot(xs, B=20000):
    n = len(xs); m = sorted(sum(random.choice(xs) for _ in xs) / n for _ in range(B)); return sum(xs) / n, m[int(.025 * B)], m[int(.975 * B)]

# ---------- Figure 1: forest plot of the main confirmatory comparisons ----------
def fig_forest():
    P = lambda n, key=None: {h['id']: h for h in (load(n)['primary'] if key is None else load(n)['analysis'][key]['primary'])}
    p4, p6, p7, p8, p9, p10, p11 = P('heldout-long-eval-01'), P('factorial-eval-01', 'heldout'), P('lexicon-eval-01'), P('factual-train-eval-01'), P('social-eval-01'), P('ripening-eval-01'), P('ripening11-eval-01')
    rows = [  # (group, label, perSeed, threshold, colour)
        ('Prior value vs. delay (matched training)', 'delay 0: laya - none', p6['H1']['perSeed'], None, 'laya'),
        ('', 'delay 40: laya - none', p6['H2']['perSeed'], 0.04, 'laya'),
        ('', 'delay 80: laya - none', p7['H2']['perSeed'], 0.04, 'laya'),
        ('Laya vs. lexicon (VADER)', 'factual dialect, delay 40', p7['H1']['perSeed'], 0.03, 'vader'),
        ('', 'ripening world (stage phrases)', p10['H3']['perSeed'], 0.01, 'vader'),
        ('', 'fair ripening world (K=4)', p11['H3']['perSeed'], 0.01, 'vader'),
        ('Fair comparison (experience can learn)', 'fair ripening world: laya - none', p11['H1']['perSeed'], 0.03, 'none'),
        ('Cues are used (laya, true - mismatched)', 'social looks (true - off)', p9['H1']['perSeed'], 0.02, 'laya'),
        ('', 'ripening stage phrases (true - mismatched)', p10['H2']['perSeed'], 0.05, 'laya'),
        ('', 'fair ripening (true - mismatched)', p11['H2']['perSeed'], 0.05, 'laya'),
        ('No effect', 'hierarchical belief (laya, flat vs hier)', p6['H3']['perSeed'], 0.03, 'gray'),
    ]
    groups = sum(1 for r in rows if r[0]); W, L, R, T = 800, 290, 215, 76; H = T + 28 * len(rows) + 22 * groups + 56
    s = Svg(W, H); xmin, xmax = -0.06, 0.12
    X = lambda v: L + (v - xmin) / (xmax - xmin) * (W - L - R)
    s.text(20, 30, 'Seed-level effects (fitness scale)', 15, weight='bold')
    s.text(20, 50, 'Mean and bootstrap 95% interval over training seeds; red tick = pre-registered threshold.', 12, fill=C['gray'])
    s.text(W - R + 18, T - 14, 'mean [95% interval]', 11, fill=C['gray'])
    for v in [-0.05, 0, 0.05, 0.10]:
        s.line(X(v), T - 8, X(v), H - 40, C['ink'] if v == 0 else C['grid'], 1.2 if v == 0 else 1); s.text(X(v), H - 22, f'{v:+.2f}', 11, 'middle', C['gray'])
    y = T
    for g, label, xs, thr, col in rows:
        if g: s.text(20, y + 4, g, 12, weight='bold'); y += 22
        m, lo, hi = boot(xs); s.text(L - 12, y + 4, label, 12, 'end')
        s.line(X(lo), y, X(hi), y, C[col], 3)
        for v in xs: s.circle(X(v) + random.uniform(-2, 2), y + random.uniform(-6, 6), 2.6, C[col], .35)
        s.circle(X(m), y, 5, C[col]); s.text(W - R + 18, y + 4, f'{m:+.3f} [{lo:+.3f}, {hi:+.3f}]', 11, fill=C['gray'])
        if thr is not None: s.line(X(thr), y - 9, X(thr), y + 9, C['bad'], 1.5, '3 2')
        y += 28
    s.save('fig1_forest.svg')

# ---------- Figure 2: prior value as a function of consequence delay ----------
def fig_delay():
    p6, p7 = {h['id']: h for h in load('factorial-eval-01')['analysis']['heldout']['primary']}, {h['id']: h for h in load('lexicon-eval-01')['primary']}
    s7 = load('lexicon-eval-01')['secondary']['heldout']['layaMinusNone']
    series = [('Pre-reg. 06 (6 seeds)', {0: p6['H1']['perSeed'], 40: p6['H2']['perSeed']}, '#56B4E9'), ('Pre-reg. 07 (8 seeds)', {40: s7['d40'], 80: s7['d80']}, C['laya'])]
    W, H, L, R, T, B = 640, 420, 70, 30, 60, 60; s = Svg(W, H); xmax, ymin, ymax = 90, -0.04, 0.11
    X = lambda v: L + v / xmax * (W - L - R); Y = lambda v: T + (ymax - v) / (ymax - ymin) * (H - T - B)
    s.text(20, 28, 'The value of the prior grows with the delay of consequences', 15, weight='bold'); s.text(20, 46, 'laya - none, matched training and evaluation delay, held-out dialect', 12, fill=C['gray'])
    for v in [-0.04, 0, 0.04, 0.08]: s.line(L, Y(v), W - R, Y(v), C['ink'] if v == 0 else C['grid']); s.text(L - 8, Y(v) + 4, f'{v:+.2f}', 11, 'end', C['gray'])
    for d in [0, 40, 80]: s.text(X(d), H - 36, str(d), 12, 'middle', C['gray'])
    s.text((L + W - R) / 2, H - 14, 'delay of consequences (simulation ticks)', 12, 'middle'); s.text(18, (T + H - B) / 2, 'fitness difference', 12, 'middle', rot=-90)
    for name, pts, col in series:
        ks = sorted(pts); means = [(d, boot(pts[d])) for d in ks]
        for a, b in zip(means, means[1:]): s.line(X(a[0]), Y(a[1][0]), X(b[0]), Y(b[1][0]), col, 2)
        for d, (m, lo, hi) in means:
            s.line(X(d), Y(lo), X(d), Y(hi), col, 3)
            for v in pts[d]: s.circle(X(d) + random.uniform(-4, 4), Y(v), 2.6, col, .35)
            s.circle(X(d), Y(m), 5, col)
    s.rect(L + 10, T + 6, 10, 10, '#56B4E9'); s.text(L + 26, T + 15, 'Pre-reg. 06 (6 training seeds)', 11); s.rect(L + 10, T + 24, 10, 10, C['laya']); s.text(L + 26, T + 33, 'Pre-reg. 07 (8 training seeds)', 11)
    s.save('fig2_delay.svg')

# ---------- Figure 3: use of language cues (true / absent / mismatched) ----------
def fig_cues():
    soc = load('social-eval-01')['secondary']['heldout']['meanFitness']
    panels = [('Social looks (09)', {k: v for k, v in soc.items()}, 'language', 'off', 'shuffled'), ('Ripening, hard world (10)', load('ripening-eval-01')['secondary']['meanFitness'], 'language', 'off', 'shuffled'),
              ('Ripening, fair world K=4 (11)', load('ripening11-eval-01')['secondary']['meanFitness'], 'language', 'off', 'shuffled')]
    W, H, T, B = 800, 400, 90, 70; s = Svg(W, H); s.text(20, 28, 'Cue manipulation: true, absent, or mismatched', 15, weight='bold')
    s.text(20, 46, 'Mean fitness over 8 training seeds; mismatch relabels the cue consistently.', 12, fill=C['gray'])
    pw = (W - 40) / 3; cond = [('language', 'true', 1.0), ('off', 'absent', .55), ('shuffled', 'mismatched', .25)]
    for pi, (title, mf, *_) in enumerate(panels):
        x0 = 40 + pi * pw; vals = [v for k, v in mf.items()]; ymax = max(vals) * 1.18
        Y = lambda v: T + (1 - v / ymax) * (H - T - B); s.text(x0 + pw / 2 - 6, T - 14, title, 12, 'middle', weight='bold'); s.line(x0, Y(0), x0 + pw - 20, Y(0), C['ink'])
        for gi, p in enumerate(['laya', 'none', 'vader']):
            gx = x0 + 6 + gi * (pw - 12) / 3
            for ci, (c, lab, op) in enumerate(cond):
                v = mf[f'{p}|{c}']; bx = gx + ci * 24
                s.rect(bx, Y(v), 22, Y(0) - Y(v), C[p], op); s.text(bx + 11, Y(v) - 4, f'{v:.2f}', 10, 'middle', C['gray'])
            s.text(gx + 36, Y(0) + 18, p, 12, 'middle')
    for i, (c, lab, op) in enumerate(cond): s.rect(40 + i * 130, H - 28, 12, 12, C['ink'], op); s.text(58 + i * 130, H - 18, lab + ' cue', 11)
    s.save('fig3_cues.svg')

# ---------- Figure 4: quality of the prior (AUC, nutritious vs. toxic) ----------
def fig_auc():
    a = load('heldout-eval-01')['priorQuality']; f = load('prior-quality-factual-01')['rows']
    data = [('Sentiment dialect\n(held-out, 1500 items)', {'Laya': a['Laya']['auc'], 'VADER': a['VADER']['auc'], 'Shuffled Laya': a['打乱的Laya']['auc']}), ('Factual dialect\n(4000 items)', {'Laya': f['Laya']['aucAll'], 'VADER': f['VADER']['aucAll'], 'Shuffled Laya': f['打乱的Laya']['aucAll']})]
    cols = {'Laya': C['laya'], 'VADER': C['vader'], 'Shuffled Laya': C['gray']}; W, H, L, T, B = 640, 400, 70, 70, 80; s = Svg(W, H); Y = lambda v: T + (1 - (v - 0.4) / 0.6) * (H - T - B)
    s.text(20, 28, 'Prior quality: Laya reads meaning, the lexicon reads sentiment', 15, weight='bold'); s.text(20, 46, 'AUC for nutritious vs. toxic descriptions (0.5 = chance)', 12, fill=C['gray'])
    for v in [0.5, 0.6, 0.7, 0.8, 0.9, 1.0]: s.line(L, Y(v), W - 20, Y(v), C['ink'] if v == 0.5 else C['grid']); s.text(L - 8, Y(v) + 4, f'{v:.1f}', 11, 'end', C['gray'])
    for gi, (name, vals) in enumerate(data):
        gx = L + 30 + gi * 270
        for bi, (k, v) in enumerate(vals.items()):
            bx = gx + bi * 62; s.rect(bx, Y(v), 52, Y(0.5) - Y(v), cols[k]); s.text(bx + 26, Y(v) - 5, f'{v:.3f}', 11, 'middle'); s.text(bx + 26, H - B + 16, k, 10, 'middle', C['gray'])
        for i, ln in enumerate(name.split('\n')): s.text(gx + 90, H - B + 40 + i * 15, ln, 12, 'middle')
    s.save('fig4_auc.svg')

if __name__ == '__main__':
    fig_forest(); fig_delay(); fig_cues(); fig_auc()
    if shutil.which('rsvg-convert'):   # arXiv / LaTeX 需要 PDF；有 rsvg-convert 时一并生成
        for svg in sorted(OUT.glob('*.svg')): subprocess.run(['rsvg-convert', '-f', 'pdf', '-o', str(svg.with_suffix('.pdf')), str(svg)], check=True)
    print('wrote', *sorted(p.name for p in OUT.iterdir()))
