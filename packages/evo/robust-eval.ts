// G10 稳健性评估（预注册 20）：新训练种子 × 独立来源词池（UCI Mushroom）× 更多食物种类（K=12）× 潜在原因对照学习器。
// 与 retention-eval.ts 同一世界与指标（节省 = 最后一个 A 阶段早期 − 第一个 A 阶段早期的营养食物占比），但：基因组是新训练的（f20），
// 评估池是从未用于任何评估的 mushroom 池（主）与 heldout（连续性），K ∈ {6, 12}，学习器 {plain, regime, cue, latent}。
// 开发期：node packages/evo/robust-eval.ts <新输出目录> --dev --seeds 211,212 --worlds 8 [--K 6,12] [--pool test] [--prefix experiments/evo/f17-laya-]
//   （开发期不跑 mushroom 池，也不做假设检验；latent 用手工基因，仅检查代码与量级）
// 正式：node packages/evo/robust-eval.ts <输出目录> --prereg 20 [--seeds 221,222]  （基因组哈希须与 experiments/prereg/genome-hashes-20.json 一致；
//   每个种子写 seed-<种子>.json，可分进程并行；16 个种子齐全后自动检验并写 results.json。协议 docs/PREREGISTRATION_20.md）
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runSemanticWorld, type SemanticFactory } from './semantic-run.ts';
import { registerPools, loadLayaPriors, loadPoolFile } from './pools.ts';
import { registerPool, type PoolEntryLike } from './semantic.ts';
import { structuredCohort } from './structured.ts';
import { structuredRegimeCohort, structuredCueCohort, structuredLatentCohort } from './structured-ctx.ts';

const args = process.argv.slice(2), out = args[0]; if (!out) throw Error('Usage: node packages/evo/robust-eval.ts <output-directory> --dev|--prereg 20 ...');
const opt = (n: string, d: string) => args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d;
const dev = args.includes('--dev'); if (!dev && opt('prereg', '') !== '20') throw Error('need --dev or --prereg 20');
type L = 'plain' | 'regime' | 'cue' | 'latent';
const ALL_SEEDS = dev ? opt('seeds', '211,212').split(',').map(Number) : Array.from({ length: 16 }, (_, i) => 221 + i);
const SEEDS = !dev && args.includes('--seeds') ? opt('seeds', '').split(',').map(Number) : ALL_SEEDS; if (SEEDS.some(s => !ALL_SEEDS.includes(s))) throw Error('seed_not_in_protocol');
const N = dev ? Number(opt('worlds', '8')) : 24, KS = (dev ? opt('K', '6,12') : '6,12').split(',').map(Number), PREFIX = dev ? opt('prefix', 'experiments/evo/f17-laya-') : 'experiments/evo/f20-laya-';
const LEARNERS: L[] = dev ? opt('learners', 'plain,regime,latent').split(',') as L[] : ['plain', 'regime', 'cue', 'latent'];
const PHASE = 1200, WIN = 200, PER = PHASE / WIN, EARLY = 2, HARM = 1;
type Pattern = 'aba' | 'abab' | 'half';
const ALL: { id: string; pattern: Pattern; cue: 'off' | 'true' }[] = [{ id: 'aba-off', pattern: 'aba', cue: 'off' }, { id: 'aba-true', pattern: 'aba', cue: 'true' }, { id: 'abab-off', pattern: 'abab', cue: 'off' }, { id: 'half-off', pattern: 'half', cue: 'off' }];
const PHASES: Record<Pattern, number> = { aba: 3, abab: 5, half: 3 };
const POOLS: { id: string; base: number }[] = dev ? [{ id: opt('pool', 'test'), base: 600000 }] : [{ id: 'mushroom', base: 700000 }, { id: 'heldout', base: 710000 }];
const handLatent = [Math.log(3), .3, -.3, .05, .02, 1, 0, .3, 0, .5, 4, .4, .9];
const genomeOf = (l: L, s: number): number[] => l === 'latent' && dev ? handLatent : JSON.parse(readFileSync(`${PREFIX}${l}-${s}/final.json`, 'utf8')).innate;
if (!dev) { const frozen = JSON.parse(readFileSync('experiments/prereg/genome-hashes-20.json', 'utf8')) as Record<string, string>; for (const l of LEARNERS) for (const s of ALL_SEEDS) { const h = createHash('sha256').update(readFileSync(`${PREFIX}${l}-${s}/final.json`)).digest('hex'); if (frozen[`laya-${l}-${s}`] !== h) throw Error(`genome_hash_mismatch:laya-${l}-${s}`); } }
mkdirSync(out, { recursive: !dev });
const registered = registerPools() as Record<string, unknown[] | undefined>;
if (!dev) { registerPool('mushroom', loadPoolFile('mushroom') as PoolEntryLike[]); registered.mushroom = loadPoolFile('mushroom'); }
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const share = (good: number[], bad: number[], a: number, b: number) => { let g = 0, t = 0; for (let i = a; i < b; i++) { g += good[i]; t += good[i] + bad[i]; } return t ? g / t : NaN; };
const run = (pool: string, base: number, f: SemanticFactory, v: typeof ALL[number], K: number): Record<string, number>[] => Array.from({ length: N }, (_, i) => {
  const np = PHASES[v.pattern], r = runSemanticWorld({ seed: base + i + ALL.findIndex(x => x.id === v.id) * 1000 + (K === 12 ? 500 : 0), options: { split: 'test', pool, sensible: K, harmCap: HARM, inversion: 0, horizon: np * PHASE, drift: { everyTicks: PHASE, fraction: 1, pattern: v.pattern, cue: v.cue } } }, f, WIN), g = r.windows!.good, b = r.windows!.bad;
  const o: Record<string, number> = { fitness: r.fitness, toxic: r.toxicBites };
  for (let p = 0; p < np; p++) o[`E${p}`] = share(g, b, p * PER, p * PER + EARLY);
  return o;
});
const cellMean = (rows: Record<string, number>[], np: number) => { const o: Record<string, number> = {}; for (const k of Object.keys(rows[0])) { const v = rows.map(r => r[k]).filter(Number.isFinite); o[k] = v.length ? mean(v) : 0; }   // 某阶段早期窗口里所有世界都没吃到任何食物：记 0（同预注册 18）
  o.savings = o[`E${np === 3 ? 2 : 4}`] - o.E0; return o; };
type SeedOut = { seed: number; cells: Record<string, Record<string, Record<string, Record<string, number>>>> };   // pool → K/learner/variant → 指标
const seedFile = (s: number) => `${out}/seed-${s}.json`;
function runSeed(s: number): SeedOut {
  const cells: SeedOut['cells'] = {};
  for (const pool of POOLS) {
    if (!registered[pool.id]) throw Error(`pool_missing:${pool.id}`);
    const lay = loadLayaPriors(pool.id as 'test'); if (lay.size < (registered[pool.id] as unknown[]).length) throw Error(`cache_incomplete:${pool.id}`);
    cells[pool.id] = {};
    for (const K of KS) for (const l of LEARNERS) {
      const g = genomeOf(l, s), f: SemanticFactory = () => l === 'cue' ? structuredCueCohort(g, 'laya', lay) : l === 'regime' ? structuredRegimeCohort(g, 'laya', lay) : l === 'latent' ? structuredLatentCohort(g, 'laya', lay) : structuredCohort(g, 'laya', lay);
      cells[pool.id][`K${K}/${l}`] = Object.fromEntries(ALL.filter(v => v.cue === 'off' || l === 'cue').map(v => [v.id, cellMean(run(pool.id, pool.base, f, v, K), PHASES[v.pattern])]));
      const c = cells[pool.id][`K${K}/${l}`]; console.log(`seed ${s} ${pool.id} K${K} ${l}`.padEnd(30), Object.entries(c).map(([v, m]) => `${v} fit ${m.fitness.toFixed(3)} sav ${m.savings.toFixed(2)}`).join(' | '));
    }
  }
  return { seed: s, cells };
}
for (const s of SEEDS) { if (existsSync(seedFile(s))) { console.log(`seed ${s}: exists, skipped`); continue; } writeFileSync(seedFile(s), JSON.stringify(runSeed(s))); }
if (!ALL_SEEDS.every(s => existsSync(seedFile(s)))) { console.log('not all seeds present yet; no analysis'); process.exit(0); }

// ---- 分析 ----
const data: SeedOut[] = ALL_SEEDS.map(s => JSON.parse(readFileSync(seedFile(s), 'utf8')));
const signFlipP = (d: number[], shift = 0) => { d = d.map(x => x - shift); const obs = mean(d), n = d.length; if (n > 20) throw Error('too_many_seeds_for_exact'); let ge = 0; for (let m = 0; m < 1 << n; m++) { let sm = 0; for (let i = 0; i < n; i++) sm += (m >> i & 1) ? -d[i] : d[i]; if (sm / n >= obs - 1e-12) ge++; } return ge / (1 << n); };
const r4 = (x: number) => +x.toFixed(4);
const diff = (pool: string, K: number, a: L, b: L, v: string, key: string) => data.map(d => d.cells[pool][`K${K}/${a}`][v][key] - d.cells[pool][`K${K}/${b}`][v][key]);
const T = { aba: 0.15, abab: 0.15, half: 0.05, k12: 0.10, vsLatent: -0.05, fit: 0.04, cont: 0.15 };
const hyps = dev ? [] : [
  { id: 'H1', claim: `mushroom、K=6、A/B/A 无线索：regime 节省 − plain ≥ ${T.aba}`, d: diff('mushroom', 6, 'regime', 'plain', 'aba-off', 'savings'), thr: T.aba, shift: 0 },
  { id: 'H2', claim: `mushroom、K=6、A/B/A/B/A：regime 节省 − plain ≥ ${T.abab}`, d: diff('mushroom', 6, 'regime', 'plain', 'abab-off', 'savings'), thr: T.abab, shift: 0 },
  { id: 'H3', claim: `mushroom、K=6、部分反转：regime 节省 − plain ≥ ${T.half}`, d: diff('mushroom', 6, 'regime', 'plain', 'half-off', 'savings'), thr: T.half, shift: 0 },
  { id: 'H4', claim: `mushroom、K=12、A/B/A：regime 节省 − plain ≥ ${T.k12}`, d: diff('mushroom', 12, 'regime', 'plain', 'aba-off', 'savings'), thr: T.k12, shift: 0 },
  { id: 'H5', claim: `mushroom、K=6、A/B/A：regime 节省不比 latent 差超过 ${-T.vsLatent}（非劣效）`, d: diff('mushroom', 6, 'regime', 'latent', 'aba-off', 'savings'), thr: T.vsLatent, shift: T.vsLatent },
  { id: 'H6', claim: `mushroom、K=6、A/B/A 无线索：regime 适应度 − plain ≥ ${T.fit}`, d: diff('mushroom', 6, 'regime', 'plain', 'aba-off', 'fitness'), thr: T.fit, shift: 0 },
  { id: 'H7', claim: `heldout（连续性）、K=6、A/B/A 无线索：regime 节省 − plain ≥ ${T.cont}`, d: diff('heldout', 6, 'regime', 'plain', 'aba-off', 'savings'), thr: T.cont, shift: 0 },
].map(h => ({ ...h, stat: mean(h.d), p: signFlipP(h.d, h.shift) }));
const sorted = hyps.slice().sort((a, b) => a.p - b.p || a.id.localeCompare(b.id)), reject = new Map<string, boolean>(); let stop = false;
sorted.forEach((h, i) => { const r = !stop && h.p < 0.05 / (sorted.length - i); if (!r) stop = true; reject.set(h.id, r); });
const verdicts = hyps.map(h => { const eff = h.shift ? h.stat > h.thr : h.stat >= h.thr; return { id: h.id, claim: h.claim, statistic: r4(h.stat), threshold: h.thr, effectOk: eff, p: r4(h.p), holmReject: reject.get(h.id)!, supported: reject.get(h.id)! && eff, perSeed: h.d.map(r4) }; });
// 描述性：全部单元的跨种子均值
const desc: Record<string, Record<string, Record<string, Record<string, number>>>> = {};
for (const pool of Object.keys(data[0].cells)) { desc[pool] = {}; for (const kl of Object.keys(data[0].cells[pool])) { desc[pool][kl] = {}; for (const v of Object.keys(data[0].cells[pool][kl])) desc[pool][kl][v] = Object.fromEntries(['fitness', 'savings', 'E0'].map(k => [k, r4(mean(data.map(d => d.cells[pool][kl][v][k])))])); } }
writeFileSync(`${out}/results.json`, JSON.stringify({ protocol: dev ? 'dev' : 'docs/PREREGISTRATION_20.md', dev, worldsPerCell: N, K: KS, harmCap: HARM, seeds: ALL_SEEDS, primary: verdicts, cellMeans: desc }, null, 2));
if (verdicts.length) console.log(JSON.stringify(verdicts.map(v => ({ id: v.id, stat: v.statistic, thr: v.threshold, p: v.p, supported: v.supported })))); else console.log('dev: no hypothesis test'), console.log(JSON.stringify(desc));
