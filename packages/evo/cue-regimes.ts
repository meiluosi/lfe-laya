// G13：线索可靠度的“制度”。训练（进化史）与评估共用：每个世界的每条线索通道各自抽一个制度，个体事先不知道。
//  reliable = 总是正确；noisy = 30% 的阶段显示另一个状态的句子；uninformative = 50%（两个状态下等于与状态无关）；absent = 整个世界没有这条通道。
export const REGIMES = [{ name: 'reliable', missing: 0, wrong: 0 }, { name: 'noisy', missing: 0, wrong: .3 }, { name: 'uninformative', missing: 0, wrong: .5 }, { name: 'absent', missing: 1, wrong: 0 }] as const;
export type RegimeName = typeof REGIMES[number]['name'];
const hash = (seed: number, tag: string) => { let x = 2166136261 ^ seed; for (const ch of tag) x = Math.imul(x ^ ch.charCodeAt(0), 16777619); x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; return x >>> 0; };
/** 由世界种子抽取两条通道的制度（训练用：均匀、互相独立） */
export const drawRegimes = (worldSeed: number): [RegimeName, RegimeName] => [REGIMES[hash(worldSeed, 'ch1') % 4].name, REGIMES[hash(worldSeed, 'ch2') % 4].name];
/** 把制度写成世界的线索选项（cueFlaw 作用于第一通道，cue2 是第二通道，第二通道用 LLM 措辞库）。‘clean’ 训练 = 总是 reliable。 */
export function cueOptions(ch1: RegimeName | { missing: number; wrong: number }, ch2: RegimeName | { missing: number; wrong: number } | null) {
  const f = (r: RegimeName | { missing: number; wrong: number }) => typeof r === 'string' ? (({ missing, wrong }) => ({ missing, wrong }))(REGIMES.find(x => x.name === r)!) : r;
  return { cueFlaw: f(ch1), ...(ch2 ? { cue2: { bank: 'llm' as const, flaw: f(ch2) } } : {}) };
}
