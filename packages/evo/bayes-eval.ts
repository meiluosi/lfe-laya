// G11c 确认性评估（预注册 21）：贝叶斯环境推断学习器（缓存的 LLM 句对判断作传感器）在“线索措辞每阶段都改写”的反转世界里，与 plain / regime / cue 对等比较。
// 基因组：plain、regime、cue 来自预注册 20（f20-laya-*，种子 221–236，哈希 genome-hashes-20.json）；bayes、benv-off 为本预注册新训练（f21-laya-*，哈希 genome-hashes-21.json）。
// 同一个 bayes 基因组还在四种传感器条件下评估：LLM（缺省）、预言机（作者标签，仅作上限）、打乱（句子序号随机置换）、30% 的句对判断被取反。
// 开发期：node packages/evo/bayes-eval.ts <新输出目录> --dev --seeds 211,212 --worlds 8   （基因组用开发期的 f17 plain / regime + 手工 bayes 基因；不检验假设）
// 正式：node packages/evo/bayes-eval.ts <输出目录> --prereg 21 [--seeds 221,222]  （每个种子写 seed-<种子>.json；16 个种子齐全后自动检验并写 results.json。协议 docs/PREREGISTRATION_21.md）
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runSemanticWorld, type SemanticFactory } from './semantic-run.ts';
import { registerPools, loadLayaPriors, loadPoolFile } from './pools.ts';
import { registerPool, type PoolEntryLike } from './semantic.ts';
import { structuredCohort } from './structured.ts';
import { structuredRegimeCohort, structuredCueCohort } from './structured-ctx.ts';
import { structuredBenvCohort, CUE_STATE, type SensorOverride } from './structured-benv.ts';

const args = process.argv.slice(2), out = args[0]; if (!out) throw Error('Usage: node packages/evo/bayes-eval.ts <output-directory> --dev|--prereg 21 ...');
const opt = (n: string, d: string) => args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d;
const dev = args.includes('--dev'); if (!dev && opt('prereg', '') !== '21') throw Error('need --dev or --prereg 21');
const ALL_SEEDS = dev ? opt('seeds', '211,212').split(',').map(Number) : Array.from({ length: 16 }, (_, i) => 221 + i);
const SEEDS = !dev && args.includes('--seeds') ? opt('seeds', '').split(',').map(Number) : ALL_SEEDS; if (SEEDS.some(s => !ALL_SEEDS.includes(s))) throw Error('seed_not_in_protocol');
const N = dev ? Number(opt('worlds', '8')) : 24, PHASE = 1200, WIN = 200, PER = PHASE / WIN, EARLY = 2, HARM = 1, K = 6;
type Cond = { id: string; learner: 'plain' | 'regime' | 'cue' | 'benv' | 'benv-off'; sensor?: 'llm' | 'oracle' | 'shuffled' | 'wrong30' };
const CONDS: Cond[] = [{ id: 'plain', learner: 'plain' }, { id: 'regime', learner: 'regime' }, { id: 'cue', learner: 'cue' }, { id: 'benv-off', learner: 'benv-off' }, { id: 'benv', learner: 'benv', sensor: 'llm' }, { id: 'benv@oracle', learner: 'benv', sensor: 'oracle' }, { id: 'benv@shuffled', learner: 'benv', sensor: 'shuffled' }, { id: 'benv@wrong30', learner: 'benv', sensor: 'wrong30' }];
const VARIANTS: { id: string; pattern: 'aba' | 'abab' }[] = [{ id: 'aba-para', pattern: 'aba' }, { id: 'abab-para', pattern: 'abab' }]; const PHASES = { aba: 3, abab: 5 };
const POOLS: { id: string; base: number }[] = dev ? [{ id: opt('pool', 'test'), base: 600000 }] : [{ id: 'mushroom', base: 720000 }, { id: 'heldout', base: 730000 }];
const pathOf = (l: string, s: number) => dev ? (l === 'plain' || l === 'regime' || l === 'cue' ? `experiments/evo/f17-laya-${l}-${s}/final.json` : '') : (l === 'benv' || l === 'benv-off' ? `experiments/evo/f21-laya-${l}-${s}/final.json` : `experiments/evo/f20-laya-${l}-${s}/final.json`);
const handBayes = (s: number) => [...JSON.parse(readFileSync(`experiments/evo/f17-laya-plain-${s}/final.json`, 'utf8')).innate, .7, .02, .3, .9, .5];
const genomeOf = (l: string, s: number): number[] => dev && (l === 'benv' || l === 'benv-off') ? handBayes(s) : JSON.parse(readFileSync(pathOf(l, s), 'utf8')).innate;
if (!dev) for (const [file, learners] of [['genome-hashes-20.json', ['plain', 'regime', 'cue']], ['genome-hashes-21.json', ['benv', 'benv-off']]] as const) { const frozen = JSON.parse(readFileSync(`experiments/prereg/${file}`, 'utf8')) as Record<string, string>; for (const l of learners) for (const s of ALL_SEEDS) { const h = createHash('sha256').update(readFileSync(pathOf(l, s))).digest('hex'); if (frozen[`laya-${l}-${s}`] !== h) throw Error(`genome_hash_mismatch:laya-${l}-${s}`); } }
mkdirSync(out, { recursive: !dev });
const registered = registerPools() as Record<string, unknown[] | undefined>; if (!dev) { registerPool('mushroom', loadPoolFile('mushroom') as PoolEntryLike[]); registered.mushroom = loadPoolFile('mushroom'); }
const SIMP = (JSON.parse(readFileSync(new URL('./cue-sim.json', import.meta.url), 'utf8')) as { p: number[][] }).p;
const perm = (() => { const a = Array.from({ length: SIMP.length }, (_, i) => i); let s = 5; for (let i = a.length - 1; i > 0; i--) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; })();
const hash30 = (i: number, j: number) => { let h = 2166136261; for (const ch of `${Math.min(i, j)}|${Math.max(i, j)}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) % 100 < 30; };
const SENSORS: Record<string, SensorOverride | undefined> = { llm: undefined, oracle: (i, j) => CUE_STATE[i] === CUE_STATE[j] ? 1 : 0, shuffled: (i, j) => SIMP[perm[i]][perm[j]], wrong30: (i, j) => hash30(i, j) ? 1 - SIMP[i][j] : SIMP[i][j] };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const share = (good: number[], bad: number[], a: number, b: number) => { let g = 0, t = 0; for (let i = a; i < b; i++) { g += good[i]; t += good[i] + bad[i]; } return t ? g / t : NaN; };
const run = (pool: string, base: number, f: SemanticFactory, v: typeof VARIANTS[number], vi: number): Record<string, number>[] => Array.from({ length: N }, (_, i) => {
  const np = PHASES[v.pattern], r = runSemanticWorld({ seed: base + i + vi * 1000, options: { split: 'test', pool, sensible: K, harmCap: HARM, inversion: 0, horizon: np * PHASE, drift: { everyTicks: PHASE, fraction: 1, pattern: v.pattern, cue: 'paraphrase' } } }, f, WIN), g = r.windows!.good, b = r.windows!.bad;
  const o: Record<string, number> = { fitness: r.fitness }; for (let p = 0; p < np; p++) o[`E${p}`] = share(g, b, p * PER, p * PER + EARLY); return o;
});
const cellMean = (rows: Record<string, number>[], np: number) => { const o: Record<string, number> = {}; for (const k of Object.keys(rows[0])) { const v = rows.map(r => r[k]).filter(Number.isFinite); o[k] = v.length ? mean(v) : 0; } o.savings = o[`E${np === 3 ? 2 : 4}`] - o.E0; return o; };
type SeedOut = { seed: number; cells: Record<string, Record<string, Record<string, Record<string, number>>>> };   // pool → 条件 → 变体 → 指标
const seedFile = (s: number) => `${out}/seed-${s}.json`;
function runSeed(s: number): SeedOut {
  const cells: SeedOut['cells'] = {};
  for (const pool of POOLS) {
    if (!registered[pool.id]) throw Error(`pool_missing:${pool.id}`); const lay = loadLayaPriors(pool.id as 'test'); if (lay.size < (registered[pool.id] as unknown[]).length) throw Error(`cache_incomplete:${pool.id}`);
    cells[pool.id] = {};
    for (const c of CONDS) {
      const g = genomeOf(c.learner, s), f: SemanticFactory = () => c.learner === 'cue' ? structuredCueCohort(g, 'laya', lay) : c.learner === 'regime' ? structuredRegimeCohort(g, 'laya', lay) : c.learner === 'plain' ? structuredCohort(g, 'laya', lay) : structuredBenvCohort(g, 'laya', lay, { sensor: c.learner === 'benv', ...(c.sensor && SENSORS[c.sensor] ? { sim: SENSORS[c.sensor] } : {}) });
      cells[pool.id][c.id] = Object.fromEntries(VARIANTS.map((v, vi) => [v.id, cellMean(run(pool.id, pool.base, f, v, vi), PHASES[v.pattern])]));
      console.log(`seed ${s} ${pool.id} ${c.id}`.padEnd(34), Object.entries(cells[pool.id][c.id]).map(([v, m]) => `${v} fit ${m.fitness.toFixed(3)} sav ${m.savings.toFixed(2)}`).join(' | '));
    }
  }
  return { seed: s, cells };
}
for (const s of SEEDS) { if (existsSync(seedFile(s))) { console.log(`seed ${s}: exists, skipped`); continue; } writeFileSync(seedFile(s), JSON.stringify(runSeed(s))); }
if (!ALL_SEEDS.every(s => existsSync(seedFile(s)))) { console.log('not all seeds present yet; no analysis'); process.exit(0); }

const data: SeedOut[] = ALL_SEEDS.map(s => JSON.parse(readFileSync(seedFile(s), 'utf8')));
const signFlipP = (d: number[], shift = 0) => { d = d.map(x => x - shift); const obs = mean(d), n = d.length; if (n > 20) throw Error('too_many_seeds_for_exact'); let ge = 0; for (let m = 0; m < 1 << n; m++) { let sm = 0; for (let i = 0; i < n; i++) sm += (m >> i & 1) ? -d[i] : d[i]; if (sm / n >= obs - 1e-12) ge++; } return ge / (1 << n); };
const r4 = (x: number) => +x.toFixed(4);
const diff = (pool: string, a: string, b: string, v: string, key: string) => data.map(d => d.cells[pool][a][v][key] - d.cells[pool][b][v][key]);
const T = { sav: 0.15, savAbab: 0.10, nonInf: -0.03, lang: 0.03, robust: 0.02, cueGap: 0.08 };
const hyps = dev ? [] : [
  { id: 'H1', claim: `mushroom、aba-para：benv 节省 − plain ≥ ${T.sav}`, d: diff('mushroom', 'benv', 'plain', 'aba-para', 'savings'), thr: T.sav, shift: 0 },
  { id: 'H2', claim: `mushroom、aba-para：benv 适应度不比 regime 差超过 ${-T.nonInf}（非劣效）`, d: diff('mushroom', 'benv', 'regime', 'aba-para', 'fitness'), thr: T.nonInf, shift: T.nonInf },
  { id: 'H3', claim: `mushroom、aba-para：benv 节省 − benv-off（不读线索的消融）≥ ${T.sav}`, d: diff('mushroom', 'benv', 'benv-off', 'aba-para', 'savings'), thr: T.sav, shift: 0 },
  { id: 'H4', claim: `mushroom、aba-para：benv 适应度 − 打乱传感器的同一基因组 ≥ ${T.lang}（读懂语言有用）`, d: diff('mushroom', 'benv', 'benv@shuffled', 'aba-para', 'fitness'), thr: T.lang, shift: 0 },
  { id: 'H5', claim: `mushroom、aba-para：30% 句对被取反的 benv 适应度 − plain ≥ ${T.robust}（读错仍不比不用差）`, d: diff('mushroom', 'benv@wrong30', 'plain', 'aba-para', 'fitness'), thr: T.robust, shift: 0 },
  { id: 'H6', claim: `mushroom、abab-para：benv 节省 − plain ≥ ${T.savAbab}`, d: diff('mushroom', 'benv', 'plain', 'abab-para', 'savings'), thr: T.savAbab, shift: 0 },
  { id: 'H7', claim: `heldout（连续性）、aba-para：benv 节省 − plain ≥ ${T.sav}`, d: diff('heldout', 'benv', 'plain', 'aba-para', 'savings'), thr: T.sav, shift: 0 },
  { id: 'H9', claim: `mushroom、aba-para：benv 节省 − cue（按句子字面分表的记忆）≥ ${T.cueGap}`, d: diff('mushroom', 'benv', 'cue', 'aba-para', 'savings'), thr: T.cueGap, shift: 0 },
  { id: 'H8', claim: `mushroom、aba-para：bayes（LLM 传感器）适应度不比预言机传感器差超过 ${-T.nonInf}（非劣效）`, d: diff('mushroom', 'benv', 'benv@oracle', 'aba-para', 'fitness'), thr: T.nonInf, shift: T.nonInf },
].map(h => ({ ...h, stat: mean(h.d), p: signFlipP(h.d, h.shift) }));
const sorted = hyps.slice().sort((a, b) => a.p - b.p || a.id.localeCompare(b.id)), reject = new Map<string, boolean>(); let stop = false;
sorted.forEach((h, i) => { const r = !stop && h.p < 0.05 / (sorted.length - i); if (!r) stop = true; reject.set(h.id, r); });
const verdicts = hyps.map(h => { const eff = h.shift ? h.stat > h.thr : h.stat >= h.thr; return { id: h.id, claim: h.claim, statistic: r4(h.stat), threshold: h.thr, effectOk: eff, p: r4(h.p), holmReject: reject.get(h.id)!, supported: reject.get(h.id)! && eff, perSeed: h.d.map(r4) }; });
const desc: Record<string, Record<string, Record<string, Record<string, number>>>> = {};
for (const pool of Object.keys(data[0].cells)) { desc[pool] = {}; for (const c of Object.keys(data[0].cells[pool])) { desc[pool][c] = {}; for (const v of Object.keys(data[0].cells[pool][c])) desc[pool][c][v] = Object.fromEntries(['fitness', 'savings', 'E0'].map(k => [k, r4(mean(data.map(d => d.cells[pool][c][v][k])))])); } }
writeFileSync(`${out}/results.json`, JSON.stringify({ protocol: dev ? 'dev' : 'docs/PREREGISTRATION_21.md', dev, worldsPerCell: N, K, harmCap: HARM, seeds: ALL_SEEDS, primary: verdicts, cellMeans: desc }, null, 2));
if (verdicts.length) console.log(JSON.stringify(verdicts.map(v => ({ id: v.id, stat: v.statistic, thr: v.threshold, p: v.p, supported: v.supported })))); else console.log('dev:', JSON.stringify(desc));
