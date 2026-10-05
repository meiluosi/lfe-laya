// 预注册 04：更长延迟、更强欺骗世界里的先验价值与稳定性（协议见 docs/PREREGISTRATION_04.md）。一次性运行。
// 用法：node packages/evo/heldout-long-eval.ts <新输出目录> --dialect heldout              （正式：要求 24 个基因组哈希与预注册一致）
//       node packages/evo/heldout-long-eval.ts <新输出目录> --dialect test --seeds 3 --dry --runs 1,2,3 （开发空跑）
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runSemanticWorld, type SemanticFactory } from './semantic-run.ts';
import { registerPools, loadLayaPriors, vaderPrior, type Priors } from './pools.ts';
import { structuredCohort } from './structured.ts';

const args = process.argv.slice(2), out = args[0]; if (!out) throw Error('Usage: node packages/evo/heldout-long-eval.ts <new-output-directory> --dialect heldout|test [--seeds N] [--dry] [--runs 1,2,3]');
const dialect = (args[args.indexOf('--dialect') + 1] ?? 'heldout') as 'heldout' | 'test', dry = args.includes('--dry');
const N = args.includes('--seeds') ? Number(args[args.indexOf('--seeds') + 1]) : 32;
// ---- 冻结的协议常量（与 PREREGISTRATION_04.md 一致）----
const K = 32, HARM_CAP = 4, SEED_BASE = dialect === 'heldout' ? 170000 : 270000;
const T_H1 = 0.04, T_H2 = 0.67, T_H3 = 0.03;
const CELLS = [{ id: 'inv25-delay0', inversion: .25, delay: 0 }, { id: 'inv40-delay0', inversion: .4, delay: 0 }, { id: 'inv25-delay40', inversion: .25, delay: 40 }, { id: 'inv40-delay40', inversion: .4, delay: 40 }];
const CONDS = ['laya', 'none', 'vader'] as const;
const RUNS = (args.includes('--runs') ? args[args.indexOf('--runs') + 1].split(',').map(Number) : [11, 12, 13, 14, 15, 16, 17, 18]);
const pad = (r: number) => String(r).padStart(2, '0'), dirOf = (c: string, r: number) => `experiments/evo/st2-${c}-${pad(r)}`;

if (dialect === 'heldout' && !dry) {
  const frozen = JSON.parse(readFileSync('experiments/prereg/genome-hashes-04.json', 'utf8')) as Record<string, string>;
  for (const c of CONDS) for (const r of RUNS) { const k = `${c}-${r}`, h = createHash('sha256').update(readFileSync(`${dirOf(c, r)}/final.json`)).digest('hex'); if (frozen[k] !== h) throw Error(`genome_hash_mismatch:${k}`); }
}
mkdirSync(out, { recursive: false });
const pools = registerPools(); if (!pools[dialect]) throw Error(`pool_missing:${dialect}`);
const layaPri = loadLayaPriors(dialect); if (layaPri.size < pools[dialect]!.length) throw Error(`laya_prior_incomplete:${layaPri.size}/${pools[dialect]!.length}`);
const priorOf: Record<string, Priors> = { laya: layaPri, none: new Map<string, number>(), vader: vaderPrior() };
const dirFor = (c: string, r: number) => dry && r <= 3 ? `experiments/evo/st2-${c}-0${r}` : dirOf(c, r);
const systems: Record<string, SemanticFactory> = {};
for (const c of CONDS) for (const r of RUNS) { const g: number[] = JSON.parse(readFileSync(`${dirFor(c, r)}/final.json`, 'utf8')).innate; systems[`${c}-${r}`] = () => structuredCohort(g, c === 'none' ? 'none' : 'laya', priorOf[c]); }

type Row = { fitness: number; toxicBites: number; survival: number };
const perCell: Record<string, Record<string, Row[]>> = {};
for (const cell of CELLS) {
  perCell[cell.id] = {};
  const specs = Array.from({ length: N }, (_, i) => ({ seed: SEED_BASE + i + CELLS.indexOf(cell) * 10000, options: { split: 'test' as const, pool: dialect, sensible: K, harmCap: HARM_CAP, inversion: cell.inversion, ...(cell.delay ? { delay: cell.delay } : {}) } }));
  for (const [name, f] of Object.entries(systems)) { perCell[cell.id][name] = specs.map(s => runSemanticWorld(s, f)); console.log(cell.id.padEnd(14), name.padEnd(10), (perCell[cell.id][name].reduce((a, r) => a + r.fitness, 0) / N).toFixed(3)); }
}
// ---- 统计：分析单位是训练种子（精确符号翻转 / 标签交换检验）----
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); };
const cellMean = (cell: string, sys: string) => mean(perCell[cell][sys].map(r => r.fitness));
const over = (cells: string[], sys: string) => mean(cells.map(c => cellMean(c, sys)));
const L40 = CELLS.filter(c => c.delay > 0).map(c => c.id), L0 = CELLS.filter(c => !c.delay).map(c => c.id), ALL = CELLS.map(c => c.id);
const D = (b: string, cells: string[]) => RUNS.map(r => over(cells, `laya-${r}`) - over(cells, `${b}-${r}`));
const signFlipP = (d: number[]) => { const obs = mean(d); let ge = 0; const n = d.length; for (let m = 0; m < 1 << n; m++) { let s = 0; for (let i = 0; i < n; i++) s += (m >> i & 1) ? -d[i] : d[i]; if (s / n >= obs - 1e-12) ge++; } return ge / (1 << n); };
const d40 = D('none', L40), d0 = D('none', L0), dInter = d40.map((x, i) => x - d0[i]);
const laya = RUNS.map(r => over(ALL, `laya-${r}`)), none = RUNS.map(r => over(ALL, `none-${r}`));
const sdStat = (a: number[], b: number[]) => sd(b) - sd(a);   // SD_none − SD_laya
const swapP = () => { const obs = sdStat(laya, none); let ge = 0; const n = RUNS.length; for (let m = 0; m < 1 << n; m++) { const a = RUNS.map((_, i) => (m >> i & 1) ? none[i] : laya[i]), b = RUNS.map((_, i) => (m >> i & 1) ? laya[i] : none[i]); if (sdStat(a, b) >= obs - 1e-12) ge++; } return ge / (1 << n); };
const hyps = [
  { id: 'H1', claim: '延迟 40 世界里 laya 优于 none', stat: mean(d40), thr: T_H1, ok: mean(d40) >= T_H1, p: signFlipP(d40), perSeed: d40 },
  { id: 'H2', claim: 'laya 个体的跨种子标准差不大于 none 的 0.67 倍', stat: sd(laya) / sd(none), thr: T_H2, ok: sd(laya) <= T_H2 * sd(none), p: swapP(), perSeed: laya.map((x, i) => x - none[i]) },
  { id: 'H3', claim: '先验的价值随延迟增加（D40 − D0）', stat: mean(dInter), thr: T_H3, ok: mean(dInter) >= T_H3, p: signFlipP(dInter), perSeed: dInter },
].sort((x, y) => x.p - y.p);
let stop = false;
const verdicts = hyps.map((h, i) => { const alpha = +(0.05 / (hyps.length - i)).toFixed(4), supported = !stop && h.p < alpha && h.ok; if (!supported) stop = true; return { id: h.id, claim: h.claim, statistic: +h.stat.toFixed(4), threshold: h.thr, effectOk: h.ok, p: +h.p.toFixed(4), holmAlpha: alpha, supported, perSeed: h.perSeed.map(x => +x.toFixed(4)) }; });
const secondary = {
  layaMinusVader: { delay40: D('vader', L40).map(x => +x.toFixed(4)), delay0: D('vader', L0).map(x => +x.toFixed(4)) },
  layaMinusNoneByCell: Object.fromEntries(CELLS.map(c => [c.id, RUNS.map(r => +(cellMean(c.id, `laya-${r}`) - cellMean(c.id, `none-${r}`)).toFixed(4))])),
  sdAcrossSeeds: { laya: +sd(laya).toFixed(4), none: +sd(none).toFixed(4), vader: +sd(RUNS.map(r => over(ALL, `vader-${r}`))).toFixed(4) },
  meanFitness: Object.fromEntries(CONDS.map(c => [c, +mean(RUNS.map(r => over(ALL, `${c}-${r}`))).toFixed(4)])),
};
const cellMeans = Object.fromEntries(CELLS.map(c => [c.id, Object.fromEntries(Object.keys(systems).map(n => [n, { fitness: +cellMean(c.id, n).toFixed(3), toxicBites: +mean(perCell[c.id][n].map(r => r.toxicBites)).toFixed(0), survival: +mean(perCell[c.id][n].map(r => r.survival)).toFixed(3) }]))]));
const report = { protocol: 'docs/PREREGISTRATION_04.md', dialect, dry, runs: RUNS, worldsPerCell: N, cells: CELLS, K, harmCap: HARM_CAP, seedBase: SEED_BASE, primary: verdicts, secondary, cellMeans };
writeFileSync(`${out}/results.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ primary: verdicts, secondary }, null, 1));
