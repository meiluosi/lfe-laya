// 预注册 14：另外两种经验学习器（习得的安全、后验采样）下，先验的优势是否同样缩小（协议见 docs/PREREGISTRATION_14.md）。一次性运行。
// 因素：先验 {laya, none} × 学习器 {plain, lag, safety, bayes} × 制度 {d40, d80}；8 个训练种子（81–88）。plain 与 lag 的基因组是预注册 13 的（哈希对照 genome-hashes-13.json），safety 与 bayes 为本次新训练（64 个，哈希对照 genome-hashes-14.json）；评估世界是新的。
// 用法：node packages/evo/learners-eval.ts <新输出目录>                   （正式）
//       node packages/evo/learners-eval.ts <新输出目录> --dry --seeds 2 --dir13 <f13 前缀> --dir14 <f14 前缀>   （开发空跑，测试方言）
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runSemanticWorld, blindRule, oracleRule, type SemanticFactory } from './semantic-run.ts';
import { registerPools, loadLayaPriors, type Priors } from './pools.ts';
import { structuredCohort } from './structured.ts';
import { structuredLagCohort, decodeLagGenes } from './structured-lag.ts';
import { structuredSafetyCohort } from './structured-safety.ts';
import { structuredBayesCohort } from './structured-bayes.ts';

const args = process.argv.slice(2), out = args[0]; if (!out) throw Error('Usage: node packages/evo/learners-eval.ts <new-output-directory> [--dry] [--seeds N]');
const dry = args.includes('--dry'), N = args.includes('--seeds') ? Number(args[args.indexOf('--seeds') + 1]) : 32;
// ---- 冻结的协议常量（与 PREREGISTRATION_13.md 一致）----
const K = 32, HARM_CAP = 4, INVERSIONS = [.25, .4], REGIMES = [{ id: 'd40', delay: 40 }, { id: 'd80', delay: 80 }] as const, PRIORS = ['laya', 'none'] as const, LEARNERS = ['plain', 'lag', 'safety', 'bayes'] as const;
const RUN_IDS = dry ? [81, 82] : [81, 82, 83, 84, 85, 86, 87, 88], T_LEARN = 0.05, T_SHRINK = 0.03;
const POOLS: { id: 'heldout' | 'factual' | 'test'; base: number }[] = dry ? [{ id: 'test', base: 380000 }] : [{ id: 'heldout', base: 360000 }, { id: 'factual', base: 370000 }];
const old = (l: string) => l === 'plain' || l === 'lag', opt = (n: string, d: string) => args.includes(n) ? args[args.indexOf(n) + 1] : d;
const dirOf = (p: string, l: string, r: string, s: number) => `${old(l) ? opt('--dir13', 'experiments/evo/f13') : opt('--dir14', 'experiments/evo/f14')}-${p}-${l}-${r}-${s}`;
const keys = PRIORS.flatMap(p => LEARNERS.flatMap(l => REGIMES.flatMap(r => RUN_IDS.map(s => ({ p, l, r: r.id, s, key: `${p}-${l}-${r.id}-${s}` })))));
if (!dry) {
  const f13 = JSON.parse(readFileSync('experiments/prereg/genome-hashes-13.json', 'utf8')) as Record<string, string>, f14 = JSON.parse(readFileSync('experiments/prereg/genome-hashes-14.json', 'utf8')) as Record<string, string>;
  for (const k of keys) { const h = createHash('sha256').update(readFileSync(`${dirOf(k.p, k.l, k.r, k.s)}/final.json`)).digest('hex'), frozen = old(k.l) ? f13 : f14; if (frozen[k.key] !== h) throw Error(`genome_hash_mismatch:${k.key}`); }
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
    const pr = k.p === 'none' ? 'none' : 'laya', f: SemanticFactory = () => k.l === 'lag' ? structuredLagCohort(g, pr, priorT[k.p]) : k.l === 'safety' ? structuredSafetyCohort(g, pr, priorT[k.p]) : k.l === 'bayes' ? structuredBayesCohort(g, pr, priorT[k.p]) : structuredCohort(g, pr, priorT[k.p]); fits[pool.id][k.key] = {};
    INVERSIONS.forEach((inv, ci) => { const specs = Array.from({ length: N }, (_, i) => ({ seed: pool.base + i + ci * 10000 + (delay === 80 ? 20000 : 0), options: { split: 'test' as const, pool: pool.id, sensible: K, harmCap: HARM_CAP, inversion: inv, delay } })); fits[pool.id][k.key][`inv${inv}`] = specs.map(s => runSemanticWorld(s, f)); });
    console.log(pool.id.padEnd(8), k.key.padEnd(22), mean(Object.values(fits[pool.id][k.key]).flat().map(r => r.fitness)).toFixed(3));
  }
  for (const r of REGIMES) for (const [name, f] of [['blind', blindRule], ['oracle', oracleRule]] as const) refs[pool.id][`${name}-${r.id}`] = +mean(INVERSIONS.flatMap((inv, ci) => Array.from({ length: N }, (_, i) => runSemanticWorld({ seed: pool.base + i + ci * 10000 + (r.delay === 80 ? 20000 : 0), options: { split: 'test', pool: pool.id, sensible: K, harmCap: HARM_CAP, inversion: inv, delay: r.delay } }, f).fitness))).toFixed(4);
}
const cell = (pool: string, key: string) => mean(INVERSIONS.flatMap(i => fits[pool][key][`inv${i}`].map(r => r.fitness)));
const diff = (pool: string, a: [string, string], b: [string, string], r: string) => RUN_IDS.map(s => cell(pool, `${a[0]}-${a[1]}-${r}-${s}`) - cell(pool, `${b[0]}-${b[1]}-${r}-${s}`));
const mainPool = dry ? 'test' : 'heldout';
const shrink = (pool: string, l: string, r: string) => RUN_IDS.map(sd => (cell(pool, `laya-plain-${r}-${sd}`) - cell(pool, `none-plain-${r}-${sd}`)) - (cell(pool, `laya-${l}-${r}-${sd}`) - cell(pool, `none-${l}-${r}-${sd}`)));
const hyps = [
  { id: 'H1', claim: `延迟 80：none-safety 优于 none-plain 至少 ${T_LEARN}`, d: diff(mainPool, ['none', 'safety'], ['none', 'plain'], 'd80'), thr: T_LEARN, shift: 0, ok: (m: number) => m >= T_LEARN },
  { id: 'H2', claim: `延迟 80：none-bayes 优于 none-plain 至少 ${T_LEARN}`, d: diff(mainPool, ['none', 'bayes'], ['none', 'plain'], 'd80'), thr: T_LEARN, shift: 0, ok: (m: number) => m >= T_LEARN },
  { id: 'H3', claim: `延迟 80：先验优势在 safety 学习器下比 plain 小至少 ${T_SHRINK}（(laya−none)plain − (laya−none)safety）`, d: shrink(mainPool, 'safety', 'd80'), thr: T_SHRINK, shift: 0, ok: (m: number) => m >= T_SHRINK },
  { id: 'H4', claim: `延迟 80：先验优势在 bayes 学习器下比 plain 小至少 ${T_SHRINK}`, d: shrink(mainPool, 'bayes', 'd80'), thr: T_SHRINK, shift: 0, ok: (m: number) => m >= T_SHRINK },
].map(h => ({ ...h, stat: mean(h.d), p: signFlipP(h.d, h.shift) }));
const sorted = hyps.slice().sort((a, b) => a.p - b.p || a.id.localeCompare(b.id)), reject = new Map<string, boolean>(); let stop = false;
sorted.forEach((h, i) => { const r = !stop && h.p < 0.05 / (sorted.length - i); if (!r) stop = true; reject.set(h.id, r); });
const r4 = (x: number) => +x.toFixed(4);
const verdicts = hyps.map(h => ({ id: h.id, claim: h.claim, statistic: r4(h.stat), threshold: h.thr, effectOk: h.ok(h.stat), p: r4(h.p), holmReject: reject.get(h.id)!, supported: reject.get(h.id)! && h.ok(h.stat), perSeed: h.d.map(r4) }));
const secondary = Object.fromEntries(POOLS.map(pool => [pool.id, {
  means: Object.fromEntries(PRIORS.flatMap(p => LEARNERS.flatMap(l => REGIMES.map(r => [`${p}-${l}-${r.id}`, r4(mean(RUN_IDS.map(s => cell(pool.id, `${p}-${l}-${r.id}-${s}`))))])))),
  toxicBites: Object.fromEntries(PRIORS.flatMap(p => LEARNERS.flatMap(l => REGIMES.map(r => [`${p}-${l}-${r.id}`, +mean(RUN_IDS.flatMap(s => Object.values(fits[pool.id][`${p}-${l}-${r.id}-${s}`]).flat().map(x => x.toxicBites))).toFixed(0)])))),
  layaMinusNone: Object.fromEntries(LEARNERS.flatMap(l => REGIMES.map(r => [`${l}-${r.id}`, diff(pool.id, ['laya', l], ['none', l], r.id).map(r4)]))),
  vsPlain: Object.fromEntries(PRIORS.flatMap(p => LEARNERS.filter(l => l !== 'plain').flatMap(l => REGIMES.map(r => [`${p}-${l}-${r.id}`, diff(pool.id, [p, l], [p, 'plain'], r.id).map(r4)])))),
  shrinkVsPlain: Object.fromEntries(LEARNERS.filter(l => l !== 'plain').flatMap(l => REGIMES.map(r => [`${l}-${r.id}`, shrink(pool.id, l, r.id).map(r4)]))),
  references: refs[pool.id],
}]));
writeFileSync(`${out}/results.json`, JSON.stringify({ protocol: 'docs/PREREGISTRATION_14.md', dry, worldsPerCell: N, K, harmCap: HARM_CAP, inversions: INVERSIONS, seeds: RUN_IDS, primary: verdicts, evolvedLag: lagGenes, secondary }, null, 2)); console.log(JSON.stringify(verdicts, null, 1));
