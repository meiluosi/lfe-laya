// 预注册 13：更强的经验学习器（延迟感知的滞后对齐信用）下，先验还有没有价值（协议见 docs/PREREGISTRATION_13.md）。一次性运行。
// 因素：先验 {laya, none} × 学习器 {plain, lag} × 制度 {d40, d80}；8 个训练种子（81–88）= 64 次进化；训练世界随训练种子变化。
// 用法：node packages/evo/strong-learner-eval.ts <新输出目录>                   （正式：要求 64 个基因组哈希与预注册一致）
//       node packages/evo/strong-learner-eval.ts <新输出目录> --dry --seeds 2 --dir <基因组前缀>   （开发空跑，测试方言）
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runSemanticWorld, blindRule, oracleRule, type SemanticFactory } from './semantic-run.ts';
import { registerPools, loadLayaPriors, type Priors } from './pools.ts';
import { structuredCohort } from './structured.ts';
import { structuredLagCohort, decodeLagGenes } from './structured-lag.ts';

const args = process.argv.slice(2), out = args[0]; if (!out) throw Error('Usage: node packages/evo/strong-learner-eval.ts <new-output-directory> [--dry] [--seeds N]');
const dry = args.includes('--dry'), N = args.includes('--seeds') ? Number(args[args.indexOf('--seeds') + 1]) : 32;
// ---- 冻结的协议常量（与 PREREGISTRATION_13.md 一致）----
const K = 32, HARM_CAP = 4, INVERSIONS = [.25, .4], REGIMES = [{ id: 'd40', delay: 40 }, { id: 'd80', delay: 80 }] as const, PRIORS = ['laya', 'none'] as const, LEARNERS = ['plain', 'lag'] as const;
const RUN_IDS = dry ? [81, 82] : [81, 82, 83, 84, 85, 86, 87, 88], T_H1 = 0.10, T_H2A = 0.02, MARGIN = -0.02, T_H3 = 0.03;
const POOLS: { id: 'heldout' | 'factual' | 'test'; base: number }[] = dry ? [{ id: 'test', base: 350000 }] : [{ id: 'heldout', base: 320000 }, { id: 'factual', base: 330000 }];
const dirOf = (p: string, l: string, r: string, s: number) => `${args.includes('--dir') ? args[args.indexOf('--dir') + 1] : 'experiments/evo/f13'}-${p}-${l}-${r}-${s}`;
const keys = PRIORS.flatMap(p => LEARNERS.flatMap(l => REGIMES.flatMap(r => RUN_IDS.map(s => ({ p, l, r: r.id, s, key: `${p}-${l}-${r.id}-${s}` })))));
if (!dry) {
  const frozen = JSON.parse(readFileSync('experiments/prereg/genome-hashes-13.json', 'utf8')) as Record<string, string>;
  for (const k of keys) { const h = createHash('sha256').update(readFileSync(`${dirOf(k.p, k.l, k.r, k.s)}/final.json`)).digest('hex'); if (frozen[k.key] !== h) throw Error(`genome_hash_mismatch:${k.key}`); }
}
mkdirSync(out, { recursive: false });
const registered = registerPools() as Record<string, unknown[] | undefined>;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function signFlipP(d: number[], shift = 0) { const x = d.map(v => v - shift), obs = mean(x), n = x.length; let ge = 0; for (let m = 0; m < 1 << n; m++) { let s = 0; for (let i = 0; i < n; i++) s += (m >> i & 1) ? -x[i] : x[i]; if (s / n >= obs - 1e-12) ge++; } return ge / (1 << n); }
type Row = { fitness: number; toxicBites: number; survival: number };
const fits: Record<string, Record<string, Record<string, Row[]>>> = {}, refs: Record<string, Record<string, number>> = {}, lagGenes: Record<string, { lag: number; width: number }> = {};
for (const pool of POOLS) {
  if (!registered[pool.id]) throw Error(`pool_missing:${pool.id}`);
  const layaPri = loadLayaPriors(pool.id as 'test'), size = (registered[pool.id] as unknown[]).length; if (layaPri.size < size) throw Error(`cache_incomplete:${pool.id}`);
  const priorT: Record<string, Priors> = { laya: layaPri, none: new Map<string, number>() }; fits[pool.id] = {}; refs[pool.id] = {};
  for (const k of keys) {
    const g: number[] = JSON.parse(readFileSync(`${dirOf(k.p, k.l, k.r, k.s)}/final.json`, 'utf8')).innate, delay = REGIMES.find(r => r.id === k.r)!.delay;
    if (k.l === 'lag') { const d = decodeLagGenes(g); lagGenes[k.key] = { lag: d.lag, width: d.width }; }
    const f: SemanticFactory = () => k.l === 'lag' ? structuredLagCohort(g, k.p === 'none' ? 'none' : 'laya', priorT[k.p]) : structuredCohort(g, k.p === 'none' ? 'none' : 'laya', priorT[k.p]); fits[pool.id][k.key] = {};
    INVERSIONS.forEach((inv, ci) => { const specs = Array.from({ length: N }, (_, i) => ({ seed: pool.base + i + ci * 10000 + (delay === 80 ? 20000 : 0), options: { split: 'test' as const, pool: pool.id, sensible: K, harmCap: HARM_CAP, inversion: inv, delay } })); fits[pool.id][k.key][`inv${inv}`] = specs.map(s => runSemanticWorld(s, f)); });
    console.log(pool.id.padEnd(8), k.key.padEnd(22), mean(Object.values(fits[pool.id][k.key]).flat().map(r => r.fitness)).toFixed(3));
  }
  for (const r of REGIMES) for (const [name, f] of [['blind', blindRule], ['oracle', oracleRule]] as const) refs[pool.id][`${name}-${r.id}`] = +mean(INVERSIONS.flatMap((inv, ci) => Array.from({ length: N }, (_, i) => runSemanticWorld({ seed: pool.base + i + ci * 10000 + (r.delay === 80 ? 20000 : 0), options: { split: 'test', pool: pool.id, sensible: K, harmCap: HARM_CAP, inversion: inv, delay: r.delay } }, f).fitness))).toFixed(4);
}
const cell = (pool: string, key: string) => mean(INVERSIONS.flatMap(i => fits[pool][key][`inv${i}`].map(r => r.fitness)));
const diff = (pool: string, a: [string, string], b: [string, string], r: string) => RUN_IDS.map(s => cell(pool, `${a[0]}-${a[1]}-${r}-${s}`) - cell(pool, `${b[0]}-${b[1]}-${r}-${s}`));
const mainPool = dry ? 'test' : 'heldout';
const hyps = [
  { id: 'H1', claim: `延迟 80：none-lag 优于 none-plain 至少 ${T_H1}（进化自己找到滞后，脱离“盲规则”式失效）`, d: diff(mainPool, ['none', 'lag'], ['none', 'plain'], 'd80'), thr: T_H1, shift: 0, ok: (m: number) => m >= T_H1 },
  { id: 'H2a', claim: `延迟 80：laya-lag 优于 none-lag 至少 ${T_H2A}（强学习器下先验仍有价值）`, d: diff(mainPool, ['laya', 'lag'], ['none', 'lag'], 'd80'), thr: T_H2A, shift: 0, ok: (m: number) => m >= T_H2A },
  { id: 'H2b', claim: `延迟 80：none-lag 不比 laya-lag 差超过 ${-MARGIN}（强学习器下先验不是必需，非劣效）`, d: diff(mainPool, ['none', 'lag'], ['laya', 'lag'], 'd80'), thr: MARGIN, shift: MARGIN, ok: (m: number) => m > MARGIN },
  { id: 'H3', claim: `延迟 80：laya-lag 优于 laya-plain 至少 ${T_H3}（对齐的信用对有先验的个体也有帮助）`, d: diff(mainPool, ['laya', 'lag'], ['laya', 'plain'], 'd80'), thr: T_H3, shift: 0, ok: (m: number) => m >= T_H3 },
].map(h => ({ ...h, stat: mean(h.d), p: signFlipP(h.d, h.shift) }));
const sorted = hyps.slice().sort((a, b) => a.p - b.p || a.id.localeCompare(b.id)), reject = new Map<string, boolean>(); let stop = false;
sorted.forEach((h, i) => { const r = !stop && h.p < 0.05 / (sorted.length - i); if (!r) stop = true; reject.set(h.id, r); });
const r4 = (x: number) => +x.toFixed(4);
const verdicts = hyps.map(h => ({ id: h.id, claim: h.claim, statistic: r4(h.stat), threshold: h.thr, effectOk: h.ok(h.stat), p: r4(h.p), holmReject: reject.get(h.id)!, supported: reject.get(h.id)! && h.ok(h.stat), perSeed: h.d.map(r4) }));
const secondary = Object.fromEntries(POOLS.map(pool => [pool.id, {
  means: Object.fromEntries(PRIORS.flatMap(p => LEARNERS.flatMap(l => REGIMES.map(r => [`${p}-${l}-${r.id}`, r4(mean(RUN_IDS.map(s => cell(pool.id, `${p}-${l}-${r.id}-${s}`))))])))),
  toxicBites: Object.fromEntries(PRIORS.flatMap(p => LEARNERS.flatMap(l => REGIMES.map(r => [`${p}-${l}-${r.id}`, +mean(RUN_IDS.flatMap(s => Object.values(fits[pool.id][`${p}-${l}-${r.id}-${s}`]).flat().map(x => x.toxicBites))).toFixed(0)])))),
  layaMinusNone: Object.fromEntries(LEARNERS.flatMap(l => REGIMES.map(r => [`${l}-${r.id}`, diff(pool.id, ['laya', l], ['none', l], r.id).map(r4)]))),
  lagMinusPlain: Object.fromEntries(PRIORS.flatMap(p => REGIMES.map(r => [`${p}-${r.id}`, diff(pool.id, [p, 'lag'], [p, 'plain'], r.id).map(r4)]))),
  references: refs[pool.id],
}]));
writeFileSync(`${out}/results.json`, JSON.stringify({ protocol: 'docs/PREREGISTRATION_13.md', dry, worldsPerCell: N, K, harmCap: HARM_CAP, inversions: INVERSIONS, seeds: RUN_IDS, primary: verdicts, evolvedLag: lagGenes, secondary }, null, 2)); console.log(JSON.stringify(verdicts, null, 1));
