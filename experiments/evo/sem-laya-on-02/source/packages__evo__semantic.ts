// 语义世界生成：每个世界随机抽取若干“食物种类”，描述是自然语言，真实影响（factor）只有模拟器知道。
// 训练与测试词汇不重叠，所以评估世界里的描述词对进化过程是全新的；nonsense 种类没有语义，只能靠一生内的经验学。
import type { SemanticKind } from '../sim/ecology.ts';
import { BASE, SCENARIOS } from './evaluate.ts';
import vocabulary from './semantic-vocab.json' with { type: 'json' };

const VOCAB = vocabulary as { nouns: Record<string, string[]>; good: Record<string, string[]>; bad: Record<string, string[]>; syllables: string[]; nonsenseSuffix: string[]; nonsenseNouns: string[] };
export type Split = 'train' | 'test';
export type SemanticOptions = { split: Split; /** 常识线索被反转（描述与真实影响相反）的比例 */ inversion?: number; sensible?: number; nonsense?: number };
export const DEFAULT_SEMANTIC: Required<Omit<SemanticOptions, 'split'>> = { inversion: 0, sensible: 6, nonsense: 2 };

function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = <T>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)];

/** 固定的无语义描述词池（40 个）：有限，才能预先让 Laya 给出先验并缓存。 */
export const NONSENSE_POOL: string[] = (() => {
  const r = rng(424242), out = new Set<string>(); const w = () => pick(r, VOCAB.syllables as string[]) + pick(r, VOCAB.syllables as string[]);
  while (out.size < 40) out.add(`${w()} ${w()}-${pick(r, VOCAB.nonsenseSuffix)} ${pick(r, VOCAB.nonsenseNouns)}`);
  return [...out];
})();
/** 该世界的食物种类。同一 (seed, options) 总是得到同一结果。 */
export function makeKinds(seed: number, opt: SemanticOptions): SemanticKind[] {
  const o = { ...DEFAULT_SEMANTIC, ...opt }, r = rng(seed * 2654435761), kinds: SemanticKind[] = [], used = new Set<string>();
  const add = (description: string, factor: number) => { if (!used.has(description)) { used.add(description); kinds.push({ description, factor }); } };
  for (let i = 0; kinds.length < o.sensible && i < 500; i++) {
    const good = i % 2 === 0, phrase = pick(r, VOCAB[good ? 'good' : 'bad'][o.split]), noun = pick(r, VOCAB.nouns[o.split]);
    const flipped = r() < o.inversion;
    add(`${phrase} ${noun}`, (good !== flipped) ? 1 : -1);
  }
  for (let i = 0; kinds.length < o.sensible + o.nonsense && i < 500; i++) add(pick(r, NONSENSE_POOL), r() < .5 ? 1 : -1);
  return kinds;
}
/** 所有可能出现的描述词（供 Laya 先验表预先计算）。nonsense 的全集：双音节对 × 对 × 后缀 × 名词。 */
export function allDescriptors(): { text: string; split: Split | 'nonsense' }[] {
  const out: { text: string; split: Split | 'nonsense' }[] = [];
  for (const split of ['train', 'test'] as const) for (const kind of ['good', 'bad'] as const) for (const p of VOCAB[kind][split]) for (const n of VOCAB.nouns[split]) out.push({ text: `${p} ${n}`, split });
  for (const text of NONSENSE_POOL) out.push({ text, split: 'nonsense' });
  return out;
}
export const SEMANTIC_BASE = { diffusion: 0, deathReturn: 0 };
export const semanticConfig = (seed: number, opt: SemanticOptions) => ({ ...SEMANTIC_BASE, semantic: { kinds: makeKinds(seed, opt) } });

/** 观察台等界面用的完整语义世界配置（8 个个体、无繁殖；供给与训练场景一致）。 */
export const semanticPreset = (seed: number, opt: Partial<SemanticOptions> = {}) => ({ ...BASE, ...SCENARIOS.semantic, ...semanticConfig(seed, { split: 'test', inversion: 0, ...opt }), seed });
