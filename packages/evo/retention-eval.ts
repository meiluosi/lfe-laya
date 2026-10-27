// 保留的边界：用已冻结的预注册 17 基因组（不重新训练），在训练时没见过的反转模式里检验保留是否还成立。
// 世界（K=6，危害封顶 1，无欺骗，每阶段 1200 tick，窗口 200）：
//   half = A/B'/A（B' 只反转随机一半种类，3 阶段）；abab = A/B/A/B/A（5 阶段）；long = A/B/B/B/A（B 持续三个阶段，5 阶段）。线索 off / true。
// 指标：每阶段前两个窗口的“营养食物占比”（早期）E[p]；节省 = 最后一个 A 阶段早期 − 第一个 A 阶段早期；再学习 = abab 的第二个 B 早期 − 第一个 B 早期；适应度同前。
// 用法：node packages/evo/retention-eval.ts <新输出目录> --dev --dir <基因组前缀> --seeds 201,202 [--worlds 16]
//       node packages/evo/retention-eval.ts <新输出目录> --prereg 18   （正式：基因组哈希必须与 experiments/prereg/genome-hashes-17.json 一致；协议见 docs/PREREGISTRATION_18.md）
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runSemanticWorld, type SemanticFactory } from './semantic-run.ts';
import { registerPools, loadLayaPriors, type Priors } from './pools.ts';
import { structuredCohort } from './structured.ts';
import { structuredDualCohort, structuredRegimeCohort, structuredCueCohort } from './structured-ctx.ts';

const args = process.argv.slice(2), out = args[0]; if (!out) throw Error('Usage: node packages/evo/retention-eval.ts <new-output-directory> --dev|--prereg 18 ...');
const opt = (n: string, d: string) => args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d;
const dev = args.includes('--dev'), prereg = dev ? '' : opt('prereg', ''); if (!dev && prereg !== '18') throw Error('need --dev or --prereg 18');
const SEEDS = (dev ? opt('seeds', '201,202') : '211,212,213,214,215,216,217,218').split(',').map(Number), N = Number(opt('worlds', dev ? '16' : '24'));
const PREFIX = dev ? opt('dir', 'experiments/evo/dev-aba') : 'experiments/evo/f17', LEARNERS = (dev ? opt('learners', 'plain,dual,regime') : 'plain,dual,regime,cue').split(',') as ('plain' | 'dual' | 'regime' | 'cue')[];
const PHASE = 1200, WIN = 200, PER = PHASE / WIN, EARLY = 2, K = 6, HARM = 1;
type Pattern = 'half' | 'abab' | 'long';
const ALL: { id: string; pattern: Pattern; cue: 'off' | 'true' }[] = [{ id: 'half-off', pattern: 'half', cue: 'off' }, { id: 'abab-off', pattern: 'abab', cue: 'off' }, { id: 'abab-true', pattern: 'abab', cue: 'true' }, { id: 'long-off', pattern: 'long', cue: 'off' }, { id: 'long-true', pattern: 'long', cue: 'true' }];
const VARIANTS = dev ? ALL.filter(v => !v.id.endsWith('true') || LEARNERS.includes('cue')) : ALL;
const PHASES: Record<Pattern, number> = { half: 3, abab: 5, long: 5 };
const POOLS: { id: 'heldout' | 'factual' | 'test'; base: number }[] = dev ? [{ id: 'test', base: 600000 }] : [{ id: 'heldout', base: 610000 }, { id: 'factual', base: 620000 }];
const keys = LEARNERS.flatMap(l => SEEDS.map(s => ({ l, s, key: `laya-${l}-${s}`, dir: `${PREFIX}-laya-${l}-${s}` })));
if (!dev) { const frozen = JSON.parse(readFileSync('experiments/prereg/genome-hashes-17.json', 'utf8')) as Record<string, string>; for (const k of keys) { const h = createHash('sha256').update(readFileSync(`${k.dir}/final.json`)).digest('hex'); if (frozen[k.key] !== h) throw Error(`genome_hash_mismatch:${k.key}`); } }
mkdirSync(out, { recursive: false });
const registered = registerPools() as Record<string, unknown[] | undefined>, mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const share = (good: number[], bad: number[], a: number, b: number) => { let g = 0, t = 0; for (let i = a; i < b; i++) { g += good[i]; t += good[i] + bad[i]; } return t ? g / t : NaN; };
const run = (pool: string, base: number, f: SemanticFactory, v: typeof VARIANTS[number]): Record<string, number>[] => Array.from({ length: N }, (_, i) => {
  const np = PHASES[v.pattern], r = runSemanticWorld({ seed: base + i + ALL.findIndex(x => x.id === v.id) * 1000, options: { split: 'test', pool, sensible: K, harmCap: HARM, inversion: 0, horizon: np * PHASE, drift: { everyTicks: PHASE, fraction: 1, pattern: v.pattern, cue: v.cue } } }, f, WIN), g = r.windows!.good, b = r.windows!.bad;
  const o: Record<string, number> = { fitness: r.fitness, toxic: r.toxicBites };
  for (let p = 0; p < np; p++) o[`E${p}`] = share(g, b, p * PER, p * PER + EARLY);
  return o;
});
const cellMean = (rows: Record<string, number>[], np: number) => { const o: Record<string, number> = {}; for (const k of Object.keys(rows[0])) { const v = rows.map(r => r[k]).filter(Number.isFinite); o[k] = v.length ? mean(v) : 0; }   // 某阶段早期窗口里所有世界都没吃到任何食物（全部死亡等）：该基因组的该指标记为 0
     o.savings = o[`E${np === 3 ? 2 : 4}`] - o.E0; if (np === 5) o.relearn = o.E3 - o.E1; return o; };
const stats: Record<string, Record<string, Record<string, Record<string, number>>>> = {};
for (const pool of POOLS) {
  if (!registered[pool.id]) throw Error(`pool_missing:${pool.id}`);
  const lay = loadLayaPriors(pool.id as 'test'); if (lay.size < (registered[pool.id] as unknown[]).length) throw Error(`cache_incomplete:${pool.id}`);
  stats[pool.id] = {};
  for (const k of keys) {
    const g: number[] = JSON.parse(readFileSync(`${k.dir}/final.json`, 'utf8')).innate;
    const f: SemanticFactory = () => k.l === 'cue' ? structuredCueCohort(g, 'laya', lay) : k.l === 'dual' ? structuredDualCohort(g, 'laya', lay) : k.l === 'regime' ? structuredRegimeCohort(g, 'laya', lay) : structuredCohort(g, 'laya', lay);
    stats[pool.id][k.key] = Object.fromEntries(VARIANTS.map(v => [v.id, cellMean(run(pool.id, pool.base, f, v), PHASES[v.pattern])]));
    console.log(pool.id.padEnd(8), k.key.padEnd(18), VARIANTS.map(v => `${v.id} fit ${stats[pool.id][k.key][v.id].fitness.toFixed(3)} sav ${stats[pool.id][k.key][v.id].savings.toFixed(2)}`).join(' | '));
  }
}
const main = dev ? 'test' : 'heldout', diff = (key: string, a: string, b: string, v: string, pool = main) => SEEDS.map(s => stats[pool][`laya-${a}-${s}`][v][key] - stats[pool][`laya-${b}-${s}`][v][key]);
const signFlipP = (d: number[], shift = 0) => { d = d.map(x => x - shift); const obs = mean(d), n = d.length; let ge = 0; for (let m = 0; m < 1 << n; m++) { let s = 0; for (let i = 0; i < n; i++) s += (m >> i & 1) ? -d[i] : d[i]; if (s / n >= obs - 1e-12) ge++; } return ge / (1 << n); };
const r4 = (x: number) => +x.toFixed(4);
const T = { halfSav: 0.05, halfFit: -0.03, ababSav: 0.15, ababRelearn: 0.05, longSav: 0.20, ababFit: 0.04, cueOverRegime: 0.05, cueLong: 0.20 };
const safe = (f: () => number[]) => { try { return f(); } catch { return SEEDS.map(() => NaN); } };
const hyps = [
  { id: 'H1', claim: `half、无线索：regime 的适应度不比 plain 差超过 ${-T.halfFit}（非劣效）`, d: safe(() => diff('fitness', 'regime', 'plain', 'half-off')), thr: T.halfFit, shift: T.halfFit },
  { id: 'H2', claim: `half、无线索：regime 的节省比 plain 高至少 ${T.halfSav}`, d: safe(() => diff('savings', 'regime', 'plain', 'half-off')), thr: T.halfSav, shift: 0 },
  { id: 'H3', claim: `abab、无线索：regime 的节省（第三个 A 对第一个 A）比 plain 高至少 ${T.ababSav}`, d: safe(() => diff('savings', 'regime', 'plain', 'abab-off')), thr: T.ababSav, shift: 0 },
  { id: 'H4', claim: `abab、无线索：regime 的再学习（第二个 B 对第一个 B）比 plain 高至少 ${T.ababRelearn}`, d: safe(() => diff('relearn', 'regime', 'plain', 'abab-off')), thr: T.ababRelearn, shift: 0 },
  { id: 'H5', claim: `long、无线索：regime 的节省比 plain 高至少 ${T.longSav}（B 停留很久后仍保留 A）`, d: safe(() => diff('savings', 'regime', 'plain', 'long-off')), thr: T.longSav, shift: 0 },
  { id: 'H6', claim: `abab、无线索：regime 的适应度比 plain 高至少 ${T.ababFit}`, d: safe(() => diff('fitness', 'regime', 'plain', 'abab-off')), thr: T.ababFit, shift: 0 },
  { id: 'H7', claim: `abab、真实线索：cue 的节省比 regime 高至少 ${T.cueOverRegime}`, d: safe(() => diff('savings', 'cue', 'regime', 'abab-true')), thr: T.cueOverRegime, shift: 0 },
  { id: 'H8', claim: `long、真实线索：cue 的节省比 plain 高至少 ${T.cueLong}`, d: safe(() => diff('savings', 'cue', 'plain', 'long-true')), thr: T.cueLong, shift: 0 },
].map(h => ({ ...h, stat: mean(h.d), p: signFlipP(h.d, h.shift) }));
const sorted = hyps.slice().sort((a, b) => a.p - b.p || a.id.localeCompare(b.id)), reject = new Map<string, boolean>(); let stop = false;
sorted.forEach((h, i) => { const r = !stop && h.p < 0.05 / (sorted.length - i); if (!r) stop = true; reject.set(h.id, r); });
const verdicts = hyps.map(h => ({ id: h.id, claim: h.claim, statistic: r4(h.stat), threshold: h.thr, effectOk: h.shift ? h.stat > h.thr : h.stat >= h.thr, p: r4(h.p), holmReject: reject.get(h.id)!, supported: reject.get(h.id)! && (h.shift ? h.stat > h.thr : h.stat >= h.thr), perSeed: h.d.map(r4) }));
const roundAll = (o: typeof stats) => Object.fromEntries(Object.entries(o).map(([p, c]) => [p, Object.fromEntries(Object.entries(c).map(([k, vs]) => [k, Object.fromEntries(Object.entries(vs).map(([v, m]) => [v, Object.fromEntries(Object.entries(m).map(([n, x]) => [n, r4(x)]))]))]))]));
writeFileSync(`${out}/results.json`, JSON.stringify({ protocol: dev ? 'dev' : 'docs/PREREGISTRATION_18.md', dev, worldsPerCell: N, K, harmCap: HARM, phase: PHASE, window: WIN, seeds: SEEDS, primary: verdicts, cells: roundAll(stats) }, null, 2));
console.log(JSON.stringify(verdicts.map(v => ({ id: v.id, stat: v.statistic, thr: v.threshold, p: v.p, supported: v.supported })), null, 0));
