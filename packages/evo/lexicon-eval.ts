// 预注册 07：匹配训练下 Laya 与情感词典（VADER）的比较，以及延迟 40 → 80 的趋势（协议见 docs/PREREGISTRATION_07.md）。一次性运行。
// 因素：先验 {laya, none, vader} × 制度 {d40, d80}；8 个训练种子（31–38）= 48 次进化；个体均为 flat（无层次信念）。
// 用法：node packages/evo/lexicon-eval.ts <新输出目录>                                 （正式：要求 48 个基因组哈希与预注册一致）
//       node packages/evo/lexicon-eval.ts <新输出目录> --dry --seeds 2 --dir <基因组目录前缀>  （开发空跑，使用测试方言）
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runSemanticWorld, type SemanticFactory } from './semantic-run.ts';
import { registerPools, loadLayaPriors, vaderPrior, type Priors } from './pools.ts';
import { structuredCohort } from './structured.ts';

const args = process.argv.slice(2), out = args[0]; if (!out) throw Error('Usage: node packages/evo/lexicon-eval.ts <new-output-directory> [--dry] [--seeds N]');
const dry = args.includes('--dry'), N = args.includes('--seeds') ? Number(args[args.indexOf('--seeds') + 1]) : 32;
// ---- 冻结的协议常量（与 PREREGISTRATION_07.md 一致）----
const K = 32, HARM_CAP = 4, INVERSIONS = [.25, .4], REGIMES = [{ id: 'd40', delay: 40 }, { id: 'd80', delay: 80 }] as const;
const PRIORS = ['laya', 'none', 'vader'] as const, RUN_IDS = dry ? [31, 32] : [31, 32, 33, 34, 35, 36, 37, 38];
const T_H1 = 0.03, T_H2 = 0.04, T_H3 = 0.02;
const POOLS: { id: 'heldout' | 'factual' | 'test'; base: number }[] = dry ? [{ id: 'test', base: 300000 }] : [{ id: 'heldout', base: 200000 }, { id: 'factual', base: 210000 }];
const dirOf = (p: string, r: string, s: number) => `${args.includes('--dir') ? args[args.indexOf('--dir') + 1] : 'experiments/evo/f7'}-${p}-${r}-${s}`;
const keys = PRIORS.flatMap(p => REGIMES.flatMap(r => RUN_IDS.map(s => ({ p, r: r.id, s, key: `${p}-${r.id}-${s}` }))));
if (!dry) {
  const frozen = JSON.parse(readFileSync('experiments/prereg/genome-hashes-07.json', 'utf8')) as Record<string, string>;
  for (const k of keys) { const h = createHash('sha256').update(readFileSync(`${dirOf(k.p, k.r, k.s)}/final.json`)).digest('hex'); if (frozen[k.key] !== h) throw Error(`genome_hash_mismatch:${k.key}`); }
}
mkdirSync(out, { recursive: false });
const registered = registerPools() as Record<string, unknown[] | undefined>;
const geneOf = (k: typeof keys[number]): number[] => JSON.parse(readFileSync(`${dirOf(k.p, k.r, k.s)}/final.json`, 'utf8')).innate;

type Row = { fitness: number; toxicBites: number; survival: number };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function signFlipP(d: number[]) { const obs = mean(d), n = d.length; let ge = 0; for (let m = 0; m < 1 << n; m++) { let s = 0; for (let i = 0; i < n; i++) s += (m >> i & 1) ? -d[i] : d[i]; if (s / n >= obs - 1e-12) ge++; } return ge / (1 << n); }
const analysis: Record<string, any> = {};
for (const pool of POOLS) {
  if (!registered[pool.id]) throw Error(`pool_missing:${pool.id}`);
  const layaPri = loadLayaPriors(pool.id as 'test'), size = (registered[pool.id] as unknown[]).length; if (layaPri.size < size) throw Error(`cache_incomplete:${pool.id}`);
  const priorT: Record<string, Priors> = { laya: layaPri, none: new Map<string, number>(), vader: vaderPrior() };
  const fit: Record<string, Record<string, Row[]>> = {};
  for (const k of keys) {
    const g = geneOf(k), f: SemanticFactory = () => structuredCohort(g, k.p === 'none' ? 'none' : 'laya', priorT[k.p]), delay = REGIMES.find(r => r.id === k.r)!.delay; fit[k.key] = {};
    INVERSIONS.forEach((inv, ci) => {
      const specs = Array.from({ length: N }, (_, i) => ({ seed: pool.base + i + ci * 10000 + (delay === 80 ? 20000 : 0), options: { split: 'test' as const, pool: pool.id, sensible: K, harmCap: HARM_CAP, inversion: inv, delay } }));
      fit[k.key][`inv${inv}`] = specs.map(s => runSemanticWorld(s, f));
    });
    console.log(pool.id.padEnd(8), k.key.padEnd(14), (mean(Object.values(fit[k.key]).flat().map(r => r.fitness))).toFixed(3));
  }
  const cell = (key: string, invs: number[] = INVERSIONS) => mean(invs.flatMap(i => fit[key][`inv${i}`].map(r => r.fitness)));
  const diff = (a: string, b: string, r: string) => RUN_IDS.map(s => cell(`${a}-${r}-${s}`) - cell(`${b}-${r}-${s}`));
  analysis[pool.id] = { diff, fit, cell };
}
const A = (pool: string) => analysis[pool] as { diff: (a: string, b: string, r: string) => number[]; cell: (k: string, i?: number[]) => number; fit: Record<string, Record<string, Row[]>> };
const mainPool = dry ? 'test' : 'heldout', factPool = dry ? 'test' : 'factual';
const dH1 = A(factPool).diff('laya', 'vader', 'd40'), dH2 = A(mainPool).diff('laya', 'none', 'd80');
const dH3 = A(mainPool).diff('laya', 'none', 'd80').map((x, i) => x - A(mainPool).diff('laya', 'none', 'd40')[i]);
const hyps = [
  { id: 'H1', claim: `匹配训练（延迟 40）下，在事实方言上 laya 优于 vader 至少 ${T_H1}`, d: dH1, thr: T_H1 },
  { id: 'H2', claim: `匹配训练（延迟 80）下，在留出方言上 laya 优于 none 至少 ${T_H2}`, d: dH2, thr: T_H2 },
  { id: 'H3', claim: `先验的价值随延迟增加：(laya − none)@d80 − (laya − none)@d40 ≥ ${T_H3}（留出方言）`, d: dH3, thr: T_H3 },
].map(h => ({ ...h, stat: mean(h.d), p: signFlipP(h.d) }));
const sorted = hyps.slice().sort((a, b) => a.p - b.p || a.id.localeCompare(b.id)), reject = new Map<string, boolean>(); let stop = false;
sorted.forEach((h, i) => { const r = !stop && h.p < 0.05 / (sorted.length - i); if (!r) stop = true; reject.set(h.id, r); });
const verdicts = hyps.map(h => ({ id: h.id, claim: h.claim, statistic: +h.stat.toFixed(4), threshold: h.thr, effectOk: h.stat >= h.thr, p: +h.p.toFixed(4), holmReject: reject.get(h.id)!, supported: reject.get(h.id)! && h.stat >= h.thr, perSeed: h.d.map(x => +x.toFixed(4)) }));
const r4 = (x: number) => +x.toFixed(4);
const secondary = Object.fromEntries(Object.keys(analysis).map(pool => {
  const a = A(pool), per = (x: string, y: string, r: string) => a.diff(x, y, r).map(r4);
  const means = Object.fromEntries(PRIORS.flatMap(p => REGIMES.flatMap(r => INVERSIONS.map(i => [`${p}-${r.id}-inv${i}`, r4(mean(RUN_IDS.map(s => a.cell(`${p}-${r.id}-${s}`, [i]))))]))));
  const toxic = Object.fromEntries(PRIORS.flatMap(p => REGIMES.map(r => [`${p}-${r.id}`, +mean(RUN_IDS.flatMap(s => Object.values(a.fit[`${p}-${r.id}-${s}`]).flat().map(x => x.toxicBites))).toFixed(0)])));
  return [pool, { layaMinusVader: { d40: per('laya', 'vader', 'd40'), d80: per('laya', 'vader', 'd80') }, layaMinusNone: { d40: per('laya', 'none', 'd40'), d80: per('laya', 'none', 'd80') }, vaderMinusNone: { d40: per('vader', 'none', 'd40'), d80: per('vader', 'none', 'd80') }, cellMeans: means, toxicBites: toxic }];
}));
const report = { protocol: 'docs/PREREGISTRATION_07.md', dry, worldsPerCell: N, K, harmCap: HARM_CAP, inversions: INVERSIONS, regimes: REGIMES, seeds: RUN_IDS, primary: verdicts, secondary };
writeFileSync(`${out}/results.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(verdicts, null, 1));
