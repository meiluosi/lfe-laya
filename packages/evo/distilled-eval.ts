// 预注册 12：蒸馏头（先天读出）能否替代 Laya 的在线判断；训练世界随训练种子变化（协议见 docs/PREREGISTRATION_12.md）。一次性运行。
// 因素：先验 {laya, none, distilled} × 制度 {d40, d80}；8 个训练种子（71–78）= 48 次进化；个体均为 flat（结构化个体 v2）。
// 用法：node packages/evo/distilled-eval.ts <新输出目录>                       （正式：要求 48 个基因组哈希与预注册一致）
//       node packages/evo/distilled-eval.ts <新输出目录> --dry --seeds 2 --dir <基因组前缀>   （开发空跑，测试方言）
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runSemanticWorld, type SemanticFactory } from './semantic-run.ts';
import { registerPools, loadLayaPriors, type Priors } from './pools.ts';
import { structuredCohort } from './structured.ts';
import { distilledPrior } from './distill.ts';

const args = process.argv.slice(2), out = args[0]; if (!out) throw Error('Usage: node packages/evo/distilled-eval.ts <new-output-directory> [--dry] [--seeds N]');
const dry = args.includes('--dry'), N = args.includes('--seeds') ? Number(args[args.indexOf('--seeds') + 1]) : 32;
// ---- 冻结的协议常量（与 PREREGISTRATION_12.md 一致）----
const K = 32, HARM_CAP = 4, INVERSIONS = [.25, .4], REGIMES = [{ id: 'd40', delay: 40 }, { id: 'd80', delay: 80 }] as const, PRIORS = ['laya', 'none', 'distilled'] as const;
const RUN_IDS = dry ? [71, 72] : [71, 72, 73, 74, 75, 76, 77, 78], T_H1 = 0.03, MARGIN = -0.03, T_H3 = 0.015;
const POOLS: { id: 'heldout' | 'factual' | 'test'; base: number }[] = dry ? [{ id: 'test', base: 340000 }] : [{ id: 'heldout', base: 300000 }, { id: 'factual', base: 310000 }];
const dirOf = (p: string, r: string, s: number) => `${args.includes('--dir') ? args[args.indexOf('--dir') + 1] : 'experiments/evo/f12'}-${p}-${r}-${s}`;
const keys = PRIORS.flatMap(p => REGIMES.flatMap(r => RUN_IDS.map(s => ({ p, r: r.id, s, key: `${p}-${r.id}-${s}` }))));
if (!dry) {
  const frozen = JSON.parse(readFileSync('experiments/prereg/genome-hashes-12.json', 'utf8')) as Record<string, string>;
  for (const k of keys) { const h = createHash('sha256').update(readFileSync(`${dirOf(k.p, k.r, k.s)}/final.json`)).digest('hex'); if (frozen[k.key] !== h) throw Error(`genome_hash_mismatch:${k.key}`); }
}
mkdirSync(out, { recursive: false });
const registered = registerPools() as Record<string, unknown[] | undefined>;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function signFlipP(d: number[], shift = 0) { const x = d.map(v => v - shift), obs = mean(x), n = x.length; let ge = 0; for (let m = 0; m < 1 << n; m++) { let s = 0; for (let i = 0; i < n; i++) s += (m >> i & 1) ? -x[i] : x[i]; if (s / n >= obs - 1e-12) ge++; } return ge / (1 << n); }
type Row = { fitness: number; toxicBites: number; survival: number };
const fits: Record<string, Record<string, Record<string, Row[]>>> = {};
for (const pool of POOLS) {
  if (!registered[pool.id]) throw Error(`pool_missing:${pool.id}`);
  const layaPri = loadLayaPriors(pool.id as 'test'), size = (registered[pool.id] as unknown[]).length; if (layaPri.size < size) throw Error(`cache_incomplete:${pool.id}`);
  const priorT: Record<string, Priors> = { laya: layaPri, none: new Map<string, number>(), distilled: distilledPrior(pool.id) }; fits[pool.id] = {};
  for (const k of keys) {
    const g: number[] = JSON.parse(readFileSync(`${dirOf(k.p, k.r, k.s)}/final.json`, 'utf8')).innate, f: SemanticFactory = () => structuredCohort(g, k.p === 'none' ? 'none' : 'laya', priorT[k.p]), delay = REGIMES.find(r => r.id === k.r)!.delay; fits[pool.id][k.key] = {};
    INVERSIONS.forEach((inv, ci) => { const specs = Array.from({ length: N }, (_, i) => ({ seed: pool.base + i + ci * 10000 + (delay === 80 ? 20000 : 0), options: { split: 'test' as const, pool: pool.id, sensible: K, harmCap: HARM_CAP, inversion: inv, delay } })); fits[pool.id][k.key][`inv${inv}`] = specs.map(s => runSemanticWorld(s, f)); });
    console.log(pool.id.padEnd(8), k.key.padEnd(16), mean(Object.values(fits[pool.id][k.key]).flat().map(r => r.fitness)).toFixed(3));
  }
}
const cell = (pool: string, key: string) => mean(INVERSIONS.flatMap(i => fits[pool][key][`inv${i}`].map(r => r.fitness)));
const diff = (pool: string, a: string, b: string, r: string) => RUN_IDS.map(s => cell(pool, `${a}-${r}-${s}`) - cell(pool, `${b}-${r}-${s}`));
const mainPool = dry ? 'test' : 'heldout', factPool = dry ? 'test' : 'factual';
const hyps = [
  { id: 'H1', claim: `延迟 80、留出方言：distilled 优于 none 至少 ${T_H1}（先天化的知识有用）`, d: diff(mainPool, 'distilled', 'none', 'd80'), thr: T_H1, shift: 0, ok: (m: number) => m >= T_H1 },
  { id: 'H2', claim: `延迟 80、留出方言：distilled 不比 laya 差超过 ${-MARGIN}（非劣效）`, d: diff(mainPool, 'distilled', 'laya', 'd80'), thr: MARGIN, shift: MARGIN, ok: (m: number) => m > MARGIN },
  { id: 'H3', claim: `延迟 80、事实方言：laya 优于 distilled 至少 ${T_H3}（Laya 保留线性头没有的知识）`, d: diff(factPool, 'laya', 'distilled', 'd80'), thr: T_H3, shift: 0, ok: (m: number) => m >= T_H3 },
].map(h => ({ ...h, stat: mean(h.d), p: signFlipP(h.d, h.shift) }));
const sorted = hyps.slice().sort((a, b) => a.p - b.p || a.id.localeCompare(b.id)), reject = new Map<string, boolean>(); let stop = false;
sorted.forEach((h, i) => { const r = !stop && h.p < 0.05 / (sorted.length - i); if (!r) stop = true; reject.set(h.id, r); });
const r4 = (x: number) => +x.toFixed(4);
const verdicts = hyps.map(h => ({ id: h.id, claim: h.claim, statistic: r4(h.stat), threshold: h.thr, effectOk: h.ok(h.stat), p: r4(h.p), holmReject: reject.get(h.id)!, supported: reject.get(h.id)! && h.ok(h.stat), perSeed: h.d.map(r4) }));
const secondary = Object.fromEntries(POOLS.map(pool => [pool.id, {
  distilledMinusNone: Object.fromEntries(REGIMES.map(r => [r.id, diff(pool.id, 'distilled', 'none', r.id).map(r4)])),
  distilledMinusLaya: Object.fromEntries(REGIMES.map(r => [r.id, diff(pool.id, 'distilled', 'laya', r.id).map(r4)])),
  layaMinusNone: Object.fromEntries(REGIMES.map(r => [r.id, diff(pool.id, 'laya', 'none', r.id).map(r4)])),
  means: Object.fromEntries(PRIORS.flatMap(p => REGIMES.map(r => [`${p}-${r.id}`, r4(mean(RUN_IDS.map(s => cell(pool.id, `${p}-${r.id}-${s}`))))]))),
  toxicBites: Object.fromEntries(PRIORS.flatMap(p => REGIMES.map(r => [`${p}-${r.id}`, +mean(RUN_IDS.flatMap(s => Object.values(fits[pool.id][`${p}-${r.id}-${s}`]).flat().map(x => x.toxicBites))).toFixed(0)]))),
}]));
writeFileSync(`${out}/results.json`, JSON.stringify({ protocol: 'docs/PREREGISTRATION_12.md', dry, worldsPerCell: N, K, harmCap: HARM_CAP, inversions: INVERSIONS, seeds: RUN_IDS, primary: verdicts, secondary }, null, 2)); console.log(JSON.stringify(verdicts, null, 1));
