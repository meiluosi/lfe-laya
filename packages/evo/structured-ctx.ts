// 主线 S2：带上下文记忆的学习器（回归初心，docs/RETURN_TO_ORIGIN.md）。两种候选，都只处理即时反馈的世界（信用窗口基因被忽略），
// 结构与 v2 相同（规则骨架 + 对先验的校准 + 否决阈值），只改“信念怎样随经历被保存与选用”。隐藏真值从不进入。
//  dual（快慢两套信念）：每个描述词同时有一套快速遗忘和一套慢速遗忘的信念；个体维护两套信念对新经历的预测误差的滑动平均，
//    用误差之差的 sigmoid 在二者之间加权（锐度 sharp）。额外基因：fast∈[.02,.6]、slow∈[0,.05]、rate∈[.05,.5]、sharp∈[0,12]。
//  regime（环境分段记忆）：个体保存最多 4 套“环境”信念表；每个新经历后，各套表对该经历的预测误差更新滑动平均；
//    当前套的误差明显高于另一套（超过 margin）则切换；所有套的误差都高于 theta 且还有空位则新开一套（空表，仅有先验）。
//    返回旧环境时，旧表能把预测做对，于是切回并恢复已有的知识。额外基因：theta∈[.15,1.2]、rate∈[.05,.5]、margin∈[0,.3]。
import { ruleProposal } from '../sim/controllers.ts';
import type { Proposal, Request } from '../protocol/ecology.ts';
import { filterRequest } from './filter.ts';
import type { Priors } from './semantic-run.ts';
import { NONSENSE_DEFAULT_V0 } from './sempolicy.ts';
import { decodeGenes as decodeBase, STRUCTURED_GENES as BASE_GENES, updateBelief, type StructuredPrior as Prior } from './structured.ts';

//  latent（潜在原因推断，对照学习器，G10）：同样至多 4 张环境信念表，但“用哪张表”由粘性中餐馆过程（sticky CRP）的近似后验决定，而不是误差阈值：
//    每张表 k 的先验权重 = 近期（衰减 ρ）分配到它的经历数 + κ·[k 是当前表]，新表的先验权重 = α（还有空位时）；似然 = 高斯，方差 σ²（以该表对这次经历的预测为均值）；新环境的预测较宽（σ=1，均值为先验）；
//    对数后验带衰减 ρ 地累计，取最大者（MAP）为当前表，若是新表则新开。额外基因：alpha∈[.05,3]、kappa∈[0,20]、noise∈[.1,1]、decay∈[.5,.99]。
//    这是对 Gershman 等“上下文即潜在原因”思路的简化在线近似，不是其完整模型。
export const DUAL_GENES = BASE_GENES + 4, REGIME_GENES = BASE_GENES + 3, LATENT_GENES = BASE_GENES + 4, MAX_REGIMES = 4;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
export const decodeDualGenes = (g: ArrayLike<number>) => {
  if (g.length !== DUAL_GENES) throw Error('genome_size');
  return { ...decodeBase(Array.from(g).slice(0, BASE_GENES)), fast: clamp(g[BASE_GENES], .02, .6), slow: clamp(g[BASE_GENES + 1], 0, .05), rate: clamp(g[BASE_GENES + 2], .05, .5), sharp: clamp(g[BASE_GENES + 3], 0, 12) };
};
export const decodeRegimeGenes = (g: ArrayLike<number>) => {
  if (g.length !== REGIME_GENES) throw Error('genome_size');
  return { ...decodeBase(Array.from(g).slice(0, BASE_GENES)), theta: clamp(g[BASE_GENES], .15, 1.2), rate: clamp(g[BASE_GENES + 1], .05, .5), margin: clamp(g[BASE_GENES + 2], 0, .3) };
};
export const decodeLatentGenes = (g: ArrayLike<number>) => {
  if (g.length !== LATENT_GENES) throw Error('genome_size');
  return { ...decodeBase(Array.from(g).slice(0, BASE_GENES)), alpha: clamp(g[BASE_GENES], .05, 3), kappa: clamp(g[BASE_GENES + 1], 0, 20), noise: clamp(g[BASE_GENES + 2], .1, 1), decay: clamp(g[BASE_GENES + 3], .5, .99) };
};
type Belief = { n: number; sum: number };
type Feedback = (o: { agentId: string; reward: number; terminated: boolean; energyBefore: number; energyAfter: number; action: string }[], next: Map<string, Request>) => void;
export type CtxCohort = ((q: Request, seed: number) => Proposal) & { feedback: Feedback; regimes: (id: string) => number; active: (id: string) => number };

function build(kind: 'dual' | 'regime' | 'latent', genes: ArrayLike<number>, prior: Prior, priors: Priors): CtxCohort {
  const p = kind === 'dual' ? decodeDualGenes(genes) : kind === 'latent' ? decodeLatentGenes(genes) as unknown as ReturnType<typeof decodeDualGenes> : decodeRegimeGenes(genes) as ReturnType<typeof decodeDualGenes> & ReturnType<typeof decodeRegimeGenes>;
  const l2 = p as unknown as ReturnType<typeof decodeLatentGenes>;
  const d2 = p as unknown as ReturnType<typeof decodeDualGenes>, r2 = p as unknown as ReturnType<typeof decodeRegimeGenes>;
  // 每个个体：dual 用 [fast 表, slow 表]；regime 用至多 4 张表。误差滑动平均与当前表序号也是个体的后天状态。
  type St = { tables: Map<string, Belief>[]; err: number[]; cur: number; cnt: number[] };
  const states = new Map<string, St>(), pending = new Map<string, { desc?: string; metabolism: number }>();
  const fresh = (): St => kind === 'dual' ? { tables: [new Map(), new Map()], err: [.5, .5], cur: 0, cnt: [] } : { tables: [new Map()], err: kind === 'latent' ? [0] : [.5], cur: 0, cnt: [0] };   // latent 里 err 存对数后验
  const st = (id: string) => { let s = states.get(id); if (!s) { s = fresh(); states.set(id, s); } return s; };
  const v0 = (d: string) => prior === 'none' ? 0 : clamp(p.scale * (priors.get(d) === undefined ? NONSENSE_DEFAULT_V0 : 2 * priors.get(d)! - 1) + p.bias, -1, 1);
  const mean = (t: Map<string, Belief>, d: string) => { const e = t.get(d); return e ? (p.trust * v0(d) + e.sum) / (p.trust + e.n) : v0(d); };
  const count = (t: Map<string, Belief>, d: string) => t.get(d)?.n ?? 0;
  const belief = (s: St, d: string) => {
    if (kind === 'dual') { const w = 1 / (1 + Math.exp(-d2.sharp * (s.err[1] - s.err[0]))); return { mu: w * mean(s.tables[0], d) + (1 - w) * mean(s.tables[1], d), n: w * count(s.tables[0], d) + (1 - w) * count(s.tables[1], d) }; }
    return { mu: mean(s.tables[s.cur], d), n: count(s.tables[s.cur], d) };
  };
  const value = (id: string, d: string, frac: number) => { const { mu, n } = belief(st(id), d); return mu + (n === 0 && frac < p.risk ? 0 : p.curiosity / (1 + n)); };
  const draw = (id: string, d: string, tick: number) => { let x = 2166136261; for (const ch of `${id}:${d}:${tick}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619); x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; return (x >>> 0) / 4294967296; };
  const controller = ((q: Request, seed: number): Proposal => {
    const id = q.identity.agentId, tick = q.identity.tick, frac = q.observation.energy / q.observation.capacity;
    const proposal = ruleProposal(filterRequest(q, d => d === undefined || value(id, d, frac) >= p.tau || (p.retry > 0 && draw(id, d, tick) < p.retry)), seed);
    const here = q.observation.local.find(c => Math.hypot(c.dx, c.dy) < .5 && !c.blocked);
    pending.set(id, { desc: proposal.action === 'eat' ? here?.desc : undefined, metabolism: q.observation.costs.metabolismPerTick * q.observation.costs.decisionTicks });
    return { ...proposal, provider: `structured-${kind}-v1` };
  }) as CtxCohort;
  controller.regimes = id => st(id).tables.length; controller.active = id => st(id).cur;
  const learn = (id: string, d: string, x: number) => {
    const s = st(id); x = clamp(x, -1, 1);
    if (kind === 'latent') {
      // 粘性 CRP 的在线 MAP 近似：err[k] = 对数后验；新表候选的均值是先验（空表）
      const sig2 = 2 * l2.noise * l2.noise, ls = Math.log(l2.noise), canNew = s.tables.length < MAX_REGIMES, tot = s.cnt.reduce((a, b) => a + b, 0) + l2.kappa + (canNew ? l2.alpha : 0);
      const cand = s.tables.map((t, k) => l2.decay * s.err[k] + Math.log(((s.cnt[k] + (k === s.cur ? l2.kappa : 0)) + 1e-6) / tot) - (x - mean(t, d)) ** 2 / sig2 - ls);
      const newScore = canNew ? Math.log(l2.alpha / tot) - (x - v0(d)) ** 2 / 2 : -Infinity;   // 新环境对结果的预测很宽（σ=1，均值为先验），所以只有出乎意料的结果才会让它胜出
      let best = 0; cand.forEach((c, k) => { if (c > cand[best]) best = k; });
      if (newScore > cand[best]) { s.tables.push(new Map()); s.cnt.push(0); cand.push(newScore); best = s.tables.length - 1; }
      const top = cand[best]; s.err = cand.map(c => c - top); s.cur = best; s.cnt = s.cnt.map(c => c * l2.decay); s.cnt[best]++;   // 计数也随时间衰减（只记“最近”的分配）
      s.tables[best].set(d, updateBelief(s.tables[best].get(d), x, p.forget)); return;
    }
    const rate = kind === 'dual' ? d2.rate : r2.rate;
    // 先用各表对这次经历的预测误差更新滑动平均（预测在更新信念之前）
    s.tables.forEach((t, i) => { s.err[i] += rate * (Math.abs(x - mean(t, d)) - s.err[i]); });
    if (kind === 'dual') { s.tables[0].set(d, updateBelief(s.tables[0].get(d), x, d2.fast)); s.tables[1].set(d, updateBelief(s.tables[1].get(d), x, d2.slow)); return; }
    // regime：误差最小的表且优势超过 margin 才切换；全部过高则新开一套
    let best = 0; s.err.forEach((e, i) => { if (e < s.err[best]) best = i; });
    if (best !== s.cur && s.err[best] < s.err[s.cur] - r2.margin) s.cur = best;
    if (s.err[s.cur] > r2.theta && s.tables.length < MAX_REGIMES) { s.tables.push(new Map()); s.err.push(r2.theta / 2); s.cur = s.tables.length - 1; }
    s.tables[s.cur].set(d, updateBelief(s.tables[s.cur].get(d), x, p.forget));
  };
  controller.feedback = outcomes => {
    for (const o of outcomes) {
      const s = pending.get(o.agentId); pending.delete(o.agentId); if (!s) continue;
      const gain = o.energyAfter - o.energyBefore + s.metabolism; if (!Number.isFinite(gain)) continue;
      if (s.desc && o.action === 'eat') learn(o.agentId, s.desc, gain / 3);
    }
  };
  return controller;
}
export const structuredDualCohort = (g: ArrayLike<number>, prior: Prior, priors: Priors) => build('dual', g, prior, priors);
export const structuredRegimeCohort = (g: ArrayLike<number>, prior: Prior, priors: Priors) => build('regime', g, prior, priors);
export const structuredLatentCohort = (g: ArrayLike<number>, prior: Prior, priors: Priors) => build('latent', g, prior, priors);

/** 线索键控记忆：信念按（可见的环境线索句子, 描述词）保存；没有线索（或线索被关闭）时只有一张表，与 v2 完全一致。不理解线索的含义，只把它当作“这是哪个环境”的标签；线索随机或误导时，同一句下混有不同环境的经历，信念会被污染。基因同 v2（9 个）。 */
export function structuredCueCohort(genes: ArrayLike<number>, prior: Prior, priors: Priors) {
  const p = decodeBase(Array.from(genes)), tables = new Map<string, Map<string, Map<string, Belief>>>(), pending = new Map<string, { desc?: string; cue: string; metabolism: number }>();
  const v0 = (d: string) => prior === 'none' ? 0 : clamp(p.scale * (priors.get(d) === undefined ? NONSENSE_DEFAULT_V0 : 2 * priors.get(d)! - 1) + p.bias, -1, 1);
  const table = (id: string, cue: string) => { let a = tables.get(id); if (!a) { a = new Map(); tables.set(id, a); } let t = a.get(cue); if (!t) { t = new Map(); a.set(cue, t); } return t; };
  const value = (id: string, cue: string, d: string, frac: number) => { const e = table(id, cue).get(d), n = e?.n ?? 0; return (e ? (p.trust * v0(d) + e.sum) / (p.trust + e.n) : v0(d)) + (n === 0 && frac < p.risk ? 0 : p.curiosity / (1 + n)); };
  const draw = (id: string, d: string, tick: number) => { let x = 2166136261; for (const ch of `${id}:${d}:${tick}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619); x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; return (x >>> 0) / 4294967296; };
  const controller = ((q: Request, seed: number): Proposal => {
    const id = q.identity.agentId, tick = q.identity.tick, frac = q.observation.energy / q.observation.capacity, cue = q.observation.season ?? '';
    const proposal = ruleProposal(filterRequest(q, d => d === undefined || value(id, cue, d, frac) >= p.tau || (p.retry > 0 && draw(id, d, tick) < p.retry)), seed);
    const here = q.observation.local.find(c => Math.hypot(c.dx, c.dy) < .5 && !c.blocked);
    pending.set(id, { desc: proposal.action === 'eat' ? here?.desc : undefined, cue, metabolism: q.observation.costs.metabolismPerTick * q.observation.costs.decisionTicks });
    return { ...proposal, provider: 'structured-cue-v1' };
  }) as ((q: Request, seed: number) => Proposal) & { feedback: Feedback; cues: (id: string) => number };
  controller.cues = id => tables.get(id)?.size ?? 0;
  controller.feedback = outcomes => {
    for (const o of outcomes) {
      const s = pending.get(o.agentId); pending.delete(o.agentId); if (!s) continue;
      const gain = o.energyAfter - o.energyBefore + s.metabolism; if (!Number.isFinite(gain)) continue;
      if (s.desc && o.action === 'eat') { const t = table(o.agentId, s.cue); t.set(s.desc, updateBelief(t.get(s.desc), clamp(gain / 3, -1, 1), p.forget)); }
    }
  };
  return controller;
}
