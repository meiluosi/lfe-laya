"""博客用图（G10–G13）：全部从 experiments/ 下的原始结果文件读取，不手改数字。输出 docs/figures/*.png。
用法：python3 scripts/make_blog_figures.py"""
import json, statistics as st
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

plt.rcParams.update({'font.size': 11, 'axes.spines.top': False, 'axes.spines.right': False, 'figure.dpi': 130, 'savefig.bbox': 'tight', 'font.family': 'DejaVu Sans'})
C = {'plain': '#9aa3ad', 'regime': '#3b82a0', 'benv': '#d9822b', 'oracle': '#6aa84f', 'bad': '#c0504d', 'mixed': '#3b82a0', 'clean': '#c0504d', 'blind': '#9aa3ad'}

def seed_vals(path):
    r = json.load(open(path)); return r

# 图 1：保留（节省）——plain / regime / latent / cue（预注册 20）
r20 = seed_vals('experiments/evo/robust-eval-01/results.json')['cellMeans']
labels = [('mushroom', 'K6', 'aba-off', 'A/B/A\n(K=6)'), ('mushroom', 'K6', 'abab-off', 'A/B/A/B/A\n(K=6)'), ('mushroom', 'K6', 'half-off', 'partial\nreversal'), ('mushroom', 'K12', 'aba-off', 'A/B/A\n(K=12)')]
fig, ax = plt.subplots(figsize=(7.4, 3.8)); w = .2
for i, (name, col) in enumerate([('plain', C['plain']), ('latent', '#b9a3d6'), ('regime', C['regime'])]):
    ax.bar([k + (i - 1) * w for k in range(4)], [r20[p][f'{K}/{name}'][v]['savings'] for p, K, v, _ in labels], w, label={'plain': 'ordinary learner', 'latent': 'probabilistic comparator', 'regime': 'environment-table memory'}[name], color=col)
ax.axhline(0, color='k', lw=.8); ax.set_xticks(range(4)); ax.set_xticklabels([l[3] for l in labels]); ax.set_ylabel('savings (+ = remembers the old world)')
ax.set_title('Retention on independent data (UCI Mushroom), 16 fresh seeds'); ax.legend(frameon=False, fontsize=9, loc='upper left'); fig.savefig('docs/figures/fig1_retention.png'); plt.close(fig)

# 图 2：语言传感器（预注册 21）
r21 = seed_vals('experiments/evo/bayes-eval-01/results.json')['cellMeans']['mushroom']
conds = [('plain', 'ordinary\nlearner', C['plain']), ('regime', 'environment\ntable', C['regime']), ('cue', 'cue-keyed\nmemory', '#b9a3d6'), ('benv-off', 'Bayes,\nsensor off', '#c9ced4'), ('benv', 'Bayes +\nLLM sensor', C['benv']), ('benv@oracle', 'oracle\nsensor', C['oracle']), ('benv@shuffled', 'shuffled\nsensor', C['bad']), ('benv@wrong30', '30% inverted\njudgements', '#e0a09d')]
fig, axs = plt.subplots(1, 2, figsize=(10.5, 4.2), sharey=True)
names = [c[1].replace('\n', ' ') for c in conds][::-1]
for ax, key, title in [(axs[0], 'savings', 'savings (memory of the old world)'), (axs[1], 'fitness', 'fitness')]:
    ax.barh(range(len(conds)), [r21[c]['aba-para'][key] for c, _, _ in conds][::-1], color=[x[2] for x in conds][::-1]); ax.axvline(0, color='k', lw=.8)
    ax.set_yticks(range(len(conds))); ax.set_yticklabels(names, fontsize=9); ax.set_title(title)
fig.suptitle('Cue wording changes every phase (Mushroom, A/B/A, 16 seeds)', y=1.01); fig.tight_layout(); fig.savefig('docs/figures/fig2_language_sensor.png'); plt.close(fig)

# 图 3：线索可靠度（预注册 22）——干净历史 vs 混合历史 vs 不读线索
r22 = seed_vals('experiments/evo/cue-eval-01/results.json'); cm = r22['cellMeans']['mushroom']
cells = [('reliable/absent', 'cue\nreliable'), ('wrong.15/absent', 'misleads\n15%'), ('noisy/absent', 'misleads\n30%'), ('wrong.45/absent', 'misleads\n45%'), ('uninformative/absent', 'misleads\n50%'), ('absent/absent', 'no cue\nat all')]
fig, ax = plt.subplots(figsize=(8.2, 3.9)); w = .27
for i, (name, lab, col) in enumerate([('b3off', 'ignores cues', C['blind']), ('b3f1c', 'evolved where cues were always right', C['clean']), ('b3f1', 'evolved where cues sometimes lie', C['mixed'])]):
    ax.bar([k + (i - 1) * w for k in range(len(cells))], [cm[name][c] for c, _ in cells], w, label=lab, color=col)
ax.set_xticks(range(len(cells))); ax.set_xticklabels([l for _, l in cells], fontsize=9); ax.set_ylabel('fitness'); ax.set_ylim(0, 1.3)
ax.set_title('Innate trust must be evolved among unreliable cues (8 seeds, Mushroom)'); ax.legend(frameon=False, fontsize=8.5, loc='upper center', ncol=1); fig.savefig('docs/figures/fig3_reliability.png'); plt.close(fig)
print('ok')
