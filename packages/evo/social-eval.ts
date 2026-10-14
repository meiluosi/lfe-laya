// 预注册 09：社会观察（邻居的可见外观与最近进食）能否被个体利用（协议见 docs/PREREGISTRATION_09.md）。一次性运行。
// 因素：先验 {laya, none, vader}（均为 social 个体，用真实外观线索训练）；8 个训练种子（41–48）= 24 次进化；评估线索 {language, off, shuffled}。
// 用法：node packages/evo/social-eval.ts <新输出目录>                          （正式：要求 24 个基因组哈希与预注册一致）
//       node packages/evo/social-eval.ts <新输出目录> --dry --seeds 2 --dir <基因组前缀>   （开发空跑，测试方言）
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runSemanticWorld, type SemanticFactory } from './semantic-run.ts';
import { registerPools, loadLayaPriors, vaderPrior, type Priors } from './pools.ts';
import { structuredSocialCohort } from './structured-social.ts';

const args = process.argv.slice(2), out = args[0]; if (!out) throw Error('Usage: node packages/evo/social-eval.ts <new-output-directory> [--dry] [--seeds N]');
const dry = args.includes('--dry'), N = args.includes('--seeds') ? Number(args[args.indexOf('--seeds') + 1]) : 32;
// ---- 冻结的协议常量（与 PREREGISTRATION_09.md 一致）----
const K = 32, HARM_CAP = 4, INVERSIONS = [.25, .4], PRIORS = ['laya', 'none', 'vader'] as const, CUES = ['language', 'off', 'shuffled'] as const;
const RUN_IDS = dry ? [41, 42] : [41, 42, 43, 44, 45, 46, 47, 48], T_H1 = 0.02, T_H2 = 0.05, T_H3 = 0.01;
const POOLS: { id: 'heldout' | 'factual' | 'test'; base: number }[] = dry ? [{ id: 'test', base: 330000 }] : [{ id: 'heldout', base: 240000 }, { id: 'factual', base: 250000 }];
const dirOf = (p: string, s: number) => `${args.includes('--dir') ? args[args.indexOf('--dir') + 1] : 'experiments/evo/f9'}-${p}-${s}`;
const keys = PRIORS.flatMap(p => RUN_IDS.map(s => ({ p, s, key: `${p}-${s}` })));
if (!dry) {
  const frozen = JSON.parse(readFileSync('experiments/prereg/genome-hashes-09.json', 'utf8')) as Record<string, string>;
  for (const k of keys) { const h = createHash('sha256').update(readFileSync(`${dirOf(k.p, k.s)}/final.json`)).digest('hex'); if (frozen[k.key] !== h) throw Error(`genome_hash_mismatch:${k.key}`); }
}
mkdirSync(out, { recursive: false });
const registered = registerPools() as Record<string, unknown[] | undefined>;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function signFlipP(d: number[]) { const obs = mean(d), n = d.length; let ge = 0; for (let m = 0; m < 1 << n; m++) { let s = 0; for (let i = 0; i < n; i++) s += (m >> i & 1) ? -d[i] : d[i]; if (s / n >= obs - 1e-12) ge++; } return ge / (1 << n); }
type Row = { fitness: number; toxicBites: number; survival: number };
const fits: Record<string, Record<string, Record<string, Row[]>>> = {};   // pool → key → cues|inv → rows
for (const pool of POOLS) {
  if (!registered[pool.id]) throw Error(`pool_missing:${pool.id}`);
  const layaPri = loadLayaPriors(pool.id as 'test'); if (layaPri.size < (registered[pool.id] as unknown[]).length) throw Error(`cache_incomplete:${pool.id}`);
  const priorT: Record<string, Priors> = { laya: layaPri, none: new Map<string, number>(), vader: vaderPrior() }; fits[pool.id] = {};
  for (const k of keys) {
    const g: number[] = JSON.parse(readFileSync(`${dirOf(k.p, k.s)}/final.json`, 'utf8')).innate, f: SemanticFactory = () => structuredSocialCohort(g, k.p === 'none' ? 'none' : 'laya', priorT[k.p]); fits[pool.id][k.key] = {};
    for (const cues of CUES) INVERSIONS.forEach((inv, ci) => {
      const specs = Array.from({ length: N }, (_, i) => ({ seed: pool.base + i + ci * 10000, options: { split: 'test' as const, pool: pool.id, sensible: K, harmCap: HARM_CAP, inversion: inv, social: { cues, phrases: 'B' as const } } }));
      fits[pool.id][k.key][`${cues}|${inv}`] = specs.map(s => runSemanticWorld(s, f));
    });
    console.log(pool.id.padEnd(8), k.key.padEnd(10), CUES.map(c => mean(INVERSIONS.flatMap(i => fits[pool.id][k.key][`${c}|${i}`].map(r => r.fitness))).toFixed(3)).join(' '));
  }
}
const score = (pool: string, key: string, cues: string) => mean(INVERSIONS.flatMap(i => fits[pool][key][`${cues}|${i}`].map(r => r.fitness)));
const per = (pool: string, f: (s: number) => number) => RUN_IDS.map(f);
const main = dry ? 'test' : 'heldout';
const gain = (pool: string, p: string, s: number) => score(pool, `${p}-${s}`, 'language') - score(pool, `${p}-${s}`, 'off');
const dH1 = per(main, s => gain(main, 'laya', s)), dH2 = per(main, s => score(main, `laya-${s}`, 'off') - score(main, `laya-${s}`, 'shuffled')), dH3 = per(main, s => gain(main, 'laya', s) - gain(main, 'vader', s));
const hyps = [
  { id: 'H1', claim: `laya 个体：真实外观线索比不显示线索至少高 ${T_H1}`, d: dH1, thr: T_H1 },
  { id: 'H2', claim: `laya 个体：不显示线索比错配线索至少高 ${T_H2}（错误的社会信息有代价）`, d: dH2, thr: T_H2 },
  { id: 'H3', claim: `社会信息的收益（真实 − 不显示）：laya 比 vader 至少多 ${T_H3}`, d: dH3, thr: T_H3 },
].map(h => ({ ...h, stat: mean(h.d), p: signFlipP(h.d) }));
const sorted = hyps.slice().sort((a, b) => a.p - b.p || a.id.localeCompare(b.id)), reject = new Map<string, boolean>(); let stop = false;
sorted.forEach((h, i) => { const r = !stop && h.p < 0.05 / (sorted.length - i); if (!r) stop = true; reject.set(h.id, r); });
const r4 = (x: number) => +x.toFixed(4);
const verdicts = hyps.map(h => ({ id: h.id, claim: h.claim, statistic: r4(h.stat), threshold: h.thr, effectOk: h.stat >= h.thr, p: r4(h.p), holmReject: reject.get(h.id)!, supported: reject.get(h.id)! && h.stat >= h.thr, perSeed: h.d.map(r4) }));
const secondary = Object.fromEntries(POOLS.map(pool => [pool.id, {
  meanFitness: Object.fromEntries(PRIORS.flatMap(p => CUES.map(c => [`${p}|${c}`, r4(mean(RUN_IDS.map(s => score(pool.id, `${p}-${s}`, c))))]))),
  gainLanguageMinusOff: Object.fromEntries(PRIORS.map(p => [p, RUN_IDS.map(s => r4(gain(pool.id, p, s)))])),
  layaMinusNoneLanguage: RUN_IDS.map(s => r4(score(pool.id, `laya-${s}`, 'language') - score(pool.id, `none-${s}`, 'language'))),
  toxicBites: Object.fromEntries(PRIORS.flatMap(p => CUES.map(c => [`${p}|${c}`, +mean(RUN_IDS.flatMap(s => INVERSIONS.flatMap(i => fits[pool.id][`${p}-${s}`][`${c}|${i}`].map(r => r.toxicBites)))).toFixed(0)]))),
}]));
writeFileSync(`${out}/results.json`, JSON.stringify({ protocol: 'docs/PREREGISTRATION_09.md', dry, worldsPerCell: N, K, harmCap: HARM_CAP, inversions: INVERSIONS, seeds: RUN_IDS, primary: verdicts, secondary }, null, 2)); console.log(JSON.stringify(verdicts, null, 1));
