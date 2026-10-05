// 生成式本体：食物先有隐藏属性（营养 / 毒性层级），描述由随机文本生成器从属性产生，线索以概率 rho0 与属性一致。
// 生成器、词表和模板独立于任何模型输出（不根据 Laya 的反应调整）；训练与测试用两套互不相交的“方言”。
import dialects from './ontology/dialects.json' with { type: 'json' };
import vader from './ontology/vader-lexicon.json' with { type: 'json' };

export type Dialect = 'train' | 'test' | 'heldout' | 'factual';
export type Tier = 'nutritive' | 'mild' | 'strong' | 'lethal';
/** 池中的一条：描述 + 隐藏属性（只供世界生成和度量使用，永远不进入个体的输入）。 */
export type PoolEntry = { text: string; dialect: Dialect; tier: Tier; factor: number; cuePolarity: number; clauses: number };
type Field = 'look' | 'smell' | 'feel' | 'place' | 'signs';
type DialectSpec = { categories: string[]; clauses: Record<Field, { pos: string[]; neg: string[]; neu: string[] }>; negations: { pos: string[]; neg: string[] }; templates: { '2': string[]; '3': string[] } };
const SPEC = dialects as unknown as { fields: Field[]; train: DialectSpec; test: DialectSpec; heldout: DialectSpec; factual: DialectSpec };

export const TIER_FACTOR: Record<Tier, number> = { nutritive: 1, mild: -0.4, strong: -1, lethal: -4 };
function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = <T>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)];
const shuffle = <T>(r: () => number, xs: T[]): T[] => xs.map(x => [r(), x] as const).sort((a, b) => a[0] - b[0]).map(x => x[1]);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * 生成一条带隐藏属性的描述。
 * rho0：每条线索与真实属性一致的概率（否则是误导线索）；uninformative：线索被换成无信息短语的概率。
 */
export function generateEntry(r: () => number, dialect: Dialect, opt: { rho0?: number; uninformative?: number; toxicShare?: number; lethalShare?: number } = {}): PoolEntry {
  const rho0 = opt.rho0 ?? .9, uninformative = opt.uninformative ?? .2, spec = SPEC[dialect];
  const toxic = r() < (opt.toxicShare ?? .5), u = r(), tier: Tier = !toxic ? 'nutritive' : u < (opt.lethalShare ?? .15) ? 'lethal' : u < .55 ? 'strong' : 'mild';
  const n = r() < .4 ? 3 : 2, fields = shuffle(r, SPEC.fields).slice(0, n), parts: string[] = []; let polarity = 0;
  for (const f of fields) {
    const bank = spec.clauses[f];
    if (r() < uninformative) { parts.push(pick(r, bank.neu)); continue; }
    const consistent = r() < rho0, pos = toxic ? !consistent : consistent;   // pos=线索指向“可以吃”
    // 测试方言偶尔用否定句表达（词典难以理解）
    if (dialect !== 'train' && spec.negations.pos.length && r() < .25) parts.push(pick(r, pos ? spec.negations.pos : spec.negations.neg)); else parts.push(pick(r, pos ? bank.pos : bank.neg));
    polarity += pos ? 1 : -1;
  }
  const cat = pick(r, spec.categories), template = pick(r, spec.templates[n === 3 ? '3' : '2']), fill = (t: string) => t.replace('{cat}', cat).replace('{Cat}', cap(cat)).replace(/\{c(\d)\}/g, (_, i) => parts[+i - 1] ?? '').replace(/\{C(\d)\}/g, (_, i) => cap(parts[+i - 1] ?? ''));
  const text = fill(template);
  return { text: text.replace(/\s+/g, ' ').trim(), dialect, tier, factor: TIER_FACTOR[tier], cuePolarity: polarity, clauses: n };
}
/** 池：n 条互不相同的描述。同一 (dialect, n, seed) 总是得到同一池。 */
export function generatePool(dialect: Dialect, n: number, seed: number, opt: Parameters<typeof generateEntry>[2] = {}): PoolEntry[] {
  const r = rng(seed * 2654435761 + (dialect === 'test' ? 7 : dialect === 'heldout' ? 11 : dialect === 'factual' ? 13 : 3)), seen = new Set<string>(), out: PoolEntry[] = [];
  for (let guard = 0; out.length < n && guard < n * 40; guard++) { const e = generateEntry(r, dialect, opt); if (!seen.has(e.text) && e.text.length <= 240 && /^[ -~]+$/.test(e.text)) { seen.add(e.text); out.push(e); } }
  if (out.length < n) throw Error('pool_exhausted');
  return out;
}

// ---- 词典基线（用于闸门 G5：Laya 是否比一个简单的情感词典强）----
const GENERIC_POS = 'good great fresh sweet ripe healthy clean wholesome fragrant pleasant tender juicy plump bright firm crisp warm rich smooth delicious nourishing safe pure gentle lovely soft golden creamy happy feasting eagerly fine nice'.split(' ');
const GENERIC_NEG = 'bad rotten foul spoiled stench reeking putrid moldy mold slimy sour rancid decay decayed dead dying toxic poisonous sickly bitter acrid slime filth carrion maggots flies gnats withered shriveled mushy sticky clammy stained festering rotting nasty vile avoid avoids unwell twitching'.split(' ');
const tokens = (s: string) => s.toLowerCase().match(/[a-z']+/g) ?? [];
/** 通用情感词典：不知道方言，只数褒贬词（简单否定翻转）。返回 [-1,1] 的“可以吃”分数。 */
export function genericLexiconScore(text: string): number {
  const t = tokens(text); let s = 0;
  for (let i = 0; i < t.length; i++) { const neg = i > 0 && ['not', 'no', 'never', 'hardly', 'far', 'nothing'].includes(t[i - 1]); const v = GENERIC_POS.includes(t[i]) ? 1 : GENERIC_NEG.includes(t[i]) ? -1 : 0; s += neg ? -v : v; }
  return Math.tanh(s / 2);
}
/** 在训练方言池上学到的朴素贝叶斯词典；对测试方言基本只剩共享的功能词与少量通用词。 */
export function trainLexicon(pool: PoolEntry[]): (text: string) => number {
  const pos = new Map<string, number>(), neg = new Map<string, number>(); let np = 1, nn = 1;
  for (const e of pool) { const good = e.factor > 0, m = good ? pos : neg; for (const w of new Set(tokens(e.text))) m.set(w, (m.get(w) ?? 0) + 1); if (good) np++; else nn++; }
  return text => { let s = 0; for (const w of new Set(tokens(text))) s += Math.log(((pos.get(w) ?? 0) + 1) / np) - Math.log(((neg.get(w) ?? 0) + 1) / nn); return Math.tanh(s / 4); };
}

/** 独立来源的标准情感词表（VADER，MIT）：不是为本项目方言写的，用于 G5 基线。否定：前 3 个词内出现否定词则取反并乘 0.74（沿用 VADER 的做法）。 */
const VALENCE = (vader as { valence: Record<string, number> }).valence, NEGATORS = new Set(['not', 'no', 'never', 'none', 'nothing', 'hardly', 'barely', 'without', 'neither', 'nor', "isn't", "wasn't", "don't", "doesn't", "didn't", "can't", "couldn't", "won't", 'far']);
export function vaderLexiconScore(text: string): number {
  const t = tokens(text); let s = 0;
  for (let i = 0; i < t.length; i++) { const v = VALENCE[t[i]]; if (v === undefined) continue; const negated = [1, 2, 3].some(k => i - k >= 0 && NEGATORS.has(t[i - k])); s += negated ? -0.74 * v : v; }
  return Math.tanh(s / 4);
}
