// 进化策略（OpenAI-ES，对称采样 + 排名适应度整形 + Adam）：在进程内并行评估先天参数。
// 用法：node packages/evo/evolve.ts <新输出目录> [--generations N] [--pop N] [--sigma S] [--lr L] [--seed N] [--workers N]
// 选择只依赖训练种子上的适应度；开发种子的评估只用于报告，不参与选择。
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import { INNATE_SIZE } from './policy.ts';
import { evaluate, ruleController, randomController, type EvalResult, type WorldSpec } from './evaluate.ts';

const args = process.argv.slice(2), out = args[0];
if (!out) throw Error('Usage: node packages/evo/evolve.ts <new-output-directory> [options]');
const opt = (name: string, d: number) => { const i = args.indexOf(`--${name}`); return i >= 0 ? Number(args[i + 1]) : d; };
const GEN = opt('generations', 100), POP = opt('pop', 32), SIGMA = opt('sigma', 0.15), LR = opt('lr', 0.06), SEED = opt('seed', 1), WORKERS = opt('workers', Math.max(1, Math.min(6, cpus().length - 4)));
if (POP % 2) throw Error('pop_must_be_even');
mkdirSync(out, { recursive: false }); mkdirSync(`${out}/source`);
const sources = ['packages/evo/features.ts', 'packages/evo/policy.ts', 'packages/evo/evaluate.ts', 'packages/evo/evolve.ts', 'packages/evo/worker.ts', 'packages/sim/ecology.ts', 'packages/sim/controllers.ts', 'packages/protocol/ecology.ts'];
const sha: Record<string, string> = {}; for (const p of sources) { const b = readFileSync(p); sha[p] = createHash('sha256').update(b).digest('hex'); writeFileSync(`${out}/source/${p.replaceAll('/', '__')}`, b); }
const DEV: WorldSpec[] = [211, 223, 227, 229, 233].flatMap(seed => [{ scenario: 'moderate' as const, seed }, { scenario: 'scarce' as const, seed }]);
writeFileSync(`${out}/manifest.json`, JSON.stringify({ purpose: '进化先天参数（无 Laya 感知）；开发评估用 difficulty-v2 的种子，仅报告', generations: GEN, pop: POP, sigma: SIGMA, lr: LR, seed: SEED, workers: WORKERS, innateSize: INNATE_SIZE,
  trainingSeeds: '20000 + generation*10 + index（每代共同随机数）', trainingWorldsPerGenome: '1 moderate + 2 scarce', devSeeds: DEV, source: sha }, null, 2));

// 可复现随机数（mulberry32 + Box-Muller）
let rngState = SEED >>> 0; const rand = () => { rngState = (rngState + 0x6D2B79F5) >>> 0; let t = rngState; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

const pool: Worker[] = Array.from({ length: WORKERS }, () => new Worker(new URL('./worker.ts', import.meta.url)));
let taskId = 0; const pending = new Map<number, { resolve: (r: EvalResult) => void; reject: (e: Error) => void }>();
for (const w of pool) w.on('message', (m: { id: number; result?: EvalResult; error?: string }) => { const p = pending.get(m.id)!; pending.delete(m.id); m.error ? p.reject(Error(m.error)) : p.resolve(m.result!); });
const run = (tasks: { theta: number[]; specs: WorldSpec[]; greedy?: boolean }[]): Promise<EvalResult[]> => Promise.all(tasks.map((t, i) => new Promise<EvalResult>((resolve, reject) => { const id = ++taskId; pending.set(id, { resolve, reject }); pool[i % pool.length].postMessage({ id, ...t }); })));

const D = INNATE_SIZE; const theta = new Float64Array(D); for (let i = 0; i < D - 1; i++) theta[i] = gauss() * 0.1; theta[D - 1] = 0;
const m = new Float64Array(D), v = new Float64Array(D); let t = 0;
const rankShape = (f: number[]) => { const order = f.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]), u = new Array(f.length); order.forEach(([, i], r) => { u[i] = r / (f.length - 1) - 0.5; }); return u as number[]; };
const fmt = (r: EvalResult) => Object.fromEntries(Object.entries(r).map(([k, x]) => [k, +x.toFixed(4)]));

const baselines = { rule: evaluate(ruleController, DEV), random: evaluate(randomController, DEV) };
appendFileSync(`${out}/generations.jsonl`, JSON.stringify({ baselinesOnDevSet: { rule: fmt(baselines.rule), random: fmt(baselines.random) } }) + '\n'); console.log('baselines(dev)', JSON.stringify({ rule: fmt(baselines.rule), random: fmt(baselines.random) }));
const started = Date.now();
for (let g = 0; g < GEN; g++) {
  const specs: WorldSpec[] = [{ scenario: 'moderate', seed: 20000 + g * 10 }, { scenario: 'scarce', seed: 20001 + g * 10 }, { scenario: 'scarce', seed: 20002 + g * 10 }];
  const eps: Float64Array[] = []; const cand: number[][] = [];
  for (let k = 0; k < POP / 2; k++) { const e = new Float64Array(D).map(() => gauss()); eps.push(e); cand.push(Array.from(theta, (x, i) => x + SIGMA * e[i]), Array.from(theta, (x, i) => x - SIGMA * e[i])); }
  const results = await run(cand.map(c => ({ theta: c, specs }))), fit = results.map(r => r.fitness), u = rankShape(fit);
  const grad = new Float64Array(D); for (let k = 0; k < POP / 2; k++) { const w = u[2 * k] - u[2 * k + 1]; for (let i = 0; i < D; i++) grad[i] += w * eps[k][i]; }
  t++; for (let i = 0; i < D; i++) { const gi = grad[i] / (POP * SIGMA); m[i] = 0.9 * m[i] + 0.1 * gi; v[i] = 0.999 * v[i] + 0.001 * gi * gi; theta[i] += LR * (m[i] / (1 - 0.9 ** t)) / (Math.sqrt(v[i] / (1 - 0.999 ** t)) + 1e-8); }
  const row: Record<string, unknown> = { generation: g, meanFitness: +(fit.reduce((a, b) => a + b, 0) / POP).toFixed(4), bestFitness: +Math.max(...fit).toFixed(4), meanSurvival: +(results.reduce((a, r) => a + r.survival, 0) / POP).toFixed(4), elapsedSeconds: Math.round((Date.now() - started) / 1000) };
  if ((g + 1) % 10 === 0 || g === GEN - 1) {
    const [sampled, greedy] = await run([{ theta: Array.from(theta), specs: DEV }, { theta: Array.from(theta), specs: DEV, greedy: true }]);
    row.devSampled = fmt(sampled); row.devGreedy = fmt(greedy);
    writeFileSync(`${out}/theta-gen${String(g + 1).padStart(4, '0')}.json`, JSON.stringify({ generation: g + 1, innate: Array.from(theta) }));
  }
  appendFileSync(`${out}/generations.jsonl`, JSON.stringify(row) + '\n'); console.log(JSON.stringify(row));
}
writeFileSync(`${out}/final.json`, JSON.stringify({ innate: Array.from(theta), note: '先天参数；后天参数为空。开发集评估见 generations.jsonl，不是留出结果。' }));
for (const w of pool) w.terminate();
