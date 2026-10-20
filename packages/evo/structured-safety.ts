// 更强的经验学习器之一：“习得的安全”式信用分配（点子 #1；Kalat & Rozin 1973 的“learned safety”只作灵感，不声称模拟其机制）。
// 结构化个体 v2 + 2 个基因：novelty（新奇度偏置 ν∈[0,3]）与 safe（安全证据强度 s∈[0,1]）。与 v2 的区别只在延迟信用分配：
//  1) 冲击出现时，对窗口内每个吃过的种类的归责权重 = 1/(1 + ν·n)，n 是该种类此前已记录的经历数——新奇的种类被多归责，已熟悉的少归责；
//  2) 一餐的信用窗口到期仍没有被归责（没有明显冲击）时，对该种类记录一次强度为 s 的“安全”证据（x = +s）。
// 窗口为 0（即时世界）时与 v2 逐动作一致。隐藏真值从不进入。
import { ruleProposal } from '../sim/controllers.ts';
import type { Proposal, Request } from '../protocol/ecology.ts';
import { filterRequest, type Priors } from './semantic-run.ts';
import { NONSENSE_DEFAULT_V0 } from './sempolicy.ts';
import { decodeGenes as decodeBase, STRUCTURED_GENES as BASE_GENES, type StructuredPrior as Prior } from './structured.ts';

export const SAFETY_GENES = BASE_GENES + 2;
export const decodeSafetyGenes = (g: ArrayLike<number>) => {
  if (g.length !== SAFETY_GENES) throw Error('genome_size');
  const c = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
  return { ...decodeBase(Array.from(g).slice(0, BASE_GENES)), novelty: c(g[BASE_GENES], 0, 3), safe: c(g[BASE_GENES + 1], 0, 1) };
};
type Belief = { n: number; sum: number };
export type SafetyCohort = ((q: Request, seed: number) => Proposal) & { feedback: (o: { agentId: string; reward: number; terminated: boolean; energyBefore: number; energyAfter: number; action: string }[], next: Map<string, Request>) => void; beliefs: Map<string, Map<string, Belief>> };

export function structuredSafetyCohort(genes: ArrayLike<number>, prior: Prior, priors: Priors): SafetyCohort {
  const p = decodeSafetyGenes(genes), beliefs = new Map<string, Map<string, Belief>>(), pending = new Map<string, { desc?: string; metabolism: number }>();
  const v0 = (d: string) => prior === 'none' ? 0 : Math.max(-1, Math.min(1, p.scale * (priors.get(d) === undefined ? NONSENSE_DEFAULT_V0 : 2 * priors.get(d)! - 1) + p.bias));
  const value = (id: string, d: string, frac: number) => { const e = beliefs.get(id)?.get(d), n = e?.n ?? 0; return (e ? (p.trust * v0(d) + e.sum) / (p.trust + e.n) : v0(d)) + (n === 0 && frac < p.risk ? 0 : p.curiosity / (1 + n)); };
  const draw = (id: string, d: string, tick: number) => { let x = 2166136261; for (const ch of `${id}:${d}:${tick}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619); x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; return (x >>> 0) / 4294967296; };
  const recordW = (id: string, d: string, x: number, w: number) => { const m = beliefs.get(id) ?? new Map<string, Belief>(); beliefs.set(id, m); const old = m.get(d) ?? { n: 0, sum: 0 }, keep = 1 - p.forget; m.set(d, { n: old.n * keep + w, sum: old.sum * keep + w * Math.max(-1, Math.min(1, x)) }); };
  const meals = new Map<string, { desc: string; tick: number }[]>(), lastTick = new Map<string, number>();
  const controller = ((q: Request, seed: number): Proposal => {
    const id = q.identity.agentId, tick = q.identity.tick, frac = q.observation.energy / q.observation.capacity;
    const proposal = ruleProposal(filterRequest(q, d => d === undefined || value(id, d, frac) >= p.tau || (p.retry > 0 && draw(id, d, tick) < p.retry)), seed);
    const here = q.observation.local.find(c => Math.hypot(c.dx, c.dy) < .5 && !c.blocked);
    lastTick.set(id, tick);
    pending.set(id, { desc: proposal.action === 'eat' ? here?.desc : undefined, metabolism: q.observation.costs.metabolismPerTick * q.observation.costs.decisionTicks });
    return { ...proposal, provider: 'structured-safety-v1' };
  }) as SafetyCohort;
  controller.beliefs = beliefs;
  controller.feedback = outcomes => {
    for (const o of outcomes) {
      const s = pending.get(o.agentId); pending.delete(o.agentId); if (!s) continue;
      const gain = o.energyAfter - o.energyBefore + s.metabolism; if (!Number.isFinite(gain)) continue;
      if (p.credit > 0) {
        const t = lastTick.get(o.agentId) ?? 0; let list = meals.get(o.agentId) ?? [];
        const expired = list.filter(m => t - m.tick > p.credit); list = list.filter(m => t - m.tick <= p.credit);
        if (p.safe > 0) for (const m of expired) recordW(o.agentId, m.desc, p.safe, 1);          // 到期仍无明显冲击 → 安全证据
        if (o.action === 'eat' && s.desc) list.push({ desc: s.desc, tick: t });
        if (Math.abs(gain) > 1.2 && list.length) {
          for (const m of list) { const n = beliefs.get(o.agentId)?.get(m.desc)?.n ?? 0; recordW(o.agentId, m.desc, gain / 3, 1 / (1 + p.novelty * n)); }   // 熟悉的种类少归责
          list = [];
        }
        meals.set(o.agentId, list); continue;
      }
      if (s.desc && o.action === 'eat') recordW(o.agentId, s.desc, gain / 3, 1);
    }
  };
  return controller;
}
