// 语义世界生成：每个世界随机抽取若干“食物种类”，描述是自然语言，真实影响（factor）只有模拟器知道。
// 训练与测试词汇不重叠，所以评估世界里的描述词对进化过程是全新的；nonsense 种类没有语义，只能靠一生内的经验学。
import type { SemanticKind } from '../sim/ecology.ts';
import { BASE, SCENARIOS } from './evaluate.ts';
import vocabulary from './semantic-vocab.json' with { type: 'json' };

const VOCAB = vocabulary as { nouns: Record<string, string[]>; good: Record<string, string[]>; bad: Record<string, string[]>; syllables: string[]; nonsenseSuffix: string[]; nonsenseNouns: string[] };
export type Split = 'train' | 'test';
/** 词池注册表：node 入口（脚本、worker）注册池后，世界选项里用名字引用。池里的隐藏属性只用于生成世界，不进入个体的输入。 */
export type PoolEntryLike = { text: string; factor: number; tier: string };
const POOLS = new Map<string, PoolEntryLike[]>();
export const registerPool = (name: string, entries: PoolEntryLike[]) => { POOLS.set(name, entries); };
export type SemanticOptions = { /** 延迟后果（模拟步数）；缺省为即时 */ delay?: number; /** 使用已注册的词池（生成式本体）而不是内置小词表；K 由 sensible 决定（nonsense 不再单独加） */ pool?: string; /** 池模式下是否限制危害：factor 下限（默认 -1，等 W4 放开后可设到 -4） */ harmCap?: number; split: Split; /** 漂移：每 everyTicks 切换阶段；fraction 是被反转的种类比例（按世界种子确定性选取） */ drift?: { everyTicks: number; fraction: number }; /** 常识线索被反转（描述与真实影响相反）的比例 */ inversion?: number; /** W7 成熟周期与季节（可选）：cues 为语言线索模式；phrases 选择阶段短语的措辞（A 训练用、B 评估用）；poolLimit 只用池的前 N 条（为了能预先缓存先验） */ ripening?: { seasonTicks: number; cues: 'language' | 'shuffled' | 'off'; phrases: 'A' | 'B'; poolLimit?: number }; sensible?: number; nonsense?: number };
export const DEFAULT_SEMANTIC: Required<Omit<SemanticOptions, 'split' | 'drift' | 'pool' | 'harmCap' | 'delay' | 'ripening'>> = { inversion: 0, sensible: 6, nonsense: 2 };

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
  if (opt.pool) return makeKindsFromPool(seed, opt);
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
/** W7 阶段短语与季节提示（作者撰写，写作时没有看过 Laya 的任何输出）。两套措辞：A 用于训练，B 用于评估，检验对换说法的泛化。阶段：0 青涩 1 成熟 2 过熟 3 腐败。 */
export const STAGE_PHRASES: Record<'A' | 'B', string[]> = {
  A: ['still green and hard', 'at the peak of ripeness', 'gone soft and sour', 'rotting where it lies'],
  B: ['not yet ripened, firm and pale', 'fully ripened and ready', 'past its prime and fermenting', 'spoiled and sunk into the soil'],
};
export const SEASON_CUES: Record<'A' | 'B', string[][]> = {
  A: [['buds are opening on the hedges', 'new shoots push up through the soil'], ['the days are long and the sun is high', 'the heat hangs over the fields'], ['the days are growing short and the leaves are turning', 'geese are flying south overhead'], ['frost lies on the ground each morning', 'the ponds have frozen over']],
  B: [['meltwater runs down the hillside', 'the first swallows return'], ['the nights are short and warm', 'the meadow hums with bees'], ['mist hangs in the valley at dawn', 'the harvest is being gathered in'], ['snow covers the high ground', 'the days are at their shortest']],
};
export const RIPENING_MULTIPLIERS = [.2, 1, -.4, -1];
export function makeRipening(seed: number, kinds: SemanticKind[], opt: NonNullable<SemanticOptions['ripening']>) {
  const r = rng(seed * 7919 + 3);
  return { seasonTicks: opt.seasonTicks, offsets: kinds.map(() => Math.floor(r() * 4)), perishable: kinds.map(k => k.factor > 0), multipliers: RIPENING_MULTIPLIERS.slice(), cues: opt.cues, stageText: STAGE_PHRASES[opt.phrases].slice(), seasonText: SEASON_CUES[opt.phrases].map(a => a.slice()) };
}
export const SEMANTIC_BASE = { diffusion: 0, deathReturn: 0 };
export function makeDrift(seed: number, kinds: SemanticKind[], drift: { everyTicks: number; fraction: number }): { everyTicks: number; flip: number[] } {
  const r = rng(seed * 40503 + 17), order = kinds.map((_, i) => i).sort(() => r() - .5), n = Math.max(1, Math.round(kinds.length * drift.fraction));
  return { everyTicks: drift.everyTicks, flip: order.slice(0, n).sort((a, b) => a - b) };
}
export const semanticConfig = (seed: number, opt: SemanticOptions) => { const kinds = makeKinds(seed, opt); return { ...SEMANTIC_BASE, semantic: { kinds, ...(opt.drift ? { drift: makeDrift(seed, kinds, opt.drift) } : {}), ...(opt.ripening ? { ripening: makeRipening(seed, kinds, opt.ripening) } : {}), ...(opt.delay ? { delay: { ticks: opt.delay } } : {}) } }; };

/** 观察台等界面用的完整语义世界配置（8 个个体、无繁殖；供给与训练场景一致）。 */
export const semanticPreset = (seed: number, opt: Partial<SemanticOptions> = {}) => ({ ...BASE, ...SCENARIOS.semantic, ...semanticConfig(seed, { split: 'test', inversion: 0, ...opt }), seed });

/** 从词池抽 K 种食物：一半营养、一半有毒（按层级自然分布），再按 inversion 概率把真实影响反转（描述与事实相反）。 */
function makeKindsFromPool(seed: number, opt: SemanticOptions): SemanticKind[] {
  const full = POOLS.get(opt.pool!); if (!full) throw Error(`pool_not_registered:${opt.pool}`);
  const pool = opt.ripening?.poolLimit ? full.slice(0, opt.ripening.poolLimit) : full;
  const o = { ...DEFAULT_SEMANTIC, ...opt }, r = rng(seed * 2654435761 + 99), K = o.sensible, cap = opt.harmCap ?? 1;
  const nutritive = pool.filter(e => e.factor > 0), toxic = pool.filter(e => e.factor < 0), kinds: SemanticKind[] = [], used = new Set<string>();
  for (let guard = 0; kinds.length < K && guard < K * 50; guard++) {
    const wantGood = kinds.length % 2 === 0, e = pick(r, wantGood ? nutritive : toxic); if (used.has(e.text)) continue; used.add(e.text);
    let factor = e.factor; if (r() < o.inversion) factor = factor > 0 ? -(r() < .5 ? .4 : 1) : .7;
    kinds.push({ description: e.text, factor: Math.max(-cap, factor) });
  }
  if (kinds.length < K) throw Error('pool_too_small');
  return kinds;
}
