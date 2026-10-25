// 主线评估：A/B/A 完全反转世界里，各学习器（plain / dual / regime）× 先验（laya / none）的适应、保留与适应度。
// 世界：K=6，危害封顶 1，无欺骗，每 1200 tick 把所有种类的影响整体反转（A 0–1200，B 1200–2400，A 2400–3600）。指标按 200 tick 窗口统计“营养食物占比”：
//   早期 = 每段前两个窗口，晚期 = 每段后两个窗口；适应 = B 早期 − …；节省（savings）= A2 早期 − A1 早期（同一批个体；为正表示旧环境返回时比第一次更快进入状态）。
// 用法：node packages/evo/aba-eval.ts <新输出目录> --dev --dir <基因组前缀> --seeds 201,202 [--worlds 16] [--pools test]     （开发期，不做哈希校验、不做假设检验）
//       node packages/evo/aba-eval.ts <新输出目录> --prereg 17     （正式：要求哈希与 experiments/prereg/genome-hashes-17.json 一致；协议见 docs/PREREGISTRATION_17.md，该文件冻结前此模式不可用）
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runSemanticWorld, blindRule, type SemanticFactory } from './semantic-run.ts';
import { registerPools, loadLayaPriors, type Priors } from './pools.ts';
import { structuredCohort } from './structured.ts';
import { structuredDualCohort, structuredRegimeCohort, structuredCueCohort } from './structured-ctx.ts';

const args = process.argv.slice(2), out = args[0]; if (!out) throw Error('Usage: node packages/evo/aba-eval.ts <new-output-directory> --dev|--prereg 17 ...');
const opt = (n: string, d: string) => args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d;
const dev = args.includes('--dev'), prereg = dev ? '' : opt('prereg', ''); if (!dev && prereg !== '17') throw Error('need --dev or --prereg 17');
const SEEDS = (dev ? opt('seeds', '201,202') : '211,212,213,214,215,216,217,218').split(',').map(Number), N = Number(opt('worlds', dev ? '16' : '32'));
const PREFIX = dev ? opt('dir', 'experiments/evo/dev-aba') : 'experiments/evo/f17', PRIORS = (dev ? opt('priors', 'laya,none') : 'laya,none').split(',') as ('laya' | 'none')[], LEARNERS = (dev ? opt('learners', 'plain,dual,regime') : 'plain,dual,regime,cue').split(',') as ('plain' | 'dual' | 'regime' | 'cue')[];
const VARIANTS = (dev && !args.includes('--allVariants') ? [{ id: 'aba-off', pattern: 'aba', cue: 'off' }, { id: 'abc-off', pattern: 'abc', cue: 'off' }] : [{ id: 'aba-off', pattern: 'aba', cue: 'off' }, { id: 'aba-true', pattern: 'aba', cue: 'true' }, { id: 'aba-random', pattern: 'aba', cue: 'random' }, { id: 'abc-off', pattern: 'abc', cue: 'off' }, { id: 'abc-true', pattern: 'abc', cue: 'true' }, { id: 'abc-random', pattern: 'abc', cue: 'random' }]) as { id: string; pattern: 'aba' | 'abc'; cue: 'off' | 'true' | 'random' }[];
const PHASE = 1200, WIN = 200, PER = PHASE / WIN, EARLY = 2, K = 6, HARM = 1;
const POOLS: { id: 'heldout' | 'factual' | 'test'; base: number }[] = dev ? [{ id: 'test', base: 500000 }] : [{ id: 'heldout', base: 510000 }, { id: 'factual', base: 520000 }];
const keys = PRIORS.flatMap(p => LEARNERS.flatMap(l => SEEDS.map(s => ({ p, l, s, key: `${p}-${l}-${s}`, dir: `${PREFIX}-${p}-${l}-${s}` }))));
if (!dev) { const frozen = JSON.parse(readFileSync('experiments/prereg/genome-hashes-17.json', 'utf8')) as Record<string, string>; for (const k of keys) { const h = createHash('sha256').update(readFileSync(`${k.dir}/final.json`)).digest('hex'); if (frozen[k.key] !== h) throw Error(`genome_hash_mismatch:${k.key}`); } }
mkdirSync(out, { recursive: false });
const registered = registerPools() as Record<string, unknown[] | undefined>, mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const share = (good: number[], bad: number[], a: number, b: number) => { let g = 0, t = 0; for (let i = a; i < b; i++) { g += good[i]; t += good[i] + bad[i]; } return t ? g / t : NaN; };
type Row = { fitness: number; A1e: number; A1l: number; Be: number; Bl: number; A2e: number; A2l: number; toxic: number };
const run = (pool: string, base: number, f: SemanticFactory, v: typeof VARIANTS[number]): Row[] => Array.from({ length: N }, (_, i) => {
  const r = runSemanticWorld({ seed: base + i + VARIANTS.indexOf(v) * 1000, options: { split: 'test', pool, sensible: K, harmCap: HARM, inversion: 0, drift: { everyTicks: PHASE, fraction: 1, pattern: v.pattern, cue: v.cue } } }, f, WIN), g = r.windows!.good, b = r.windows!.bad;
  return { fitness: r.fitness, A1e: share(g, b, 0, EARLY), A1l: share(g, b, PER - EARLY, PER), Be: share(g, b, PER, PER + EARLY), Bl: share(g, b, 2 * PER - EARLY, 2 * PER), A2e: share(g, b, 2 * PER, 2 * PER + EARLY), A2l: share(g, b, 3 * PER - EARLY, 3 * PER), toxic: r.toxicBites };
});
const cellMean = (rows: Row[]) => { const o: Record<string, number> = {}; for (const k of Object.keys(rows[0]) as (keyof Row)[]) { const v = rows.map(r => r[k]).filter(Number.isFinite); o[k] = v.length ? mean(v) : NaN; } o.savings = o.A2e - o.A1e; return o; };
const stats: Record<string, Record<string, Record<string, Record<string, number>>>> = {}, refs: Record<string, Record<string, number>> = {};
for (const pool of POOLS) {
  if (!registered[pool.id]) throw Error(`pool_missing:${pool.id}`);
  const lay = loadLayaPriors(pool.id as 'test'); if (lay.size < (registered[pool.id] as unknown[]).length) throw Error(`cache_incomplete:${pool.id}`);
  const pr: Record<string, Priors> = { laya: lay, none: new Map<string, number>() }; stats[pool.id] = {};
  for (const k of keys) {
    const g: number[] = JSON.parse(readFileSync(`${k.dir}/final.json`, 'utf8')).innate, pri = k.p === 'none' ? 'none' : 'laya';
    const f: SemanticFactory = () => k.l === 'cue' ? structuredCueCohort(g, pri, pr[k.p]) : k.l === 'dual' ? structuredDualCohort(g, pri, pr[k.p]) : k.l === 'regime' ? structuredRegimeCohort(g, pri, pr[k.p]) : structuredCohort(g, pri, pr[k.p]);
    stats[pool.id][k.key] = Object.fromEntries(VARIANTS.map(v => [v.id, cellMean(run(pool.id, pool.base, f, v))]));
    console.log(pool.id.padEnd(8), k.key.padEnd(18), VARIANTS.map(v => `${v.id} fit ${stats[pool.id][k.key][v.id].fitness.toFixed(3)} sav ${stats[pool.id][k.key][v.id].savings.toFixed(2)}`).join(' | '));
  }
  refs[pool.id] = Object.fromEntries(VARIANTS.flatMap(v => { const b = cellMean(run(pool.id, pool.base, blindRule, v)); return [[`blindFitness-${v.id}`, +b.fitness.toFixed(4)], [`blindSavings-${v.id}`, +b.savings.toFixed(4)]]; }));
}
const main = dev ? 'test' : 'heldout', diff = (key: string, a: [string, string], b: [string, string], v: string, pool = main) => SEEDS.map(s => stats[pool][`${a[0]}-${a[1]}-${s}`][v][key] - stats[pool][`${b[0]}-${b[1]}-${s}`][v][key]);
const signFlipP = (d: number[], shift = 0) => { d = d.map(x => x - shift); const obs = mean(d), n = d.length; let ge = 0; for (let m = 0; m < 1 << n; m++) { let s = 0; for (let i = 0; i < n; i++) s += (m >> i & 1) ? -d[i] : d[i]; if (s / n >= obs - 1e-12) ge++; } return ge / (1 << n); };
const r4 = (x: number) => +x.toFixed(4);
// 假设（正式模式的阈值在 PREREGISTRATION_17 冻结；开发期只打印同一批统计量，且只有 aba-off / abc-off 两个世界，其余假设打印为 NaN）
const T = { savInfer: 0.15, savCue: 0.20, savCueOverRegime: 0.05, margin: -0.03, harm: 0.02, fit: 0.04 };
const has = (...l: string[]) => l.every(x => LEARNERS.includes(x as 'plain'));
const safe = (f: () => number[]) => { try { return f(); } catch { return SEEDS.map(() => NaN); } };
const hyps = [
  { id: 'H1', claim: `aba、无线索、laya：regime 的节省比 plain 高至少 ${T.savInfer}（只靠预测误差推断环境）`, d: safe(() => diff('savings', ['laya', 'regime'], ['laya', 'plain'], 'aba-off')), thr: T.savInfer, shift: 0 },
  { id: 'H2', claim: `aba、真实线索、laya：cue 的节省比 plain 高至少 ${T.savCue}`, d: safe(() => diff('savings', ['laya', 'cue'], ['laya', 'plain'], 'aba-true')), thr: T.savCue, shift: 0 },
  { id: 'H3', claim: `aba、真实线索、laya：cue 的节省比 regime 高至少 ${T.savCueOverRegime}（明说比推断更快）`, d: safe(() => diff('savings', ['laya', 'cue'], ['laya', 'regime'], 'aba-true')), thr: T.savCueOverRegime, shift: 0 },
  { id: 'H4', claim: `abc（全新规则）、无线索、laya：regime 的适应度不比 plain 差超过 ${-T.margin}（非劣效）`, d: safe(() => diff('fitness', ['laya', 'regime'], ['laya', 'plain'], 'abc-off')), thr: T.margin, shift: T.margin },
  { id: 'H5', claim: `aba、随机线索、laya：plain 的适应度比 cue 高至少 ${T.harm}（误导线索有代价）`, d: safe(() => diff('fitness', ['laya', 'plain'], ['laya', 'cue'], 'aba-random')), thr: T.harm, shift: 0 },
  { id: 'H6', claim: `aba、无线索、laya：regime 的适应度比 plain 高至少 ${T.fit}`, d: safe(() => diff('fitness', ['laya', 'regime'], ['laya', 'plain'], 'aba-off')), thr: T.fit, shift: 0 },
].map(h => ({ ...h, stat: mean(h.d), p: signFlipP(h.d, h.shift) }));
const sorted = hyps.slice().sort((a, b) => a.p - b.p || a.id.localeCompare(b.id)), reject = new Map<string, boolean>(); let stop = false;
sorted.forEach((h, i) => { const r = !stop && h.p < 0.05 / (sorted.length - i); if (!r) stop = true; reject.set(h.id, r); });
const verdicts = hyps.map(h => ({ id: h.id, claim: h.claim, statistic: r4(h.stat), threshold: h.thr, effectOk: h.shift ? h.stat > h.thr : h.stat >= h.thr, p: r4(h.p), holmReject: reject.get(h.id)!, supported: reject.get(h.id)! && (h.shift ? h.stat > h.thr : h.stat >= h.thr), perSeed: h.d.map(r4) }));
const roundAll = (o: typeof stats) => Object.fromEntries(Object.entries(o).map(([p, c]) => [p, Object.fromEntries(Object.entries(c).map(([k, vs]) => [k, Object.fromEntries(Object.entries(vs).map(([v, m]) => [v, Object.fromEntries(Object.entries(m).map(([n, x]) => [n, r4(x)]))]))]))]));
writeFileSync(`${out}/results.json`, JSON.stringify({ protocol: dev ? 'dev' : 'docs/PREREGISTRATION_17.md', dev, worldsPerCell: N, K, harmCap: HARM, phase: PHASE, window: WIN, seeds: SEEDS, primary: verdicts, cells: roundAll(stats), references: refs }, null, 2));
console.log(JSON.stringify(verdicts.map(v => ({ id: v.id, stat: v.statistic, thr: v.threshold, p: v.p, supported: v.supported })), null, 0));
