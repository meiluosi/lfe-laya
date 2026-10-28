// G8 评估：纯种群并排（同一世界种子，只换类型）、混合种群、中性对照。分析单位 = 训练种子（每个种子的基因组在若干世界里取均值）。
// 本文件是 S2 的评估框架；正式的假设与阈值在 S4 的预注册冻结后再加（届时加 --prereg 与基因组哈希校验）。目前只有开发期摘要（不做假设检验）。
// 用法：node packages/evo/ecology-eval.ts <新输出目录> --dev --seeds 201,202 --worlds 6 --dirs plain=experiments/evo/dev-aba-laya-plain,regime=experiments/evo/dev-aba-laya-regime
//        [--mode pure|mixed|neutral|all] [--pattern abab] [--supply 20 --threshold 26 --init 16] [--pool train --split train]
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { runEcology, type TypeSpec, type EcologyResult, type Learner } from './ecology-run.ts';
import { registerPools, loadLayaPriors } from './pools.ts';

const args = process.argv.slice(2), out = args[0]; if (!out) throw Error('Usage: node packages/evo/ecology-eval.ts <new-output-directory> --dev ...');
const opt = (n: string, d: string) => args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d;
if (!args.includes('--dev')) throw Error('only --dev is available until the G8 preregistration is frozen (S4)');
const SEEDS = opt('seeds', '201,202').split(',').map(Number), N = Number(opt('worlds', '6')), MODE = opt('mode', 'all'), PATTERN = opt('pattern', 'abab') as 'aba' | 'abab' | 'long' | 'half';
const SUPPLY = Number(opt('supply', '20')), THR = Number(opt('threshold', '26')), INIT = Number(opt('init', '16')), POOL = opt('pool', 'train'), SPLIT = opt('split', 'train') as 'train' | 'test';
const DIRS = Object.fromEntries(opt('dirs', 'plain=experiments/evo/dev-aba-laya-plain,regime=experiments/evo/dev-aba-laya-regime').split(',').map(x => x.split('=')));
const LEARNERS = Object.keys(DIRS) as Learner[], base = SPLIT === 'train' ? 800000 : 900000;
mkdirSync(out, { recursive: false }); registerPools(); const priors = loadLayaPriors(POOL === 'train' ? 'train' : POOL as 'test');
const genes = (l: string, s: number): number[] => JSON.parse(readFileSync(`${DIRS[l]}-${s}/final.json`, 'utf8')).innate;
const spec = (l: string, s: number, label = l): TypeSpec => ({ label, learner: l as Learner, genes: genes(l, s), prior: 'laya' });
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const summarize = (rs: EcologyResult[]) => ({ established: mean(rs.map(r => +r.established)), births: mean(rs.map(r => r.births)), meanLast2: mean(rs.map(r => r.meanLast2)), recovery: mean(rs.map(r => r.recovery)), extinct: mean(rs.map(r => +(r.extinctAt >= 0))) });
const cells: Record<string, Record<string, ReturnType<typeof summarize>>> = {}, mixed: Record<string, { shareFirst: number[]; bothAlive: number }> = {};
const worldSeed = (i: number) => base + i;
for (const s of SEEDS) {
  const run = (types: TypeSpec[], i: number) => runEcology({ seed: worldSeed(i), pool: POOL, split: SPLIT, priors, pattern: PATTERN, cue: 'off', supply: SUPPLY, threshold: THR, init: INIT, types });
  if (MODE === 'pure' || MODE === 'all') {
    cells[s] = {}; for (const l of LEARNERS) cells[s][l] = summarize(Array.from({ length: N }, (_, i) => run([spec(l, s)], i)));
    console.log(`seed ${s} pure`, JSON.stringify(Object.fromEntries(Object.entries(cells[s]).map(([l, c]) => [l, { est: c.established, pop: +c.meanLast2.toFixed(1), rec: +c.recovery.toFixed(2) }]))));
  }
  const share = (rs: EcologyResult[], a: string) => rs.filter(r => r.finalLiving > 0).map(r => r.finalByType[a] / r.finalLiving);
  if ((MODE === 'mixed' || MODE === 'all') && LEARNERS.length >= 2) {
    const [a, b] = LEARNERS, rs = Array.from({ length: N }, (_, i) => run([spec(a, s), spec(b, s)], i)); mixed[`${s}:${a}-vs-${b}`] = { shareFirst: share(rs, a), bothAlive: mean(rs.map(r => +(Object.values(r.finalByType).every(v => v > 0)))) };
  }
  if (MODE === 'neutral' || MODE === 'all') {
    const a = LEARNERS[0], rs = Array.from({ length: N }, (_, i) => run([spec(a, s, 'X'), spec(a, s, 'Y')], i)); mixed[`${s}:neutral-${a}`] = { shareFirst: share(rs, 'X'), bothAlive: mean(rs.map(r => +(Object.values(r.finalByType).every(v => v > 0)))) };
  }
}
writeFileSync(`${out}/results.json`, JSON.stringify({ protocol: 'dev (G8 S2)', pattern: PATTERN, supply: SUPPLY, threshold: THR, init: INIT, worlds: N, seeds: SEEDS, pure: cells, mixed }, null, 1));
for (const [k, v] of Object.entries(mixed)) console.log(k, 'shareFirst', v.shareFirst.map(x => +x.toFixed(2)).join(','), 'bothAlive', v.bothAlive);
