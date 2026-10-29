// G13 确认性评估（预注册 22）：层级可靠度 + 多通道线索，在“线索可靠度因世界而变”的稠密交替世界里。
// 学习器（f22-laya-<id>-<种子>，种子 301–308）：b3off（只用数值证据）、b3f1（一条通道，只有先天可靠度）、b3f1c（同 b3f1，但训练史里线索永远可靠）、
// b3o1（一条通道 + 一生内更新）、b3f2（两条通道，只有先天）、b3o2（两条通道 + 一生内更新）。
// 评估：16 个（通道 1 制度，通道 2 制度）组合 + 2 个留出缺陷强度（通道 1 误导 0.15 / 0.45，通道 2 无）；每个（学习器，池，组合）8 个新世界；指标 = 适应度。
// 开发期：node packages/evo/cue-eval.ts <新输出目录> --dev --worlds 3   （手设基因，开发池 test，不检验假设）
// 正式：node packages/evo/cue-eval.ts <输出目录> --prereg 22 [--seeds 301,302]  （基因组哈希须与 experiments/prereg/genome-hashes-22.json 一致；每个种子写 seed-<种子>.json；8 个种子齐全后自动检验。协议 docs/PREREGISTRATION_22.md）
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runSemanticWorld, type SemanticFactory } from './semantic-run.ts';
import { registerPools, loadLayaPriors, loadPoolFile } from './pools.ts';
import { registerPool, type PoolEntryLike } from './semantic.ts';
import { structuredBenv3Cohort, type Benv3Opt } from './structured-benv3.ts';
import { cueOptions, REGIMES, type RegimeName } from './cue-regimes.ts';

const args = process.argv.slice(2), out = args[0]; if (!out) throw Error('Usage: node packages/evo/cue-eval.ts <output-directory> --dev|--prereg 22 ...');
const opt = (n: string, d: string) => args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d;
const dev = args.includes('--dev'); if (!dev && opt('prereg', '') !== '22') throw Error('need --dev or --prereg 22');
const ALL_SEEDS = dev ? [201] : Array.from({ length: 8 }, (_, i) => 301 + i), SEEDS = !dev && args.includes('--seeds') ? opt('seeds', '').split(',').map(Number) : ALL_SEEDS; if (SEEDS.some(s => !ALL_SEEDS.includes(s))) throw Error('seed_not_in_protocol');
const N = dev ? Number(opt('worlds', '3')) : 8, HORIZON = 4500, K = 6, HARM = 1;
const LEARNERS: { id: string; o: Benv3Opt }[] = [{ id: 'b3off', o: { sensor: false } }, { id: 'b3f1', o: { channels: 1, online: false } }, { id: 'b3f1c', o: { channels: 1, online: false } }, { id: 'b3o1', o: { channels: 1, online: true } }, { id: 'b3f2', o: { channels: 2, online: false } }, { id: 'b3o2', o: { channels: 2, online: true } }];
type Reg = RegimeName | { missing: number; wrong: number };
const CELLS: { id: string; r1: Reg; r2: Reg | null }[] = [
  ...REGIMES.flatMap(a => REGIMES.map(b => ({ id: `${a.name}/${b.name}`, r1: a.name as Reg, r2: b.name as Reg }))),
  { id: 'wrong.15/absent', r1: { missing: 0, wrong: .15 }, r2: 'absent' }, { id: 'wrong.45/absent', r1: { missing: 0, wrong: .45 }, r2: 'absent' },
];
const POOLS: { id: string; base: number }[] = dev ? [{ id: 'test', base: 600000 }] : [{ id: 'mushroom', base: 740000 }, { id: 'heldout', base: 750000 }];
const pathOf = (id: string, s: number) => `experiments/evo/f22-laya-${id}-${s}/final.json`;
const devGenome = (s: number) => [...JSON.parse(readFileSync(`experiments/evo/dev-aba-laya-plain-${s}/final.json`, 'utf8')).innate, .7, .02, .3, .5, .8, 8];
const genomeOf = (id: string, s: number): number[] => dev ? devGenome(s) : JSON.parse(readFileSync(pathOf(id, s), 'utf8')).innate;
if (!dev) { const frozen = JSON.parse(readFileSync('experiments/prereg/genome-hashes-22.json', 'utf8')) as Record<string, string>; for (const l of LEARNERS) for (const s of ALL_SEEDS) { const h = createHash('sha256').update(readFileSync(pathOf(l.id, s))).digest('hex'); if (frozen[`laya-${l.id}-${s}`] !== h) throw Error(`genome_hash_mismatch:laya-${l.id}-${s}`); } }
mkdirSync(out, { recursive: !dev });
const registered = registerPools() as Record<string, unknown[] | undefined>; if (!dev) { registerPool('mushroom', loadPoolFile('mushroom') as PoolEntryLike[]); registered.mushroom = loadPoolFile('mushroom'); }
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
type SeedOut = { seed: number; cells: Record<string, Record<string, Record<string, number>>> };   // 池 → 学习器 → 组合 → 适应度均值
const seedFile = (s: number) => `${out}/seed-${s}.json`;
function runSeed(s: number): SeedOut {
  const cells: SeedOut['cells'] = {};
  for (const pool of POOLS) {
    if (!registered[pool.id]) throw Error(`pool_missing:${pool.id}`); const lay = loadLayaPriors(pool.id as 'test'); if (lay.size < (registered[pool.id] as unknown[]).length) throw Error(`cache_incomplete:${pool.id}`);
    cells[pool.id] = {};
    for (const l of LEARNERS) {
      const g = genomeOf(l.id, s), f: SemanticFactory = () => structuredBenv3Cohort(g, 'laya', lay, l.o); cells[pool.id][l.id] = {};
      CELLS.forEach((c, ci) => { cells[pool.id][l.id][c.id] = mean(Array.from({ length: N }, (_, i) => runSemanticWorld({ seed: pool.base + ci * 100 + i, options: { split: 'test', pool: pool.id, sensible: K, harmCap: HARM, inversion: 0, horizon: HORIZON, drift: { everyTicks: 300, fraction: 1, pattern: 'alt', cue: 'paraphrase', ...cueOptions(c.r1, c.r2) } } }, f).fitness)); });
      console.log(`seed ${s} ${pool.id} ${l.id}`.padEnd(28), `reliable/absent ${cells[pool.id][l.id]['reliable/absent'].toFixed(3)} noisy/absent ${cells[pool.id][l.id]['noisy/absent'].toFixed(3)} noisy/reliable ${cells[pool.id][l.id]['noisy/reliable'].toFixed(3)}`);
    }
  }
  return { seed: s, cells };
}
for (const s of SEEDS) { if (existsSync(seedFile(s))) { console.log(`seed ${s}: exists, skipped`); continue; } writeFileSync(seedFile(s), JSON.stringify(runSeed(s))); }
if (!ALL_SEEDS.every(s => existsSync(seedFile(s)))) { console.log('not all seeds present yet; no analysis'); process.exit(0); }

const data: SeedOut[] = ALL_SEEDS.map(s => JSON.parse(readFileSync(seedFile(s), 'utf8')));
const signFlipP = (d: number[], shift = 0) => { d = d.map(x => x - shift); const obs = mean(d), n = d.length; if (n > 20) throw Error('too_many_seeds_for_exact'); let ge = 0; for (let m = 0; m < 1 << n; m++) { let sm = 0; for (let i = 0; i < n; i++) sm += (m >> i & 1) ? -d[i] : d[i]; if (sm / n >= obs - 1e-12) ge++; } return ge / (1 << n); };
const r4 = (x: number) => +x.toFixed(4);
const cellMean = (d: SeedOut, pool: string, l: string, cells: string[]) => mean(cells.map(c => d.cells[pool][l][c]));
const diff = (pool: string, a: string, b: string, cells: string[]) => data.map(d => cellMean(d, pool, a, cells) - cellMean(d, pool, b, cells));
const ALL16 = CELLS.slice(0, 16).map(c => c.id), U1 = ['noisy/absent', 'uninformative/absent'], R1 = ['reliable/absent'], SINGLE4 = ['reliable/absent', 'noisy/absent', 'uninformative/absent', 'absent/absent'], SECOND = ['noisy/reliable', 'uninformative/reliable'], HOLD = ['wrong.15/absent', 'wrong.45/absent'];
const minDiff = data.map(d => Math.min(...ALL16.map(c => d.cells.mushroom.b3o2[c] - d.cells.mushroom.b3off[c])));
const T = { evo: 0.04, cost: -0.03, pays: 0.20, never: -0.05, online: 0.02, harmless: -0.03, second: 0.05, hold: 0.05, cont: 0.20 };
const hyps = dev ? [] : [
  { id: 'H1', claim: `mushroom、通道 1 不可靠（误导 / 无信息）、无第二通道：b3f1（混合史）适应度 − b3f1c（干净史）≥ ${T.evo}（进化史含不可靠线索 → 学到怀疑）`, d: diff('mushroom', 'b3f1', 'b3f1c', U1), thr: T.evo, shift: 0 },
  { id: 'H2', claim: `mushroom、通道 1 可靠、无第二通道：b3f1 不比 b3f1c 差超过 ${-T.cost}（怀疑的代价小，非劣效）`, d: diff('mushroom', 'b3f1', 'b3f1c', R1), thr: T.cost, shift: T.cost },
  { id: 'H3', claim: `mushroom、通道 1 可靠、无第二通道：b3f1 − b3off ≥ ${T.pays}（线索可靠时用线索有大收益）`, d: diff('mushroom', 'b3f1', 'b3off', R1), thr: T.pays, shift: 0 },
  { id: 'H4', claim: `mushroom、16 个组合：每个种子里 b3o2 − b3off 的最小值 > ${T.never}（任何制度下都不比不读线索差得多）`, d: minDiff, thr: T.never, shift: T.never },
  { id: 'H5', claim: `mushroom、无第二通道的 4 种制度均值：b3o1 − b3f1 ≥ ${T.online}（可靠度因世界而变时，一生内更新有额外价值）`, d: diff('mushroom', 'b3o1', 'b3f1', SINGLE4), thr: T.online, shift: 0 },
  { id: 'H6', claim: `mushroom、通道 1 可靠、无第二通道：b3o1 不比 b3f1 差超过 ${-T.harmless}（不需要时一生内更新无害，非劣效）`, d: diff('mushroom', 'b3o1', 'b3f1', R1), thr: T.harmless, shift: T.harmless },
  { id: 'H7', claim: `mushroom、通道 1 不可靠且通道 2 可靠：b3o2 − b3o1 ≥ ${T.second}（第二条独立通道带来额外收益）`, d: diff('mushroom', 'b3o2', 'b3o1', SECOND), thr: T.second, shift: 0 },
  { id: 'H8', claim: `mushroom、留出缺陷强度（通道 1 误导 0.15 / 0.45，无第二通道）：b3f1 − b3off ≥ ${T.hold}`, d: diff('mushroom', 'b3f1', 'b3off', HOLD), thr: T.hold, shift: 0 },
  { id: 'H9', claim: `heldout（连续性）、通道 1 可靠、无第二通道：b3f1 − b3off ≥ ${T.cont}`, d: diff('heldout', 'b3f1', 'b3off', R1), thr: T.cont, shift: 0 },
].map(h => ({ ...h, stat: mean(h.d), p: signFlipP(h.d, h.shift) }));
const sorted = hyps.slice().sort((a, b) => a.p - b.p || a.id.localeCompare(b.id)), reject = new Map<string, boolean>(); let stop = false;
sorted.forEach((h, i) => { const r = !stop && h.p < 0.05 / (sorted.length - i); if (!r) stop = true; reject.set(h.id, r); });
const verdicts = hyps.map(h => { const eff = h.shift ? h.stat > h.thr : h.stat >= h.thr; return { id: h.id, claim: h.claim, statistic: r4(h.stat), threshold: h.thr, effectOk: eff, p: r4(h.p), holmReject: reject.get(h.id)!, supported: reject.get(h.id)! && eff, perSeed: h.d.map(r4) }; });
const desc: Record<string, Record<string, Record<string, number>>> = {}; for (const pool of Object.keys(data[0].cells)) { desc[pool] = {}; for (const l of Object.keys(data[0].cells[pool])) { desc[pool][l] = {}; for (const c of Object.keys(data[0].cells[pool][l])) desc[pool][l][c] = r4(mean(data.map(d => d.cells[pool][l][c]))); } }
const genes: Record<string, number[][]> = {}; if (!dev) for (const l of LEARNERS) genes[l.id] = ALL_SEEDS.map(s => genomeOf(l.id, s).slice(9).map(r4));   // 进化出的 σ、h、ν、hb、rel0、S
writeFileSync(`${out}/results.json`, JSON.stringify({ protocol: dev ? 'dev' : 'docs/PREREGISTRATION_22.md', dev, worldsPerCell: N, horizon: HORIZON, seeds: ALL_SEEDS, primary: verdicts, cellMeans: desc, evolvedBenv3Genes: genes }, null, 2));
if (verdicts.length) console.log(JSON.stringify(verdicts.map(v => ({ id: v.id, stat: v.statistic, thr: v.threshold, p: v.p, supported: v.supported })))); else console.log('dev:', JSON.stringify(desc));
