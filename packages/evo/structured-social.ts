// W8b 社会学习个体：结构化个体 v2 + 1 个基因 social（社会证据的权重 w∈[0,3]）。
// 个体读邻居的可见外观 look（语言描述）：把外观包装成“食物描述”交给与食物相同的先验（Laya / 词典）判断，v = 2p−1；
// 外观明显偏好或偏坏（|v| ≥ 0.3）时，把它当作对邻居最近进食（ate，至多 2 项）的一次权重为 w 的证据，更新自己对这些描述的信念。
// 无先验的个体读不懂外观，不更新。不共享参数或内部经验；同一 (外观, 进食) 在 120 个模拟步内只计一次（邻居没有可跨决策追踪的标识）。
// 隐藏真值从不进入。
import { ruleProposal } from '../sim/controllers.ts';
import type { Proposal, Request } from '../protocol/ecology.ts';
import { filterRequest, type Priors } from './semantic-run.ts';
import { NONSENSE_DEFAULT_V0 } from './sempolicy.ts';
import { lookText } from './semantic.ts';
import { decodeGenes as decodeBase, STRUCTURED_GENES as BASE_GENES, type StructuredPrior as Prior } from './structured.ts';

export const SOCIAL_GENES = BASE_GENES + 1;
export const decodeSocialGenes = (g: ArrayLike<number>) => {
  if (g.length !== SOCIAL_GENES) throw Error('genome_size');
  return { ...decodeBase(Array.from(g).slice(0, BASE_GENES)), social: Math.max(0, Math.min(3, g[BASE_GENES])) };
};
type Belief = { n: number; sum: number };
const SOCIAL_THRESHOLD = .3, DEDUPE_TICKS = 120;
export type SocialCohort = ((q: Request, seed: number) => Proposal) & { feedback: (o: { agentId: string; reward: number; terminated: boolean; energyBefore: number; energyAfter: number; action: string }[], next: Map<string, Request>) => void; beliefs: Map<string, Map<string, Belief>> };

export function structuredSocialCohort(genes: ArrayLike<number>, prior: Prior, priors: Priors): SocialCohort {
  const p = decodeSocialGenes(genes), beliefs = new Map<string, Map<string, Belief>>(), pending = new Map<string, { desc?: string; metabolism: number }>(), seen = new Map<string, Map<string, number>>();
  const v0 = (d: string) => prior === 'none' ? 0 : Math.max(-1, Math.min(1, p.scale * (priors.get(d) === undefined ? NONSENSE_DEFAULT_V0 : 2 * priors.get(d)! - 1) + p.bias));
  const value = (id: string, d: string, frac: number) => { const e = beliefs.get(id)?.get(d), n = e?.n ?? 0; return (e ? (p.trust * v0(d) + e.sum) / (p.trust + e.n) : v0(d)) + (n === 0 && frac < p.risk ? 0 : p.curiosity / (1 + n)); };
  const draw = (id: string, d: string, tick: number) => { let x = 2166136261; for (const ch of `${id}:${d}:${tick}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619); x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; return (x >>> 0) / 4294967296; };
  const recordW = (id: string, d: string, x: number, w: number) => { const m = beliefs.get(id) ?? new Map<string, Belief>(); beliefs.set(id, m); const old = m.get(d) ?? { n: 0, sum: 0 }, keep = 1 - p.forget; m.set(d, { n: old.n * keep + w, sum: old.sum * keep + w * Math.max(-1, Math.min(1, x)) }); };
  const learnFromNeighbours = (q: Request) => {
    if (prior === 'none' || p.social === 0) return;
    const id = q.identity.agentId, tick = q.identity.tick, memo = seen.get(id) ?? new Map<string, number>(); seen.set(id, memo);
    for (const [k, t] of memo) if (tick - t > DEDUPE_TICKS) memo.delete(k);
    for (const n of q.observation.neighbors) {
      if (!n.look || !n.ate?.length) continue;
      const pr = priors.get(lookText(n.look)); if (pr === undefined) continue;
      const v = 2 * pr - 1; if (Math.abs(v) < SOCIAL_THRESHOLD) continue;
      const key = `${n.look}|${n.ate.join('|')}`; if (memo.has(key)) continue; memo.set(key, tick);
      for (const d of n.ate.slice(0, 2)) recordW(id, d, v, p.social);
    }
  };
  const meals = new Map<string, { desc: string; tick: number }[]>(), lastTick = new Map<string, number>();
  const controller = ((q: Request, seed: number): Proposal => {
    learnFromNeighbours(q);
    const id = q.identity.agentId, tick = q.identity.tick, frac = q.observation.energy / q.observation.capacity;
    const proposal = ruleProposal(filterRequest(q, d => d === undefined || value(id, d, frac) >= p.tau || (p.retry > 0 && draw(id, d, tick) < p.retry)), seed);
    const here = q.observation.local.find(c => Math.hypot(c.dx, c.dy) < .5 && !c.blocked);
    lastTick.set(id, tick);
    pending.set(id, { desc: proposal.action === 'eat' ? here?.desc : undefined, metabolism: q.observation.costs.metabolismPerTick * q.observation.costs.decisionTicks });
    return { ...proposal, provider: 'structured-social-v1' };
  }) as SocialCohort;
  controller.beliefs = beliefs;
  controller.feedback = outcomes => {
    for (const o of outcomes) {
      const s = pending.get(o.agentId); pending.delete(o.agentId); if (!s) continue;
      const gain = o.energyAfter - o.energyBefore + s.metabolism; if (!Number.isFinite(gain)) continue;
      if (p.credit > 0) {
        const t = lastTick.get(o.agentId) ?? 0, list = (meals.get(o.agentId) ?? []).filter(m => t - m.tick <= p.credit);
        if (o.action === 'eat' && s.desc) list.push({ desc: s.desc, tick: t });
        if (Math.abs(gain) > 1.2 && list.length) { for (const m of list) recordW(o.agentId, m.desc, gain / 3, 1); list.length = 0; }
        meals.set(o.agentId, list); continue;
      }
      if (s.desc && o.action === 'eat') recordW(o.agentId, s.desc, gain / 3, 1);
    }
  };
  return controller;
}
