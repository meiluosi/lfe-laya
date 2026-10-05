// 词池与 Laya 先验表（node 专用）：读取 packages/evo/pools/*.json 和 experiments/evo/laya-prior-v2/*.jsonl。
import { readFileSync, existsSync } from 'node:fs';
import { registerPool, type PoolEntryLike } from './semantic.ts';
import type { PoolEntry, Dialect } from './ontology.ts';
import { trainLexicon, genericLexiconScore, vaderLexiconScore } from './ontology.ts';

export type Priors = Map<string, number>;
export const loadPool = (dialect: Dialect): PoolEntry[] => JSON.parse(readFileSync(new URL(`./pools/${dialect}.json`, import.meta.url), 'utf8'));
/** 注册并返回池；名字 = 方言名 */
export function registerPools(): Record<Dialect, PoolEntry[]> { const out = { train: loadPool('train'), test: loadPool('test') }; for (const d of ['train', 'test'] as const) registerPool(d, out[d] as PoolEntryLike[]); return out; }
/** Laya 先验表（pEat，两个选项顺序平均）。尚未算完的条目缺失，缺失的在控制器里按“无语义”处理。 */
export function loadLayaPriors(dialect: Dialect): Priors {
  const path = new URL(`../../experiments/evo/laya-prior-v2/${dialect}.jsonl`, import.meta.url), m: Priors = new Map();
  if (existsSync(path)) for (const line of readFileSync(path, 'utf8').split('\n')) if (line) { const j = JSON.parse(line); m.set(j.text, j.pEat); }
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
