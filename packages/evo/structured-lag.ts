// 强得多的经验学习器：延迟感知（滞后对齐）的信用分配（点子 #14；Garcia 效应的延迟特征只作类比）。
// 结构化个体 v2 + 2 个基因：lag（滞后 L∈[0,150] 个模拟步）与 width（宽度 w∈[5,60]）。冲击（|gain| > 1.2）出现时，
// 只把它归给“约 L 步之前吃下的那一餐”：满足 L − w ≤ 年龄 ≤ L + w 的餐各得权重 1；更老的餐丢弃。lag = 0 时退化为即时记录（与 v2 的 credit = 0 一致）。
// 延迟世界里冲击在吃下后固定延迟才到，所以进化可以学到 L ≈ 延迟；个体并不被告知延迟。v2 的 credit 基因被忽略。隐藏真值从不进入。
import { ruleProposal } from '../sim/controllers.ts';
import type { Proposal, Request } from '../protocol/ecology.ts';
import { filterRequest, type Priors } from './semantic-run.ts';
import { NONSENSE_DEFAULT_V0 } from './sempolicy.ts';
import { decodeGenes as decodeBase, updateBelief, STRUCTURED_GENES as BASE_GENES, type StructuredPrior as Prior } from './structured.ts';

export const LAG_GENES = BASE_GENES + 2;
export const decodeLagGenes = (g: ArrayLike<number>) => {
  if (g.length !== LAG_GENES) throw Error('genome_size');
  const c = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
  return { ...decodeBase(Array.from(g).slice(0, BASE_GENES)), lag: Math.round(c(g[BASE_GENES], 0, 150)), width: Math.round(c(g[BASE_GENES + 1], 5, 60)) };
};
type Belief = { n: number; sum: number };
export type LagCohort = ((q: Request, seed: number) => Proposal) & { feedback: (o: { agentId: string; reward: number; terminated: boolean; energyBefore: number; energyAfter: number; action: string }[], next: Map<string, Request>) => void; beliefs: Map<string, Map<string, Belief>> };

export function structuredLagCohort(genes: ArrayLike<number>, prior: Prior, priors: Priors): LagCohort {
  const p = decodeLagGenes(genes), beliefs = new Map<string, Map<string, Belief>>(), pending = new Map<string, { desc?: string; metabolism: number }>();
  const v0 = (d: string) => prior === 'none' ? 0 : Math.max(-1, Math.min(1, p.scale * (priors.get(d) === undefined ? NONSENSE_DEFAULT_V0 : 2 * priors.get(d)! - 1) + p.bias));
  const value = (id: string, d: string, frac: number) => { const e = beliefs.get(id)?.get(d), n = e?.n ?? 0; return (e ? (p.trust * v0(d) + e.sum) / (p.trust + e.n) : v0(d)) + (n === 0 && frac < p.risk ? 0 : p.curiosity / (1 + n)); };
  const draw = (id: string, d: string, tick: number) => { let x = 2166136261; for (const ch of `${id}:${d}:${tick}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619); x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; return (x >>> 0) / 4294967296; };
  const record = (id: string, d: string, x: number) => { const m = beliefs.get(id) ?? new Map<string, Belief>(); beliefs.set(id, m); m.set(d, updateBelief(m.get(d), Math.max(-1, Math.min(1, x)), p.forget)); };
  const meals = new Map<string, { desc: string; tick: number }[]>(), lastTick = new Map<string, number>();
  const controller = ((q: Request, seed: number): Proposal => {
    const id = q.identity.agentId, tick = q.identity.tick, frac = q.observation.energy / q.observation.capacity;
    const proposal = ruleProposal(filterRequest(q, d => d === undefined || value(id, d, frac) >= p.tau || (p.retry > 0 && draw(id, d, tick) < p.retry)), seed);
    const here = q.observation.local.find(c => Math.hypot(c.dx, c.dy) < .5 && !c.blocked);
    lastTick.set(id, tick);
    pending.set(id, { desc: proposal.action === 'eat' ? here?.desc : undefined, metabolism: q.observation.costs.metabolismPerTick * q.observation.costs.decisionTicks });
    return { ...proposal, provider: 'structured-lag-v1' };
  }) as LagCohort;
  controller.beliefs = beliefs;
  controller.feedback = outcomes => {
    for (const o of outcomes) {
      const s = pending.get(o.agentId); pending.delete(o.agentId); if (!s) continue;
      const gain = o.energyAfter - o.energyBefore + s.metabolism; if (!Number.isFinite(gain)) continue;
      if (p.lag === 0) { if (s.desc && o.action === 'eat') record(o.agentId, s.desc, gain / 3); continue; }
      const t = lastTick.get(o.agentId) ?? 0, list = (meals.get(o.agentId) ?? []).filter(m => t - m.tick <= p.lag + p.width);
      if (o.action === 'eat' && s.desc) list.push({ desc: s.desc, tick: t });
      if (Math.abs(gain) > 1.2) for (const m of list) { const age = t - m.tick; if (age >= p.lag - p.width && age <= p.lag + p.width) record(o.agentId, m.desc, gain / 3); }
      meals.set(o.agentId, list);
    }
  };
  return controller;
}
