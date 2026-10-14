// 预注册 10：成熟周期与季节（W7）里先验与语言线索的价值（协议见 docs/PREREGISTRATION_10.md）。一次性运行。
// 因素：先验 {laya, none, vader}（均用真实阶段线索训练，措辞 A）；8 个训练种子（51–58）= 24 次进化；评估线索 {language, off, shuffled}，措辞 B。
// 用法：node packages/evo/ripening-eval.ts <新输出目录>                          （正式：要求 24 个基因组哈希与预注册一致）
//       node packages/evo/ripening-eval.ts <新输出目录> --dry --seeds 2 --dir <基因组前缀>   （开发空跑，测试方言）
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runSemanticWorld, type SemanticFactory } from './semantic-run.ts';
import { registerPools, loadLayaPriors, vaderPrior, type Priors } from './pools.ts';
import { structuredCohort } from './structured.ts';

const args = process.argv.slice(2), out = args[0]; if (!out) throw Error('Usage: node packages/evo/ripening-eval.ts <new-output-directory> [--dry] [--seeds N]');
const dry = args.includes('--dry'), N = args.includes('--seeds') ? Number(args[args.indexOf('--seeds') + 1]) : 32;
// ---- 冻结的协议常量（与 PREREGISTRATION_10.md 一致）----
const K = 16, HARM_CAP = 4, SEASON = 300, POOL_LIMIT = 1000, INVERSIONS = [.25, .4], PRIORS = ['laya', 'none', 'vader'] as const, CUES = ['language', 'off', 'shuffled'] as const;
const RUN_IDS = dry ? [51, 52] : [51, 52, 53, 54, 55, 56, 57, 58], T_H1 = 0.03, T_H2 = 0.05, T_H3 = 0.01;
const POOL: { id: 'heldout' | 'test'; base: number } = dry ? { id: 'test', base: 340000 } : { id: 'heldout', base: 260000 };
const dirOf = (p: string, s: number) => `${args.includes('--dir') ? args[args.indexOf('--dir') + 1] : 'experiments/evo/f10'}-${p}-${s}`;
const keys = PRIORS.flatMap(p => RUN_IDS.map(s => ({ p, s, key: `${p}-${s}` })));
if (!dry) {
  const frozen = JSON.parse(readFileSync('experiments/prereg/genome-hashes-10.json', 'utf8')) as Record<string, string>;
  for (const k of keys) { const h = createHash('sha256').update(readFileSync(`${dirOf(k.p, k.s)}/final.json`)).digest('hex'); if (frozen[k.key] !== h) throw Error(`genome_hash_mismatch:${k.key}`); }
}
mkdirSync(out, { recursive: false });
const registered = registerPools() as Record<string, unknown[] | undefined>; if (!registered[POOL.id]) throw Error(`pool_missing:${POOL.id}`);
const layaPri = loadLayaPriors(POOL.id); const needed = POOL.id === 'heldout' ? 4 * POOL_LIMIT + (registered.heldout as unknown[]).length : 0;   // 池本身 + 阶段化文本
if (layaPri.size < needed && !dry) throw Error(`cache_incomplete:${layaPri.size}/${needed}`);
const priorT: Record<string, Priors> = { laya: layaPri, none: new Map<string, number>(), vader: vaderPrior() };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function signFlipP(d: number[]) { const obs = mean(d), n = d.length; let ge = 0; for (let m = 0; m < 1 << n; m++) { let s = 0; for (let i = 0; i < n; i++) s += (m >> i & 1) ? -d[i] : d[i]; if (s / n >= obs - 1e-12) ge++; } return ge / (1 << n); }
type Row = { fitness: number; toxicBites: number; survival: number };
const fits: Record<string, Record<string, Row[]>> = {};
for (const k of keys) {
  const g: number[] = JSON.parse(readFileSync(`${dirOf(k.p, k.s)}/final.json`, 'utf8')).innate, f: SemanticFactory = () => structuredCohort(g, k.p === 'none' ? 'none' : 'laya', priorT[k.p]); fits[k.key] = {};
  for (const cues of CUES) INVERSIONS.forEach((inv, ci) => {
    const specs = Array.from({ length: N }, (_, i) => ({ seed: POOL.base + i + ci * 10000, options: { split: 'test' as const, pool: POOL.id, sensible: K, harmCap: HARM_CAP, inversion: inv, ripening: { seasonTicks: SEASON, cues, phrases: 'B' as const, poolLimit: POOL_LIMIT } } }));
    fits[k.key][`${cues}|${inv}`] = specs.map(s => runSemanticWorld(s, f));
  });
  console.log(k.key.padEnd(10), CUES.map(c => mean(INVERSIONS.flatMap(i => fits[k.key][`${c}|${i}`].map(r => r.fitness))).toFixed(3)).join(' '));
}
const score = (key: string, cues: string) => mean(INVERSIONS.flatMap(i => fits[key][`${cues}|${i}`].map(r => r.fitness)));
const per = (f: (s: number) => number) => RUN_IDS.map(f);
const dH1 = per(s => score(`laya-${s}`, 'language') - score(`none-${s}`, 'language')), dH2 = per(s => score(`laya-${s}`, 'language') - score(`laya-${s}`, 'shuffled')), dH3 = per(s => score(`laya-${s}`, 'language') - score(`vader-${s}`, 'language'));
const hyps = [
  { id: 'H1', claim: `真实线索下 laya 优于 none 至少 ${T_H1}`, d: dH1, thr: T_H1 },
  { id: 'H2', claim: `laya 个体：真实线索比错配线索至少高 ${T_H2}（个体在使用阶段线索）`, d: dH2, thr: T_H2 },
  { id: 'H3', claim: `真实线索下 laya 优于 vader 至少 ${T_H3}`, d: dH3, thr: T_H3 },
].map(h => ({ ...h, stat: mean(h.d), p: signFlipP(h.d) }));
const sorted = hyps.slice().sort((a, b) => a.p - b.p || a.id.localeCompare(b.id)), reject = new Map<string, boolean>(); let stop = false;
sorted.forEach((h, i) => { const r = !stop && h.p < 0.05 / (sorted.length - i); if (!r) stop = true; reject.set(h.id, r); });
const r4 = (x: number) => +x.toFixed(4);
const verdicts = hyps.map(h => ({ id: h.id, claim: h.claim, statistic: r4(h.stat), threshold: h.thr, effectOk: h.stat >= h.thr, p: r4(h.p), holmReject: reject.get(h.id)!, supported: reject.get(h.id)! && h.stat >= h.thr, perSeed: h.d.map(r4) }));
const secondary = {
  meanFitness: Object.fromEntries(PRIORS.flatMap(p => CUES.map(c => [`${p}|${c}`, r4(mean(RUN_IDS.map(s => score(`${p}-${s}`, c))))]))),
  cueGain: Object.fromEntries(PRIORS.map(p => [p, { languageMinusOff: RUN_IDS.map(s => r4(score(`${p}-${s}`, 'language') - score(`${p}-${s}`, 'off'))), offMinusShuffled: RUN_IDS.map(s => r4(score(`${p}-${s}`, 'off') - score(`${p}-${s}`, 'shuffled'))) }])),
  toxicBites: Object.fromEntries(PRIORS.flatMap(p => CUES.map(c => [`${p}|${c}`, +mean(RUN_IDS.flatMap(s => INVERSIONS.flatMap(i => fits[`${p}-${s}`][`${c}|${i}`].map(r => r.toxicBites)))).toFixed(0)]))),
  neverEatsShare: Object.fromEntries(PRIORS.map(p => [p, r4(RUN_IDS.filter(s => INVERSIONS.every(i => fits[`${p}-${s}`][`language|${i}`].every(r => r.toxicBites === 0))).length / RUN_IDS.length)])),
};
writeFileSync(`${out}/results.json`, JSON.stringify({ protocol: 'docs/PREREGISTRATION_10.md', dry, worldsPerCell: N, K, harmCap: HARM_CAP, seasonTicks: SEASON, poolLimit: POOL_LIMIT, inversions: INVERSIONS, seeds: RUN_IDS, primary: verdicts, secondary }, null, 2)); console.log(JSON.stringify(verdicts, null, 1));
