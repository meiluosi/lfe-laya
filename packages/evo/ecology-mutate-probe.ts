// G8b 小探针（开发期，协议 docs/G8B_PROBE.md）：基因组在繁殖时变异，纯种群，看后代基因是否朝某个方向系统性移动。
// 用法：node packages/evo/ecology-mutate-probe.ts run <输出目录> --seed 201 --learner plain [--worlds 24]   （每个进程跑一个（种子，类型），写 <种子>-<类型>.json）
//        node packages/evo/ecology-mutate-probe.ts analyze <输出目录>                                       （汇总并按协议判据读数）
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { runEcology, type Learner } from './ecology-run.ts';
import { registerPools, loadLayaPriors } from './pools.ts';

const [cmd, out] = process.argv.slice(2), args = process.argv.slice(4), opt = (n: string, d: string) => args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d;
const SIGMAS = [0, 0.15, 0.5], CREDIT_SCALE = 10, mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
if (cmd === 'run') {
  const seed = Number(opt('seed', '201')), learner = opt('learner', 'plain') as Learner, N = Number(opt('worlds', '24'));
  mkdirSync(out, { recursive: true }); registerPools(); const priors = loadLayaPriors('train');
  const genes: number[] = JSON.parse(readFileSync(`experiments/evo/dev-aba-laya-${learner}-${seed}/final.json`, 'utf8')).innate;
  const res: Record<string, unknown[]> = {};
  for (const sigma of SIGMAS) {
    res[sigma] = Array.from({ length: N }, (_, i) => {
      const r = runEcology({ seed: 800000 + i, pool: 'train', split: 'train', priors, pattern: 'abab', cue: 'off', supply: 20, threshold: 26, init: 16, types: [{ label: learner, learner, genes, prior: 'laya' }], mutation: { sigma, creditScale: CREDIT_SCALE } });
      const late = r.genomes!.filter(g => g.generation >= 2), sd = (i2: number) => sigma * (i2 === 8 ? CREDIT_SCALE : 1);
      const disp = sigma > 0 && late.length >= 5 ? genes.map((g0, k) => (mean(late.map(g => g.genes[k])) - g0) / sd(k)) : null;
      return { established: r.established, meanLast2: r.meanLast2, births: r.births, maxGeneration: r.maxGeneration, lateCount: late.length, disp };
    });
    console.log(`seed ${seed} ${learner} sigma ${sigma}`, JSON.stringify({ est: mean((res[sigma] as { established: boolean }[]).map(x => +x.established)), pop: +mean((res[sigma] as { meanLast2: number }[]).map(x => x.meanLast2)).toFixed(2) }));
  }
  writeFileSync(`${out}/${seed}-${learner}.json`, JSON.stringify({ seed, learner, worlds: N, sigmas: SIGMAS, genes, res }, null, 1));
} else if (cmd === 'analyze') {
  const cos = (a: number[], b: number[]) => { const d = a.reduce((s, x, i) => s + x * b[i], 0), na = Math.hypot(...a), nb = Math.hypot(...b); return na && nb ? d / (na * nb) : 0; };
  const pairMean = (vs: number[][]) => { let s = 0, n = 0; for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) { s += cos(vs[i], vs[j]); n++; } return n ? s / n : NaN; };
  let st = 12345; const rnd = () => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296; };
  const shuffle = (v: number[]) => { const a = v.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const rows: Record<string, unknown>[] = [];
  for (const f of readdirSync(out).filter(x => /^\d+-\w+\.json$/.test(x)).sort()) {
    const d = JSON.parse(readFileSync(`${out}/${f}`, 'utf8')) as { seed: number; learner: string; res: Record<string, { established: boolean; meanLast2: number; maxGeneration: number; lateCount: number; disp: number[] | null }[]> };
    const est0 = mean(d.res['0'].map(x => +x.established));
    for (const s of Object.keys(d.res)) {
      const w = d.res[s], vs = w.filter(x => x.disp).map(x => x.disp!), obs = vs.length >= 2 ? pairMean(vs) : NaN;
      const nullDist = vs.length >= 2 ? Array.from({ length: 200 }, () => pairMean(vs.map(shuffle))).sort((a, b) => a - b) : [], p95 = nullDist[Math.floor(nullDist.length * 0.95)] ?? NaN;
      const est = mean(w.map(x => +x.established));
      rows.push({ seed: d.seed, learner: d.learner, sigma: Number(s), established: +est.toFixed(3), feasible: est >= est0 - 0.10, meanLast2: +mean(w.map(x => x.meanLast2)).toFixed(2), maxGen: Math.max(...w.map(x => x.maxGeneration)), worldsWithLate: vs.length, directional: +obs.toFixed(3), nullP95: +p95.toFixed(3), aboveNull: obs > p95 });
    }
  }
  writeFileSync(`${out}/analysis.json`, JSON.stringify(rows, null, 1)); console.table(rows);
} else throw Error('Usage: run|analyze');
