// 语义世界的进化实验：2×2（Laya 先验 有/无 × 终身学习 开/关）。OpenAI-ES，对称采样，排名整形，Adam。
// 用法：node packages/evo/semantic-evolve.ts <新输出目录> --prior none|laya|oracle --learning on|off [--worlds N] [--generations N] [--pop N] [--seed N] [--workers N]
// 选择只依赖训练划分的适应度；测试划分（全新的描述词）每 10 代评估一次，仅用于报告。
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import { SEM_INNATE_SIZE } from './sempolicy.ts';
import { STRUCTURED_GENES } from './structured.ts';
import { HIER_GENES } from './structured-hier.ts';
import { SOCIAL_GENES } from './structured-social.ts';
import { HEAD_GENES, HEAD_DIM } from './structured-head.ts';
const POOLK = (() => { const i = process.argv.indexOf('--K'); return i >= 0 ? Number(process.argv[i + 1]) : 0; })();
import type { SemCondition } from './sempolicy.ts';
import type { SemanticSpec } from './semantic-run.ts';

const args = process.argv.slice(2), out = args[0]; if (!out) throw Error('Usage: node packages/evo/semantic-evolve.ts <dir> --prior none|laya|oracle --learning on|off [--worlds N]');
const str = (n: string, d: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; }, num = (n: string, d: number) => Number(str(n, String(d)));
const cond: SemCondition = { prior: str('prior', 'laya') as 'none' | 'laya' | 'oracle' | 'shuffled' | 'vader' | 'distilled', learning: str('learning', 'on') === 'on' };
const AGENT = str('agent', 'mlp') as 'mlp' | 'structured', DRIFT = str('drift', 'off') === 'on', POOL = str('pool', 'off') === 'on', HIER = str('hier', 'off') === 'on', INVS = str('inversions', '').split(',').filter(Boolean).map(Number), DELAY_ALL = str('delayAll', 'off') === 'on', TRAIN_POOL = str('trainPool', 'train'), HEAD = str('head', 'off') === 'on', WORLD_BASE = (str('worldSeeds', 'fixed') === 'vary' ? 50000 + num('seed', 1) * 100000 : 50000), SOC = str('social', 'off') === 'on', SOC_CUES = str('socialCues', 'language') as 'language' | 'shuffled' | 'off', RIPE = str('ripening', 'off') === 'on', CUES = str('cues', 'language') as 'language' | 'shuffled' | 'off', SEASON = num('seasonTicks', 200), RIPE_LIMIT = num('ripeLimit', 3000), HARM = num('harmCap', 1), DELAY = num('delay', 0), WORLDS = num('worlds', 3), GEN = num('generations', 60), POP = num('pop', 32), SIGMA = num('sigma', .15), LR = num('lr', .06), SEED = num('seed', 1), WORKERS = num('workers', Math.max(1, Math.min(6, cpus().length - 4)));
mkdirSync(out, { recursive: false }); mkdirSync(`${out}/source`);
const sources = ['packages/evo/structured.ts', 'packages/evo/pools.ts', 'packages/evo/ontology.ts', 'packages/evo/ontology/dialects.json', 'packages/evo/sempolicy.ts', 'packages/evo/semantic.ts', 'packages/evo/semantic-run.ts', 'packages/evo/semantic-worker.ts', 'packages/evo/semantic-evolve.ts', 'packages/evo/semantic-vocab.json', 'experiments/evo/laya-prior-v1.json', 'packages/sim/ecology.ts', 'packages/sim/controllers.ts'];
const sha: Record<string, string> = {}; for (const p of sources) { const b = readFileSync(p); sha[p] = createHash('sha256').update(b).digest('hex'); writeFileSync(`${out}/source/${p.replaceAll('/', '__')}`, b); }
const TEST: SemanticSpec[] = Array.from({ length: 12 }, (_, i) => ({ seed: 40000 + i, options: { split: 'test' as const, inversion: i % 2 ? .25 : 0, ...(POOL ? { pool: 'test', sensible: POOLK || 32, harmCap: HARM, ...(DELAY && i % 2 === 1 ? { delay: DELAY } : {}) } : {}) } }));
writeFileSync(`${out}/manifest.json`, JSON.stringify({ purpose: '语义世界：先天参数进化（2×2 对照之一）', condition: cond, generations: GEN, pop: POP, sigma: SIGMA, lr: LR, seed: SEED, agent: AGENT, hier: HIER, social: SOC, head: HEAD, worldBase: WORLD_BASE, socialCues: SOC_CUES, inversions: INVS, delayAll: DELAY_ALL, trainPool: TRAIN_POOL, ripening: RIPE, cues: CUES, seasonTicks: SEASON, ripeLimit: RIPE_LIMIT, drift: DRIFT, pool: POOL, K: POOLK, harmCap: HARM, delay: DELAY, innateSize: AGENT === 'structured' ? STRUCTURED_GENES : SEM_INNATE_SIZE,
  training: `每代 ${WORLDS} 个训练划分世界（种子 50000+gen*10+i，常识反转比例按 0 / 0 / 0.25 循环）`, report: '测试划分（全新描述词）12 个世界，种子 40000+，反转比例交替 0 / 0.25，仅报告', source: sha }, null, 2));
let rs = SEED >>> 0; const rand = () => { rs = (rs + 0x6D2B79F5) >>> 0; let t = rs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
type R = Record<string, number>;
const pool = Array.from({ length: WORKERS }, () => new Worker(new URL('./semantic-worker.ts', import.meta.url)));
let tid = 0; const pending = new Map<number, { resolve: (r: R) => void; reject: (e: Error) => void }>();
for (const w of pool) w.on('message', (m: { id: number; result?: R; error?: string }) => { const p = pending.get(m.id)!; pending.delete(m.id); m.error ? p.reject(Error(m.error)) : p.resolve(m.result!); });
const run = (tasks: { theta: number[]; specs: SemanticSpec[]; greedy?: boolean }[]) => Promise.all(tasks.map((t, i) => new Promise<R>((resolve, reject) => { const id = ++tid; pending.set(id, { resolve, reject }); pool[i % pool.length].postMessage({ id, cond, agent: AGENT, hier: HIER, social: SOC, head: HEAD, ...t }); })));
const D = AGENT === 'structured' ? (HIER ? HIER_GENES : SOC ? SOCIAL_GENES : HEAD ? HEAD_GENES : STRUCTURED_GENES) : SEM_INNATE_SIZE, theta = new Float64Array(D);
if (AGENT === 'structured') theta.set([Math.log(3), .3, -.3, .05, .02, 1, 0, .3, DELAY ? 50 : 0, ...(HIER ? [.5, .7] : SOC ? [1] : HEAD ? [...new Array(HEAD_DIM).fill(0), 0] : [])]); else { for (let i = 0; i < D - 3; i++) theta[i] = gauss() * .1; theta[D - 3] = 0; theta[D - 2] = Math.log(3); theta[D - 1] = .3; }
const SCALE = AGENT === 'structured' ? [1, 1, 1, 1, 1, 1, 1, 1, 50, ...(HIER ? [1, 1] : SOC ? [1] : HEAD ? [...new Array(HEAD_DIM).fill(4), 1] : [])] : new Array(D).fill(1);     // 各基因的自然尺度（延迟信用窗口以步数计，其余约为 0–1）
const toGenes = (z: ArrayLike<number>) => Array.from(z, (x, i) => x * SCALE[i]);
for (let i = 0; i < D; i++) theta[i] /= SCALE[i];
const m = new Float64Array(D), v = new Float64Array(D); let t = 0, started = Date.now();
const shape = (f: number[]) => { const o = f.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]), u = new Array<number>(f.length); o.forEach(([, i], r) => { u[i] = r / (f.length - 1) - .5; }); return u; };
const fmt = (r: R) => Object.fromEntries(Object.entries(r).map(([k, x]) => [k, +x.toFixed(4)]));
for (let g = 0; g < GEN; g++) {
  const specs: SemanticSpec[] = Array.from({ length: WORLDS }, (_, i) => ({ seed: WORLD_BASE + g * 10 + i, options: { split: 'train' as const, inversion: INVS.length ? INVS[i % INVS.length] : i % 3 === 2 ? .25 : 0, ...(DRIFT && i % 2 === 1 ? { drift: { everyTicks: 1200, fraction: .5 } } : {}), ...(POOL ? { pool: TRAIN_POOL, sensible: POOLK || 32, harmCap: HARM, ...(DELAY && (DELAY_ALL || i % 2 === 1) ? { delay: DELAY } : {}), ...(SOC ? { social: { cues: SOC_CUES, phrases: 'A' as const } } : {}), ...(RIPE ? { ripening: { seasonTicks: SEASON, cues: CUES, phrases: 'A' as const, poolLimit: RIPE_LIMIT } } : {}) } : {}) } }));
  const eps: Float64Array[] = [], cand: number[][] = [];
  for (let k = 0; k < POP / 2; k++) { const e = new Float64Array(D).map(() => gauss()); eps.push(e); cand.push(toGenes(Array.from(theta, (x, i) => x + SIGMA * e[i])), toGenes(Array.from(theta, (x, i) => x - SIGMA * e[i]))); }
  const results = await run(cand.map(c => ({ theta: c, specs }))), fit = results.map(r => r.fitness), u = shape(fit), grad = new Float64Array(D);
  for (let k = 0; k < POP / 2; k++) { const w = u[2 * k] - u[2 * k + 1]; for (let i = 0; i < D; i++) grad[i] += w * eps[k][i]; }
  t++; for (let i = 0; i < D; i++) { const gi = grad[i] / (POP * SIGMA); m[i] = .9 * m[i] + .1 * gi; v[i] = .999 * v[i] + .001 * gi * gi; theta[i] += LR * (m[i] / (1 - .9 ** t)) / (Math.sqrt(v[i] / (1 - .999 ** t)) + 1e-8); }
  const row: Record<string, unknown> = { generation: g, meanFitness: +(fit.reduce((a, b) => a + b, 0) / POP).toFixed(4), bestFitness: +Math.max(...fit).toFixed(4), ...(AGENT === 'structured' ? { genes: toGenes(theta).map(x => +x.toFixed(3)) } : { trust: +Math.exp(theta[D - 2]).toFixed(3), temperature: +Math.exp(theta[D - 3]).toFixed(3), curiosity: +Math.max(0, Math.min(1.5, theta[D - 1])).toFixed(3) }), elapsedSeconds: Math.round((Date.now() - started) / 1000) };
  if ((g + 1) % 10 === 0 || g === GEN - 1) {
    const [s, gr] = await run([{ theta: toGenes(theta), specs: TEST }, { theta: toGenes(theta), specs: TEST, greedy: true }]); row.testSampled = fmt(s); row.testGreedy = fmt(gr);
    writeFileSync(`${out}/theta-gen${String(g + 1).padStart(4, '0')}.json`, JSON.stringify({ generation: g + 1, condition: cond, innate: toGenes(theta) }));
  }
  appendFileSync(`${out}/generations.jsonl`, JSON.stringify(row) + '\n'); console.log(JSON.stringify(row));
}
writeFileSync(`${out}/final.json`, JSON.stringify({ condition: cond, innate: toGenes(theta), note: '先天参数；后天信念为空。测试划分评估见 generations.jsonl，不是留出实验。' }));
for (const w of pool) w.terminate();
