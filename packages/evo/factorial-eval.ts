// 预注册 06：匹配训练 × 层次信念 × 先验 的 2×2×2 评估（协议见 docs/PREREGISTRATION_06.md）。一次性运行。
// 因素：先验 {laya, none} × 层次信念 {flat, hier} × 训练 / 评估延迟制度 {d0, d40}；6 个训练种子（21–26）= 48 次进化。
// 用法：node packages/evo/factorial-eval.ts <新输出目录>                       （正式：要求 48 个基因组哈希与预注册一致）
//       node packages/evo/factorial-eval.ts <新输出目录> --dry --seeds 2 --dir <基因组目录前缀>  （开发空跑，使用测试方言）
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runSemanticWorld, type SemanticFactory } from './semantic-run.ts';
import { registerPools, loadLayaPriors, loadEmbeddings, type Priors } from './pools.ts';
import { structuredCohort } from './structured.ts';
import { structuredHierCohort } from './structured-hier.ts';

const args = process.argv.slice(2), out = args[0]; if (!out) throw Error('Usage: node packages/evo/factorial-eval.ts <new-output-directory> [--dry] [--seeds N]');
const dry = args.includes('--dry'), N = args.includes('--seeds') ? Number(args[args.indexOf('--seeds') + 1]) : 32;
// ---- 冻结的协议常量（与 PREREGISTRATION_06.md 一致）----
const K = 32, HARM_CAP = 4, INVERSIONS = [.25, .4], REGIMES = [{ id: 'd0', delay: 0 }, { id: 'd40', delay: 40 }] as const;
const PRIORS = ['laya', 'none'] as const, HIERS = ['flat', 'hier'] as const, RUN_IDS = dry ? [21, 22] : [21, 22, 23, 24, 25, 26];
const T_H1 = -0.04, T_H2 = 0.04, T_H3 = 0.03;
const POOLS: { id: 'heldout' | 'factual' | 'test'; base: number }[] = dry ? [{ id: 'test', base: 290000 }] : [{ id: 'heldout', base: 180000 }, { id: 'factual', base: 190000 }];
const dirOf = (p: string, h: string, r: string, s: number) => `${args.includes('--dir') ? args[args.indexOf('--dir') + 1] : 'experiments/evo/f6'}-${p}-${h}-${r}-${s}`;
const keys = PRIORS.flatMap(p => HIERS.flatMap(h => REGIMES.flatMap(r => RUN_IDS.map(s => ({ p, h, r: r.id, s, key: `${p}-${h}-${r.id}-${s}` })))));
if (!dry) {
  const frozen = JSON.parse(readFileSync('experiments/prereg/genome-hashes-06.json', 'utf8')) as Record<string, string>;
  for (const k of keys) { const h = createHash('sha256').update(readFileSync(`${dirOf(k.p, k.h, k.r, k.s)}/final.json`)).digest('hex'); if (frozen[k.key] !== h) throw Error(`genome_hash_mismatch:${k.key}`); }
}
mkdirSync(out, { recursive: false });
const registered = registerPools() as Record<string, unknown[] | undefined>;
const geneOf = (k: typeof keys[number]): number[] => { const d = dirOf(k.p, k.h, k.r, k.s); return JSON.parse(readFileSync(existsSync(`${d}/final.json`) ? `${d}/final.json` : `${d}/theta-gen0001.json`, 'utf8')).innate; };

type Row = { fitness: number; toxicBites: number; survival: number };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function signFlipP(d: number[], shift = 0) { const x = d.map(v => v - shift), obs = mean(x), n = x.length; let ge = 0; for (let m = 0; m < 1 << n; m++) { let s = 0; for (let i = 0; i < n; i++) s += (m >> i & 1) ? -x[i] : x[i]; if (s / n >= obs - 1e-12) ge++; } return ge / (1 << n); }
const analysis: Record<string, unknown> = {};
for (const pool of POOLS) {
  if (!registered[pool.id]) throw Error(`pool_missing:${pool.id}`);
  const layaPri = loadLayaPriors(pool.id as 'test'), emb = loadEmbeddings(pool.id as 'test'), none: Priors = new Map<string, number>();
  const size = (registered[pool.id] as unknown[]).length; if (layaPri.size < size || emb.size < size) throw Error(`cache_incomplete:${pool.id}`);
  const fit: Record<string, Record<string, Row[]>> = {};   // key → cell → rows
  for (const k of keys) {
    const g = geneOf(k), priorT = k.p === 'laya' ? layaPri : none, f: SemanticFactory = k.h === 'hier' ? () => structuredHierCohort(g, k.p === 'none' ? 'none' : 'laya', priorT, emb) : () => structuredCohort(g, k.p === 'none' ? 'none' : 'laya', priorT);
    const delay = REGIMES.find(r => r.id === k.r)!.delay; fit[k.key] = {};
    INVERSIONS.forEach((inv, ci) => {
      const specs = Array.from({ length: N }, (_, i) => ({ seed: pool.base + i + ci * 10000 + (delay ? 20000 : 0), options: { split: 'test' as const, pool: pool.id, sensible: K, harmCap: HARM_CAP, inversion: inv, ...(delay ? { delay } : {}) } }));
      fit[k.key][`inv${inv}`] = specs.map(s => runSemanticWorld(s, f));
    });
    console.log(pool.id.padEnd(8), k.key.padEnd(18), (mean(Object.values(fit[k.key]).flat().map(r => r.fitness))).toFixed(3));
  }
  const cell = (key: string, invs: number[]) => mean(invs.flatMap(i => fit[key][`inv${i}`].map(r => r.fitness)));
  const seedsOf = RUN_IDS, key = (p: string, h: string, r: string, s: number) => `${p}-${h}-${r}-${s}`;
  const dH1 = seedsOf.map(s => cell(key('laya', 'flat', 'd0', s), INVERSIONS) - cell(key('none', 'flat', 'd0', s), INVERSIONS));
  const dH2 = seedsOf.map(s => cell(key('laya', 'flat', 'd40', s), INVERSIONS) - cell(key('none', 'flat', 'd40', s), INVERSIONS));
  const dH3 = seedsOf.map(s => mean(REGIMES.map(r => cell(key('laya', 'hier', r.id, s), [.4]) - cell(key('laya', 'flat', r.id, s), [.4]))));
  const hyps = [
    { id: 'H1', claim: '匹配训练（延迟 0）下 laya 不比 none 差超过 0.04（非劣效）', stat: mean(dH1), thr: T_H1, ok: mean(dH1) > T_H1, p: signFlipP(dH1, T_H1), perSeed: dH1 },
    { id: 'H2', claim: '匹配训练（延迟 40）下 laya 优于 none 至少 0.04', stat: mean(dH2), thr: T_H2, ok: mean(dH2) >= T_H2, p: signFlipP(dH2), perSeed: dH2 },
    { id: 'H3', claim: '层次信念在欺骗 0.40 的世界里让 laya 个体提高至少 0.03', stat: mean(dH3), thr: T_H3, ok: mean(dH3) >= T_H3, p: signFlipP(dH3), perSeed: dH3 },
  ];
  // Holm 逐步检验只基于 p；“成立”还要求各自的效应量条件（并列的 p 同一步处理）
  const sorted = hyps.slice().sort((a, b) => a.p - b.p || a.id.localeCompare(b.id)), reject = new Map<string, boolean>(); let stop = false;
  sorted.forEach((h, i) => { const alpha = 0.05 / (sorted.length - i); const r = !stop && h.p < alpha; if (!r) stop = true; reject.set(h.id, r); });
  const verdicts = hyps.map(h => ({ id: h.id, claim: h.claim, statistic: +h.stat.toFixed(4), threshold: h.thr, effectOk: h.ok, p: +h.p.toFixed(4), holmReject: reject.get(h.id)!, supported: reject.get(h.id)! && h.ok, perSeed: h.perSeed.map(x => +x.toFixed(4)) }));
  const table = Object.fromEntries(REGIMES.flatMap(r => PRIORS.flatMap(p => HIERS.map(h => [`${p}-${h}-${r.id}`, Object.fromEntries(INVERSIONS.map(i => [`inv${i}`, +mean(seedsOf.map(s => cell(key(p, h, r.id, s), [i]))).toFixed(3)]))]))));
  const effects = {
    hierOnNone: Object.fromEntries(REGIMES.map(r => [r.id, +mean(seedsOf.map(s => cell(key('none', 'hier', r.id, s), INVERSIONS) - cell(key('none', 'flat', r.id, s), INVERSIONS))).toFixed(4)])),
    hierOnLaya: Object.fromEntries(REGIMES.flatMap(r => INVERSIONS.map(i => [`${r.id}-inv${i}`, +mean(seedsOf.map(s => cell(key('laya', 'hier', r.id, s), [i]) - cell(key('laya', 'flat', r.id, s), [i]))).toFixed(4)]))),
    layaMinusNoneHier: Object.fromEntries(REGIMES.map(r => [r.id, +mean(seedsOf.map(s => cell(key('laya', 'hier', r.id, s), INVERSIONS) - cell(key('none', 'hier', r.id, s), INVERSIONS))).toFixed(4)])),
    layaMinusNoneFlatByInv: Object.fromEntries(REGIMES.flatMap(r => INVERSIONS.map(i => [`${r.id}-inv${i}`, +mean(seedsOf.map(s => cell(key('laya', 'flat', r.id, s), [i]) - cell(key('none', 'flat', r.id, s), [i]))).toFixed(4)]))),
  };
  analysis[pool.id] = { primary: verdicts, factorialMeans: table, effects, perSeedMeans: Object.fromEntries(keys.map(k => [k.key, +cell(k.key, INVERSIONS).toFixed(4)])), toxicBites: Object.fromEntries(keys.map(k => [k.key, +mean(Object.values(fit[k.key]).flat().map(r => r.toxicBites)).toFixed(0)])) };
}
const report = { protocol: 'docs/PREREGISTRATION_06.md', dry, worldsPerCell: N, K, harmCap: HARM_CAP, inversions: INVERSIONS, regimes: REGIMES, seeds: RUN_IDS, primaryPool: dry ? 'test' : 'heldout', analysis };
writeFileSync(`${out}/results.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(Object.fromEntries(Object.entries(analysis).map(([k, v]) => [k, (v as { primary: unknown }).primary])), null, 1));
