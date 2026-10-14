// 词池与 Laya 先验表（node 专用）：读取 packages/evo/pools/*.json 和 experiments/evo/laya-prior-v2/*.jsonl。
import { readFileSync, existsSync } from 'node:fs';
import { registerPool, type PoolEntryLike } from './semantic.ts';
import type { PoolEntry, Dialect } from './ontology.ts';
import { trainLexicon, genericLexiconScore, vaderLexiconScore } from './ontology.ts';

export type Priors = Map<string, number>;
export const loadPoolFile = (name: string): PoolEntry[] => JSON.parse(readFileSync(new URL(`./pools/${name}.json`, import.meta.url), 'utf8'));
export const loadPool = (dialect: Dialect): PoolEntry[] => JSON.parse(readFileSync(new URL(`./pools/${dialect}.json`, import.meta.url), 'utf8'));
/** 注册并返回池；名字 = 方言名 */
export function registerPools(): Record<'train' | 'test', PoolEntry[]> & { heldout?: PoolEntry[]; factual?: PoolEntry[] } {
  const out: Record<'train' | 'test', PoolEntry[]> & { heldout?: PoolEntry[]; factual?: PoolEntry[] } = { train: loadPool('train'), test: loadPool('test') };
  for (const d of ['train', 'test'] as const) registerPool(d, out[d] as PoolEntryLike[]);
  if (existsSync(new URL('./pools/heldout.json', import.meta.url))) { out.heldout = loadPool('heldout'); registerPool('heldout', out.heldout as PoolEntryLike[]); }   // 留出池：只在预注册评估中使用
  if (existsSync(new URL('./pools/factual.json', import.meta.url))) { out.factual = loadPool('factual'); registerPool('factual', out.factual as PoolEntryLike[]); }   // W5 新方言（需要理解的事实线索）：只在预注册评估中使用
  if (existsSync(new URL('./pools/factual-train.json', import.meta.url))) registerPool('factual-train', loadPoolFile('factual-train') as PoolEntryLike[]);   // 事实方言训练池（预注册 08）
  return out;
}
/** Laya 先验表（pEat，两个选项顺序平均）。尚未算完的条目缺失，缺失的在控制器里按“无语义”处理。 */
export function loadLayaPriors(dialect: Dialect): Priors {
  const path = new URL(`../../experiments/evo/laya-prior-v2/${dialect}.jsonl`, import.meta.url), m: Priors = new Map();
  if (existsSync(path)) for (const line of readFileSync(path, 'utf8').split('\n')) if (line) { const j = JSON.parse(line); m.set(j.text, j.pEat); }
  return m;
}
/** Laya 编码器对描述的缓存向量（PCA 32 维、L2 归一化；只依赖文本）。W5b 层次信念用。 */
export function loadEmbeddings(dialect: Dialect): Map<string, Float32Array> {
  const path = new URL(`../../experiments/evo/laya-embed-v1/${dialect}.jsonl`, import.meta.url), m = new Map<string, Float32Array>();
  if (existsSync(path)) for (const line of readFileSync(path, 'utf8').split('\n')) if (line) { const j = JSON.parse(line); m.set(j.text, Float32Array.from(j.v)); }
  return m;
}
/** 以函数充当先验表（词典、打乱、加噪等对照）。get 返回 [0,1] 的“可以吃”概率。 */
export class FnPriors extends Map<string, number> { fn: (t: string) => number; constructor(fn: (t: string) => number) { super(); this.fn = fn; } override get(t: string) { return this.fn(t); } override has() { return true; } }
export const lexiconPrior = (lex: (t: string) => number): Priors => new FnPriors(t => (lex(t) + 1) / 2);
export const genericLexiconPrior = (): Priors => lexiconPrior(genericLexiconScore);   // 作者自写（可能与方言有重合词，仅作参考）
export const vaderPrior = (): Priors => lexiconPrior(vaderLexiconScore);               // 独立来源
export const trainedLexiconPrior = (pool: PoolEntry[]): Priors => lexiconPrior(trainLexicon(pool));
/** 打乱先验：把 Laya 对每条描述的判断随机配给另一条描述（保持边缘分布，破坏语义对应）。 */
export function shuffledPrior(priors: Priors, seed: number): Priors {
  const texts = [...priors.keys()], values = texts.map(t => priors.get(t)!); let s = seed >>> 0 || 1; const r = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = values.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [values[i], values[j]] = [values[j], values[i]]; }
  return new Map(texts.map((t, i) => [t, values[i]]));
}
/** 加噪先验：以概率 flip 把判断翻到另一侧，用于测先验错误率的敏感度。 */
export function noisyPrior(priors: Priors, flip: number, seed: number): Priors {
  let s = seed >>> 0 || 1; const r = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return new Map([...priors].map(([t, p]) => [t, r() < flip ? 1 - p : p]));
}
