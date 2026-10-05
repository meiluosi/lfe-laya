// 预注册 03：重复进化的留出评估（协议见 docs/PREREGISTRATION_03.md）。一次性运行。
// 用法：node packages/evo/heldout-rep-eval.ts <新输出目录> --dialect heldout            （正式：要求 12 个基因组哈希与预注册一致）
//       node packages/evo/heldout-rep-eval.ts <新输出目录> --dialect test --seeds 3 --dry （开发空跑）
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runSemanticWorld, type SemanticFactory } from './semantic-run.ts';
import { registerPools, loadLayaPriors, shuffledPrior, vaderPrior, type Priors } from './pools.ts';
import { structuredCohort } from './structured.ts';

const args = process.argv.slice(2), out = args[0]; if (!out) throw Error('Usage: node packages/evo/heldout-rep-eval.ts <new-output-directory> --dialect heldout|test [--seeds N] [--dry]');
const dialect = (args[args.indexOf('--dialect') + 1] ?? 'heldout') as 'heldout' | 'test', dry = args.includes('--dry');
const N = args.includes('--seeds') ? Number(args[args.indexOf('--seeds') + 1]) : 48;
// ---- 冻结的协议常量（与 PREREGISTRATION_03.md 一致）----
const K = 32, HARM_CAP = 4, SEED_BASE = dialect === 'heldout' ? 160000 : 260000, BOOTSTRAP = 10000, THRESHOLD_H1 = 0.04;
const CELLS = [{ id: 'inv0-delay0', inversion: 0, delay: 0 }, { id: 'inv0-delay20', inversion: 0, delay: 20 }, { id: 'inv25-delay0', inversion: .25, delay: 0 }, { id: 'inv25-delay20', inversion: .25, delay: 20 }];
const CONDS = ['laya', 'none', 'shuffled', 'vader'] as const, RUNS = [1, 2, 3] as const;
const dirOf = (c: string, r: number) => `experiments/evo/st2-${c}-0${r}`;

if (dialect === 'heldout' && !dry) {
  const frozen = JSON.parse(readFileSync('experiments/prereg/genome-hashes-03.json', 'utf8')) as Record<string, string>;
  for (const c of CONDS) for (const r of RUNS) { const k = `${c}-${r}`, h = createHash('sha256').update(readFileSync(`${dirOf(c, r)}/final.json`)).digest('hex'); if (frozen[k] !== h) throw Error(`genome_hash_mismatch:${k}`); }
}
mkdirSync(out, { recursive: false });
const pools = registerPools(); if (!pools[dialect]) throw Error(`pool_missing:${dialect}`);
const layaPri = loadLayaPriors(dialect); if (layaPri.size < pools[dialect]!.length) throw Error(`laya_prior_incomplete:${layaPri.size}/${pools[dialect]!.length}`);
const priorOf: Record<string, Priors> = { laya: layaPri, none: new Map<string, number>(), shuffled: shuffledPrior(layaPri, 3), vader: vaderPrior() };
const systems: Record<string, SemanticFactory> = {};
for (const c of CONDS) for (const r of RUNS) { const g: number[] = JSON.parse(readFileSync(`${dirOf(c, r)}/final.json`, 'utf8')).innate; systems[`${c}-${r}`] = () => structuredCohort(g, c === 'none' ? 'none' : 'laya', priorOf[c]); }

type Row = { fitness: number; toxicBites: number; survival: number };
const perCell: Record<string, Record<string, Row[]>> = {};
for (const cell of CELLS) {
  perCell[cell.id] = {};
  const specs = Array.from({ length: N }, (_, i) => ({ seed: SEED_BASE + i + CELLS.indexOf(cell) * 10000, options: { split: 'test' as const, pool: dialect, sensible: K, harmCap: HARM_CAP, inversion: cell.inversion, ...(cell.delay ? { delay: cell.delay } : {}) } }));
  for (const [name, f] of Object.entries(systems)) { perCell[cell.id][name] = specs.map(s => runSemanticWorld(s, f)); console.log(cell.id.padEnd(14), name.padEnd(12), (perCell[cell.id][name].reduce((a, r) => a + r.fitness, 0) / N).toFixed(3)); }
}
// ---- 统计：每个训练种子内，按 (格, 世界种子) 配对 bootstrap；假设成立 = 三个训练种子的单侧 p 全部小于 Holm α（交集检验）----
let rs = 20261006; const rand = () => { rs = (rs + 0x6D2B79F5) >>> 0; let t = rs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const diffs = (a: string, b: string) => CELLS.flatMap(c => perCell[c.id][a].map((r, i) => r.fitness - perCell[c.id][b][i].fitness));
function paired(a: string, b: string) {
  const d = diffs(a, b), boots = Array.from({ length: BOOTSTRAP }, () => mean(d.map(() => d[Math.floor(rand() * d.length)]))).sort((x, y) => x - y);
  return { diff: mean(d), lo: boots[Math.floor(BOOTSTRAP * .025)], hi: boots[Math.floor(BOOTSTRAP * .975)], p: boots.filter(x => x <= 0).length / BOOTSTRAP };
}
const hyps = [{ id: 'H1', claim: 'laya 优于 none（先验有用）', b: 'none' }, { id: 'H2', claim: 'laya 优于 shuffled（增益来自语义）', b: 'shuffled' }, { id: 'H3', claim: 'laya 优于 vader（Laya 的广度）', b: 'vader' }];
const detail = hyps.map(h => { const per = RUNS.map(r => ({ run: r, ...paired(`laya-${r}`, `${h.b}-${r}`) })); return { ...h, per, pMax: Math.max(...per.map(x => x.p)), loMin: Math.min(...per.map(x => x.lo)), meanDiff: mean(per.map(x => x.diff)) }; }).sort((x, y) => x.pMax - y.pMax);
let stop = false;
const verdicts = detail.map((t, i) => { const alpha = +(0.05 / (detail.length - i)).toFixed(4), ok = !stop && t.pMax < alpha && t.loMin > 0 && (t.id !== 'H1' || t.meanDiff >= THRESHOLD_H1); if (!ok) stop = true; return { id: t.id, claim: t.claim, meanDiff: +t.meanDiff.toFixed(4), pMax: +t.pMax.toFixed(4), holmAlpha: alpha, perRun: t.per.map(x => ({ run: x.run, diff: +x.diff.toFixed(4), ci95: [+x.lo.toFixed(4), +x.hi.toFixed(4)], p: +x.p.toFixed(4) })), supported: ok }; });
const cellMeans = Object.fromEntries(CELLS.map(c => [c.id, Object.fromEntries(Object.keys(systems).map(n => [n, { fitness: +mean(perCell[c.id][n].map(r => r.fitness)).toFixed(3), toxicBites: +mean(perCell[c.id][n].map(r => r.toxicBites)).toFixed(0), survival: +mean(perCell[c.id][n].map(r => r.survival)).toFixed(3) }]))]));
const report = { protocol: 'docs/PREREGISTRATION_03.md', dialect, dry, worldsPerCell: N, cells: CELLS, K, harmCap: HARM_CAP, seedBase: SEED_BASE, bootstrap: BOOTSTRAP, primary: verdicts, cellMeans, perSeedFitness: Object.fromEntries(CELLS.map(c => [c.id, Object.fromEntries(Object.entries(perCell[c.id]).map(([n, v]) => [n, v.map(r => +r.fitness.toFixed(4))]))])) };
writeFileSync(`${out}/results.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ primary: verdicts }, null, 1));
