// 预注册 08：用事实方言训练个体，Laya 与情感词典的差距能否放大（协议见 docs/PREREGISTRATION_08.md）。一次性运行。
// 因素：训练方言 {sentiment（预注册 07 的 d80 基因组 f7-*）, factual（新训练 f8-*）} × 先验 {laya, none, vader}；制度 d80；种子 31–38。
// 用法：node packages/evo/factual-train-eval.ts <新输出目录>                                    （正式：要求 24 个新基因组哈希与预注册一致，并校验 f7 的 d80 哈希）
//       node packages/evo/factual-train-eval.ts <新输出目录> --dry --seeds 2 --dir8 <f8 前缀> --dir7 <f7 前缀>   （开发空跑，测试方言）
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runSemanticWorld, type SemanticFactory } from './semantic-run.ts';
import { registerPools, loadLayaPriors, vaderPrior, type Priors } from './pools.ts';
import { structuredCohort } from './structured.ts';

const args = process.argv.slice(2), out = args[0]; if (!out) throw Error('Usage: node packages/evo/factual-train-eval.ts <new-output-directory> [--dry] [--seeds N]');
const dry = args.includes('--dry'), N = args.includes('--seeds') ? Number(args[args.indexOf('--seeds') + 1]) : 32;
const opt = (n: string, d: string) => args.includes(n) ? args[args.indexOf(n) + 1] : d;
// ---- 冻结的协议常量（与 PREREGISTRATION_08.md 一致）----
const K = 32, HARM_CAP = 4, DELAY = 80, INVERSIONS = [.25, .4], PRIORS = ['laya', 'none', 'vader'] as const, TRAININGS = ['sentiment', 'factual'] as const;
const RUN_IDS = dry ? [31, 32] : [31, 32, 33, 34, 35, 36, 37, 38];
const T_H1 = 0.02, T_H2 = 0.05, NONINF = -0.02;
const POOLS: { id: 'heldout' | 'factual' | 'test'; base: number }[] = dry ? [{ id: 'test', base: 310000 }] : [{ id: 'factual', base: 230000 }, { id: 'heldout', base: 220000 }];
const dirOf = (t: string, p: string, s: number) => t === 'sentiment' ? `${opt('--dir7', 'experiments/evo/f7')}-${p}-d80-${s}` : `${opt('--dir8', 'experiments/evo/f8')}-${p}-d80-${s}`;
const keys = TRAININGS.flatMap(t => PRIORS.flatMap(p => RUN_IDS.map(s => ({ t, p, s, key: `${t}-${p}-${s}` }))));
if (!dry) {
  const h7 = JSON.parse(readFileSync('experiments/prereg/genome-hashes-07.json', 'utf8')) as Record<string, string>, h8 = JSON.parse(readFileSync('experiments/prereg/genome-hashes-08.json', 'utf8')) as Record<string, string>;
  for (const k of keys) { const h = createHash('sha256').update(readFileSync(`${dirOf(k.t, k.p, k.s)}/final.json`)).digest('hex'), want = k.t === 'sentiment' ? h7[`${k.p}-d80-${k.s}`] : h8[`${k.p}-d80-${k.s}`]; if (want !== h) throw Error(`genome_hash_mismatch:${k.key}`); }
}
mkdirSync(out, { recursive: false });
const registered = registerPools() as Record<string, unknown[] | undefined>;
const geneOf = (k: typeof keys[number]): number[] => JSON.parse(readFileSync(`${dirOf(k.t, k.p, k.s)}/final.json`, 'utf8')).innate;

type Row = { fitness: number; toxicBites: number; survival: number };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function signFlipP(d: number[], shift = 0) { const x = d.map(v => v - shift), obs = mean(x), n = x.length; let ge = 0; for (let m = 0; m < 1 << n; m++) { let s = 0; for (let i = 0; i < n; i++) s += (m >> i & 1) ? -x[i] : x[i]; if (s / n >= obs - 1e-12) ge++; } return ge / (1 << n); }
const fits: Record<string, Record<string, Record<string, Row[]>>> = {};
for (const pool of POOLS) {
  if (!registered[pool.id]) throw Error(`pool_missing:${pool.id}`);
  const layaPri = loadLayaPriors(pool.id as 'test'), size = (registered[pool.id] as unknown[]).length; if (layaPri.size < size) throw Error(`cache_incomplete:${pool.id}`);
  const priorT: Record<string, Priors> = { laya: layaPri, none: new Map<string, number>(), vader: vaderPrior() };
  fits[pool.id] = {};
  for (const k of keys) {
    const g = geneOf(k), f: SemanticFactory = () => structuredCohort(g, k.p === 'none' ? 'none' : 'laya', priorT[k.p]); fits[pool.id][k.key] = {};
    INVERSIONS.forEach((inv, ci) => {
      const specs = Array.from({ length: N }, (_, i) => ({ seed: pool.base + i + ci * 10000, options: { split: 'test' as const, pool: pool.id, sensible: K, harmCap: HARM_CAP, inversion: inv, delay: DELAY } }));
      fits[pool.id][k.key][`inv${inv}`] = specs.map(s => runSemanticWorld(s, f));
    });
    console.log(pool.id.padEnd(8), k.key.padEnd(18), mean(Object.values(fits[pool.id][k.key]).flat().map(r => r.fitness)).toFixed(3));
  }
}
const cell = (pool: string, key: string, invs: number[] = INVERSIONS) => mean(invs.flatMap(i => fits[pool][key][`inv${i}`].map(r => r.fitness)));
const diff = (pool: string, t: string, a: string, b: string) => RUN_IDS.map(s => cell(pool, `${t}-${a}-${s}`) - cell(pool, `${t}-${b}-${s}`));
const factPool = dry ? 'test' : 'factual', heldPool = dry ? 'test' : 'heldout';
const gapF = diff(factPool, 'factual', 'laya', 'vader'), gapS = diff(factPool, 'sentiment', 'laya', 'vader');
const dH1 = gapF.map((x, i) => x - gapS[i]), dH2 = diff(factPool, 'factual', 'laya', 'none'), dH3 = diff(heldPool, 'factual', 'laya', 'vader');
const hyps = [
  { id: 'H1', claim: `事实方言训练使事实方言上的 laya − vader 差距比情感方言训练大至少 ${T_H1}`, d: dH1, thr: T_H1, shift: 0, ok: mean(dH1) >= T_H1 },
  { id: 'H2', claim: `事实方言训练下，事实方言上 laya 优于 none 至少 ${T_H2}`, d: dH2, thr: T_H2, shift: 0, ok: mean(dH2) >= T_H2 },
  { id: 'H3', claim: `迁移（非劣效）：事实方言训练的个体在留出方言上 laya − vader > ${NONINF}`, d: dH3, thr: NONINF, shift: NONINF, ok: mean(dH3) > NONINF },
].map(h => ({ ...h, stat: mean(h.d), p: signFlipP(h.d, h.shift) }));
const sorted = hyps.slice().sort((a, b) => a.p - b.p || a.id.localeCompare(b.id)), reject = new Map<string, boolean>(); let stop = false;
sorted.forEach((h, i) => { const r = !stop && h.p < 0.05 / (sorted.length - i); if (!r) stop = true; reject.set(h.id, r); });
const r4 = (x: number) => +x.toFixed(4);
const verdicts = hyps.map(h => ({ id: h.id, claim: h.claim, statistic: r4(h.stat), threshold: h.thr, effectOk: h.ok, p: r4(h.p), holmReject: reject.get(h.id)!, supported: reject.get(h.id)! && h.ok, perSeed: h.d.map(r4) }));
const secondary = Object.fromEntries(POOLS.map(pool => [pool.id, {
  layaMinusVader: Object.fromEntries(TRAININGS.map(t => [t, diff(pool.id, t, 'laya', 'vader').map(r4)])),
  layaMinusNone: Object.fromEntries(TRAININGS.map(t => [t, diff(pool.id, t, 'laya', 'none').map(r4)])),
  vaderMinusNone: Object.fromEntries(TRAININGS.map(t => [t, diff(pool.id, t, 'vader', 'none').map(r4)])),
  means: Object.fromEntries(TRAININGS.flatMap(t => PRIORS.map(p => [`${t}-${p}`, r4(mean(RUN_IDS.map(s => cell(pool.id, `${t}-${p}-${s}`))))]))),
  toxicBites: Object.fromEntries(TRAININGS.flatMap(t => PRIORS.map(p => [`${t}-${p}`, +mean(RUN_IDS.flatMap(s => Object.values(fits[pool.id][`${t}-${p}-${s}`]).flat().map(x => x.toxicBites))).toFixed(0)]))),
}]));
const report = { protocol: 'docs/PREREGISTRATION_08.md', dry, worldsPerCell: N, K, harmCap: HARM_CAP, delay: DELAY, inversions: INVERSIONS, seeds: RUN_IDS, primary: verdicts, secondary };
writeFileSync(`${out}/results.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(verdicts, null, 1));
