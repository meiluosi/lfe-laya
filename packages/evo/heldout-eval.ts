// 预注册留出评估（协议见 docs/PREREGISTRATION_02.md）。一次性运行；留出方言在冻结前不被任何控制器见过。
// 用法：node packages/evo/heldout-eval.ts <新输出目录> --dialect heldout            （正式评估：要求基因组哈希与预注册一致）
//       node packages/evo/heldout-eval.ts <新输出目录> --dialect test --seeds 6 --dry （开发空跑：用开发方言和较少种子验证流程）
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runSemanticWorld, explorerRule, oracleRule, blindRule, type SemanticFactory } from './semantic-run.ts';
import { registerPools, loadLayaPriors, shuffledPrior, vaderPrior, genericLexiconPrior, trainedLexiconPrior, type Priors } from './pools.ts';
import { structuredCohort } from './structured.ts';

const args = process.argv.slice(2), out = args[0]; if (!out) throw Error('Usage: node packages/evo/heldout-eval.ts <new-output-directory> --dialect heldout|test [--seeds N] [--dry]');
const dialect = (args[args.indexOf('--dialect') + 1] ?? 'heldout') as 'heldout' | 'test', dry = args.includes('--dry');
const N = args.includes('--seeds') ? Number(args[args.indexOf('--seeds') + 1]) : 48;
// ---- 冻结的协议常量（与 PREREGISTRATION_02.md 一致）----
const K = 32, HARM_CAP = 4, SEED_BASE = dialect === 'heldout' ? 150000 : 250000, CREDIT_WINDOW = 50, BOOTSTRAP = 10000, THRESHOLD_H1 = 0.04;
const CELLS = [{ id: 'inv0-delay0', inversion: 0, delay: 0 }, { id: 'inv0-delay20', inversion: 0, delay: 20 }, { id: 'inv25-delay0', inversion: .25, delay: 0 }, { id: 'inv25-delay20', inversion: .25, delay: 20 }];
const GENOMES = ['laya', 'none', 'shuffled', 'vader'] as const;

if (dialect === 'heldout' && !dry) {
  const frozen = JSON.parse(readFileSync('experiments/prereg/genome-hashes.json', 'utf8')) as Record<string, string>;
  for (const g of GENOMES) { const h = createHash('sha256').update(readFileSync(`experiments/evo/st2-${g}-01/final.json`)).digest('hex'); if (frozen[g] !== h) throw Error(`genome_hash_mismatch:${g}（预注册 ${frozen[g]?.slice(0, 12)}，实际 ${h.slice(0, 12)}）`); }
}
mkdirSync(out, { recursive: false });
const pools = registerPools(); if (!pools[dialect]) throw Error(`pool_missing:${dialect}`);
const layaPri = loadLayaPriors(dialect); if (layaPri.size < pools[dialect]!.length) throw Error(`laya_prior_incomplete:${layaPri.size}/${pools[dialect]!.length}`);
const none = new Map<string, number>(), shuffled = shuffledPrior(layaPri, 3), vader = vaderPrior(), generic = genericLexiconPrior(), trained = trainedLexiconPrior(pools.train);
const genes = (g: string): number[] => {
  const dir = `experiments/evo/st2-${g}-01`;
  if (existsSync(`${dir}/final.json`)) return JSON.parse(readFileSync(`${dir}/final.json`, 'utf8')).innate;
  if (!dry) throw Error(`final_missing:${g}`);                                      // 正式评估只用训练完成的基因组
  const latest = readdirSync(dir).filter(f => f.startsWith('theta-gen')).sort().at(-1); if (!latest) throw Error(`no_checkpoint:${g}`);
  return JSON.parse(readFileSync(`${dir}/${latest}`, 'utf8')).innate;               // 空跑：用最近的中间检查点验证流程
};
const priorOf: Record<string, Priors> = { laya: layaPri, none, shuffled, vader };
const systems: Record<string, SemanticFactory> = {
  'blind（规则）': blindRule, 'oracle（隐藏真值，仅上限）': oracleRule,
  '手写·无先验学习者': explorerRule(none, { mode: 'none', creditWindow: CREDIT_WINDOW }),
  '手写·Laya 自适应': explorerRule(layaPri, { mode: 'adaptive', creditWindow: CREDIT_WINDOW }), '手写·VADER 自适应': explorerRule(vader, { mode: 'adaptive', creditWindow: CREDIT_WINDOW }),
};
for (const g of GENOMES) { const gg = genes(g); systems[`进化·${g}`] = () => structuredCohort(gg, g === 'none' ? 'none' : 'laya', priorOf[g]); }

type Row = { fitness: number; toxicBites: number; survival: number };
const perCell: Record<string, Record<string, Row[]>> = {};
for (const cell of CELLS) {
  perCell[cell.id] = {};
  const specs = Array.from({ length: N }, (_, i) => ({ seed: SEED_BASE + i + CELLS.indexOf(cell) * 10000, options: { split: 'test' as const, pool: dialect, sensible: K, harmCap: HARM_CAP, inversion: cell.inversion, ...(cell.delay ? { delay: cell.delay } : {}) } }));
  for (const [name, f] of Object.entries(systems)) { perCell[cell.id][name] = specs.map(s => runSemanticWorld(s, f)); console.log(cell.id.padEnd(14), name.padEnd(26), (perCell[cell.id][name].reduce((a, r) => a + r.fitness, 0) / N).toFixed(3)); }
}
// ---- 统计：按 (格, 种子) 配对，合并后 bootstrap（按种子重采样，保持格内配对）----
let rs = 20261005; const rand = () => { rs = (rs + 0x6D2B79F5) >>> 0; let t = rs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pooledDiffs = (a: string, b: string) => CELLS.flatMap(c => perCell[c.id][a].map((r, i) => r.fitness - perCell[c.id][b][i].fitness));
function paired(a: string, b: string) {
  const d = pooledDiffs(a, b), boots = Array.from({ length: BOOTSTRAP }, () => mean(d.map(() => d[Math.floor(rand() * d.length)]))).sort((x, y) => x - y);
  return { diff: mean(d), lo: boots[Math.floor(BOOTSTRAP * .025)], hi: boots[Math.floor(BOOTSTRAP * .975)], pOneSided: boots.filter(x => x <= 0).length / BOOTSTRAP, n: d.length };
}
const primary = [{ id: 'H1', claim: '进化·laya 优于 进化·none（先验有用）', a: '进化·laya', b: '进化·none' }, { id: 'H2', claim: '进化·laya 优于 进化·shuffled（增益来自语义）', a: '进化·laya', b: '进化·shuffled' }, { id: 'H3', claim: '进化·laya 优于 进化·vader（Laya 的广度）', a: '进化·laya', b: '进化·vader' }];
const tests = primary.map(h => ({ ...h, ...paired(h.a, h.b) })).sort((x, y) => x.pOneSided - y.pOneSided);
tests.forEach((t, i) => { (t as Record<string, unknown>).holmAlpha = +(0.05 / (tests.length - i)).toFixed(4); });
let stop = false; const verdicts = tests.map(t => { const ok = !stop && t.pOneSided < (t as unknown as { holmAlpha: number }).holmAlpha && t.lo > 0 && (t.id !== 'H1' || t.diff >= THRESHOLD_H1); if (!ok) stop = true; return { id: t.id, claim: t.claim, diff: +t.diff.toFixed(4), ci95: [+t.lo.toFixed(4), +t.hi.toFixed(4)], pOneSided: +t.pOneSided.toFixed(4), holmAlpha: (t as unknown as { holmAlpha: number }).holmAlpha, supported: ok }; });
const secondary = Object.fromEntries(CELLS.map(c => [c.id, Object.fromEntries(Object.keys(systems).map(n => [n, { fitness: +mean(perCell[c.id][n].map(r => r.fitness)).toFixed(3), toxicBites: +mean(perCell[c.id][n].map(r => r.toxicBites)).toFixed(0), survival: +mean(perCell[c.id][n].map(r => r.survival)).toFixed(3) }]))]));
const exploratory = Object.fromEntries([['进化·laya − 手写·Laya 自适应', '进化·laya', '手写·Laya 自适应'], ['进化·laya − 手写·无先验学习者', '进化·laya', '手写·无先验学习者'], ['手写·Laya 自适应 − 手写·VADER 自适应', '手写·Laya 自适应', '手写·VADER 自适应']].map(([k, a, b]) => { const r = paired(a, b); return [k, { diff: +r.diff.toFixed(4), ci95: [+r.lo.toFixed(4), +r.hi.toFixed(4)] }]; }));
// 先验质量（池层面）
const auc = (pairs: [number, boolean][]) => { const pos = pairs.filter(p => p[1]).map(p => p[0]), neg = pairs.filter(p => !p[1]).map(p => p[0]); let w = 0; for (const p of pos) for (const q of neg) w += p > q ? 1 : p === q ? .5 : 0; return w / (pos.length * neg.length); };
const quality = Object.fromEntries(Object.entries({ Laya: layaPri, VADER: vader, 作者自写通用词典: generic, 训练方言词典: trained, 打乱的Laya: shuffled }).map(([n, p]) => [n, { auc: +auc(pools[dialect]!.slice(0, 1500).map(e => [p.get(e.text) ?? .5, e.factor > 0] as [number, boolean])).toFixed(3) }]));
const report = { protocol: 'docs/PREREGISTRATION_02.md', dialect, dry, seeds: N, cells: CELLS, K, harmCap: HARM_CAP, seedBase: SEED_BASE, bootstrap: BOOTSTRAP, primary: verdicts, exploratory, secondary, priorQuality: quality, perSeedFitness: Object.fromEntries(CELLS.map(c => [c.id, Object.fromEntries(Object.entries(perCell[c.id]).map(([n, v]) => [n, v.map(r => +r.fitness.toFixed(4))]))])) };
writeFileSync(`${out}/results.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ primary: verdicts, exploratory, priorQuality: quality }, null, 1));
