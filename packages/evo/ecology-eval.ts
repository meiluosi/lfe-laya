// G8 评估：纯种群并排（同一世界种子，只换类型）、混合种群、中性对照。分析单位 = 训练种子（每个种子的基因组在若干世界里取均值）。
// 开发期：node packages/evo/ecology-eval.ts <新输出目录> --dev --seeds 201,202 --worlds 6 --dirs plain=experiments/evo/dev-aba-laya-plain,regime=experiments/evo/dev-aba-laya-regime
//        [--mode pure|mixed|neutral|all] [--pattern abab,half]（开发期两个模式都有时才会算假设检验，用来检查分析代码） [--supply 20 --threshold 26 --init 16] [--pool train --split train]
// 正式（协议 docs/PREREGISTRATION_19.md，参数全部冻结）：node packages/evo/ecology-eval.ts <输出目录> --prereg 19 [--seeds 211,212]
//        基因组哈希必须与 experiments/prereg/genome-hashes-17.json 一致；每个训练种子单独写 seed-<种子>.json（可分进程并行，输出目录允许共用）；
//        8 个种子齐全后自动做假设检验并写 results.json。已有 seed-<种子>.json 时跳过该种子（崩溃续跑；续跑须公开记录）。
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runEcology, type TypeSpec, type EcologyResult, type Learner } from './ecology-run.ts';
import { registerPools, loadLayaPriors } from './pools.ts';

const args = process.argv.slice(2), out = args[0]; if (!out) throw Error('Usage: node packages/evo/ecology-eval.ts <output-directory> --dev ... | --prereg 19');
const opt = (n: string, d: string) => args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d;
const dev = args.includes('--dev'), prereg = dev ? '' : opt('prereg', ''); if (!dev && prereg !== '19') throw Error('need --dev or --prereg 19');
// 冻结参数（预注册 19 §2）；开发期可由命令行覆盖
const ALL_SEEDS = dev ? opt('seeds', '201,202').split(',').map(Number) : [211, 212, 213, 214, 215, 216, 217, 218];
const SEEDS = dev || !args.includes('--seeds') ? ALL_SEEDS : opt('seeds', '').split(',').map(Number);
if (SEEDS.some(s => !ALL_SEEDS.includes(s))) throw Error('seed_not_in_protocol');
const N = dev ? Number(opt('worlds', '6')) : 48, NMIX = dev ? N : 12, MODE = dev ? opt('mode', 'all') : 'all';
const SUPPLY = dev ? Number(opt('supply', '20')) : 20, THR = dev ? Number(opt('threshold', '26')) : 26, INIT = dev ? Number(opt('init', '16')) : 16;
const POOL = dev ? opt('pool', 'train') : 'heldout', SPLIT = (dev ? opt('split', 'train') : 'test') as 'train' | 'test';
const PREFIX = 'experiments/evo/f17-laya-';
const DIRS: Record<string, string> = dev ? Object.fromEntries(opt('dirs', 'plain=experiments/evo/dev-aba-laya-plain,regime=experiments/evo/dev-aba-laya-regime').split(',').map(x => x.split('='))) : {};
const LEARNERS = (dev ? Object.keys(DIRS) : ['plain', 'regime']) as Learner[];
const PATTERNS = (dev ? opt('pattern', 'abab').split(',') : ['abab', 'half']) as ('abab' | 'half' | 'long' | 'aba')[];
const BASE = dev ? (SPLIT === 'train' ? 800000 : 900000) : 640000, PATTERN_OFFSET: Record<string, number> = { abab: 0, half: 1000, long: 2000, aba: 3000 };
const dirOf = (l: string, s: number) => dev ? `${DIRS[l]}-${s}` : `${PREFIX}${l}-${s}`;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length), r4 = (x: number) => +x.toFixed(4);
if (!dev) { const frozen = JSON.parse(readFileSync('experiments/prereg/genome-hashes-17.json', 'utf8')) as Record<string, string>; for (const l of LEARNERS) for (const s of ALL_SEEDS) { const h = createHash('sha256').update(readFileSync(`${dirOf(l, s)}/final.json`)).digest('hex'); if (frozen[`laya-${l}-${s}`] !== h) throw Error(`genome_hash_mismatch:laya-${l}-${s}`); } }
mkdirSync(out, { recursive: !dev });
registerPools(); const priors = loadLayaPriors(POOL === 'train' ? 'train' : POOL as 'test');
const genes = (l: string, s: number): number[] => JSON.parse(readFileSync(`${dirOf(l, s)}/final.json`, 'utf8')).innate;
const spec = (l: string, s: number, label = l): TypeSpec => ({ label, learner: l as Learner, genes: genes(l, s), prior: 'laya' });
const summarize = (rs: EcologyResult[]) => ({ established: mean(rs.map(r => +r.established)), births: mean(rs.map(r => r.births)), meanLast2: mean(rs.map(r => r.meanLast2)), recovery: mean(rs.map(r => r.recovery)), extinct: mean(rs.map(r => +(r.extinctAt >= 0))) });
type Cell = ReturnType<typeof summarize>;
type SeedOut = { seed: number; pure: Record<string, Record<string, Cell>>; mixed: Record<string, { shareFirst: number[]; bothAlive: number }> };

function runSeed(s: number): SeedOut {
  const pure: SeedOut['pure'] = {}, mixed: SeedOut['mixed'] = {};
  for (const pattern of PATTERNS) {
    const world = (i: number) => BASE + PATTERN_OFFSET[pattern] + i;
    const run = (types: TypeSpec[], i: number) => runEcology({ seed: world(i), pool: POOL, split: SPLIT, priors, pattern, cue: 'off', supply: SUPPLY, threshold: THR, init: INIT, types });
    const share = (rs: EcologyResult[], a: string) => rs.filter(r => r.finalLiving > 0).map(r => r.finalByType[a] / r.finalLiving);
    if (MODE === 'pure' || MODE === 'all') {
      pure[pattern] = {}; for (const l of LEARNERS) pure[pattern][l] = summarize(Array.from({ length: N }, (_, i) => run([spec(l, s)], i)));
      console.log(`seed ${s} ${pattern} pure`, JSON.stringify(Object.fromEntries(Object.entries(pure[pattern]).map(([l, c]) => [l, { est: r4(c.established), pop: +c.meanLast2.toFixed(1), rec: +c.recovery.toFixed(2) }]))));
    }
    if (!dev && pattern !== 'abab') continue;   // 正式：混合与中性对照只在 abab 上做，描述性
    if ((MODE === 'mixed' || MODE === 'all') && LEARNERS.length >= 2) {
      const [a, b] = LEARNERS, rs = Array.from({ length: NMIX }, (_, i) => run([spec(a, s), spec(b, s)], i)); mixed[`${pattern}:${a}-vs-${b}`] = { shareFirst: share(rs, a), bothAlive: mean(rs.map(r => +(Object.values(r.finalByType).every(v => v > 0)))) };
    }
    if (MODE === 'neutral' || MODE === 'all') {
      const a = LEARNERS[0], rs = Array.from({ length: NMIX }, (_, i) => run([spec(a, s, 'X'), spec(a, s, 'Y')], i)); mixed[`${pattern}:neutral-${a}`] = { shareFirst: share(rs, 'X'), bothAlive: mean(rs.map(r => +(Object.values(r.finalByType).every(v => v > 0)))) };
    }
  }
  return { seed: s, pure, mixed };
}

const seedFile = (s: number) => `${out}/seed-${s}.json`;
for (const s of SEEDS) { if (existsSync(seedFile(s))) { console.log(`seed ${s}: seed-${s}.json exists, skipped`); continue; } writeFileSync(seedFile(s), JSON.stringify(runSeed(s), null, 1)); }
if (!ALL_SEEDS.every(s => existsSync(seedFile(s)))) { console.log('not all seeds present yet; no analysis'); process.exit(0); }

// ---- 分析（正式与开发期共用）----
const data: SeedOut[] = ALL_SEEDS.map(s => JSON.parse(readFileSync(seedFile(s), 'utf8')));
const signFlipP = (d: number[], shift = 0) => { d = d.map(x => x - shift); const obs = mean(d), n = d.length; let ge = 0; for (let m = 0; m < 1 << n; m++) { let sm = 0; for (let i = 0; i < n; i++) sm += (m >> i & 1) ? -d[i] : d[i]; if (sm / n >= obs - 1e-12) ge++; } return ge / (1 << n); };
const per = (pattern: string, key: keyof Cell, f: (reg: number, pl: number) => number) => data.map(d => f(d.pure[pattern].regime[key], d.pure[pattern].plain[key]));
const T = { est: 0.08, popRel: 0.10, rec: 0.05, halfPop: -1.5 };
const hyps = !(data[0].pure.abab?.regime && data[0].pure.half?.regime) ? [] : [
  { id: 'H1', claim: `abab：regime 建立率 − plain ≥ +${T.est}`, d: per('abab', 'established', (a, b) => a - b), thr: T.est, shift: 0 },
  { id: 'H2', claim: `abab：regime 最后两阶段平均个体数相对 plain 的比例差 ≥ +${T.popRel * 100}%（分母 max(plain, 1)）`, d: per('abab', 'meanLast2', (a, b) => (a - b) / Math.max(b, 1)), thr: T.popRel, shift: 0 },
  { id: 'H3', claim: `abab：regime 恢复比 − plain ≥ +${T.rec}`, d: per('abab', 'recovery', (a, b) => a - b), thr: T.rec, shift: 0 },
  { id: 'H4', claim: `half：regime 最后两阶段平均个体数 − plain > ${T.halfPop}（非劣效）`, d: per('half', 'meanLast2', (a, b) => a - b), thr: T.halfPop, shift: T.halfPop },
].map(h => ({ ...h, stat: mean(h.d), p: signFlipP(h.d, h.shift) }));
const sorted = hyps.slice().sort((a, b) => a.p - b.p || a.id.localeCompare(b.id)), reject = new Map<string, boolean>(); let stop = false;
sorted.forEach((h, i) => { const r = !stop && h.p < 0.05 / (sorted.length - i); if (!r) stop = true; reject.set(h.id, r); });
const verdicts = hyps.map(h => { const eff = h.shift ? h.stat > h.thr : h.stat >= h.thr; return { id: h.id, claim: h.claim, statistic: r4(h.stat), threshold: h.thr, effectOk: eff, p: r4(h.p), holmReject: reject.get(h.id)!, supported: reject.get(h.id)! && eff, perSeed: h.d.map(r4) }; });
const mixedDesc = Object.fromEntries(Object.keys(data[0].mixed).map(k => [k, { seeds: ALL_SEEDS, shareFirstMean: data.map(d => r4(mean(d.mixed[k].shareFirst))), shareFirstAll: data.flatMap(d => d.mixed[k].shareFirst).map(r4), bothAlive: data.map(d => r4(d.mixed[k].bothAlive)) }]));
writeFileSync(`${out}/results.json`, JSON.stringify({ protocol: dev ? 'dev' : 'docs/PREREGISTRATION_19.md', dev, worldsPerCell: N, worldsPerMixedCell: NMIX, supply: SUPPLY, threshold: THR, init: INIT, pool: POOL, seeds: ALL_SEEDS, primary: verdicts, pure: Object.fromEntries(data.map(d => [d.seed, d.pure])), mixedDescriptive: mixedDesc }, null, 2));
if (verdicts.length) console.log(JSON.stringify(verdicts.map(v => ({ id: v.id, stat: v.statistic, thr: v.threshold, p: v.p, supported: v.supported }))));
else console.log('no hypothesis test (needs abab and half pure runs of plain and regime)');
