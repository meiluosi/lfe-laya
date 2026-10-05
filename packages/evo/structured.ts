// 结构化个体：先天 = 规则骨架（导航与进食，已验证）+ 五个关于“如何对待先验与经验”的基因；后天 = 该个体自己的食物信念。
// 基因：信任强度 n0、好奇心 c、否决阈值 τ、遗忘率 f、重试率 r。信念 v = (n0·v0 + Σx)/(n0+n) + c/(1+n)；v < τ 的食物被否决（除非这次重试放行）。
// v0 是系统 1（缓存的 Laya）对描述词的先验价值。预言机/隐藏真值从不进入。
import { ruleProposal } from '../sim/controllers.ts';
import type { Proposal, Request } from '../protocol/ecology.ts';
import { filterRequest, type Priors } from './semantic-run.ts';
import { NONSENSE_DEFAULT_V0 } from './sempolicy.ts';

export const STRUCTURED_GENES_V1 = 5, STRUCTURED_GENES = 9;
export type StructuredPrior = 'none' | 'laya';
/** 基因（原始值 → 有界参数）。v2 在 v1 的 5 个之后加：对先验的校准（斜率 a、偏置 b）、探索所需的最低能量比例 risk、延迟信用窗口 credit（模拟步；0 = 吃的当下即时记录）。 */
export const decodeGenes = (g: ArrayLike<number>) => {
  if (g.length !== STRUCTURED_GENES && g.length !== STRUCTURED_GENES_V1) throw Error('genome_size');
  const c = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x)), v2 = g.length === STRUCTURED_GENES;
  return { trust: Math.exp(c(g[0], -2, 4)), curiosity: c(g[1], 0, 1.5), tau: c(g[2], -1, 1), forget: c(g[3], 0, .5), retry: c(g[4], 0, .2),
    scale: v2 ? c(g[5], 0, 3) : 1, bias: v2 ? c(g[6], -1, 1) : 0, risk: v2 ? c(g[7], 0, 1) : 0, credit: v2 ? Math.round(c(g[8], 0, 150)) : 0 };
};
/** 一次新经验 x∈[-1,1] 进入某个体对某食物的信念；forget 把旧经验按比例淡化（环境可能变了）。 */
export const updateBelief = (e: { n: number; sum: number } | undefined, x: number, forget: number): { n: number; sum: number } => { const keep = 1 - forget, old = e ?? { n: 0, sum: 0 }; return { n: old.n * keep + 1, sum: old.sum * keep + x }; };
export type StructuredCohort = ((q: Request, seed: number) => Proposal) & { feedback: (o: { agentId: string; reward: number; terminated: boolean; energyBefore: number; energyAfter: number; action: string }[], next: Map<string, Request>) => void; beliefs: Map<string, Map<string, { n: number; sum: number }>> };

export function structuredCohort(genes: ArrayLike<number>, prior: StructuredPrior, priors: Priors): StructuredCohort {
  const p = decodeGenes(genes), beliefs = new Map<string, Map<string, { n: number; sum: number }>>(), pending = new Map<string, { desc?: string; metabolism: number }>();
  const v0 = (d: string) => prior === 'none' ? 0 : Math.max(-1, Math.min(1, p.scale * (priors.get(d) === undefined ? NONSENSE_DEFAULT_V0 : 2 * priors.get(d)! - 1) + p.bias));
  const value = (id: string, d: string, frac: number) => { const e = beliefs.get(id)?.get(d), n = e?.n ?? 0; return (e ? (p.trust * v0(d) + e.sum) / (p.trust + e.n) : v0(d)) + (n === 0 && frac < p.risk ? 0 : p.curiosity / (1 + n)); };
  const draw = (id: string, d: string, tick: number) => { let x = 2166136261; for (const ch of `${id}:${d}:${tick}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619); x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; return (x >>> 0) / 4294967296; };
  const controller = ((q: Request, seed: number): Proposal => {
    const id = q.identity.agentId, tick = q.identity.tick, frac = q.observation.energy / q.observation.capacity;
    const proposal = ruleProposal(filterRequest(q, d => d === undefined || value(id, d, frac) >= p.tau || (p.retry > 0 && draw(id, d, tick) < p.retry)), seed);
    const here = q.observation.local.find(c => Math.hypot(c.dx, c.dy) < .5 && !c.blocked);
    lastTick.set(id, tick);
    pending.set(id, { desc: proposal.action === 'eat' ? here?.desc : undefined, metabolism: q.observation.costs.metabolismPerTick * q.observation.costs.decisionTicks });
    return { ...proposal, provider: 'structured-v1' };
  }) as StructuredCohort;
  controller.beliefs = beliefs;
  const meals = new Map<string, { desc: string; tick: number }[]>(), lastTick = new Map<string, number>();
  const record = (id: string, d: string, x: number) => { const m = beliefs.get(id) ?? new Map(); beliefs.set(id, m); m.set(d, updateBelief(m.get(d), Math.max(-1, Math.min(1, x)), p.forget)); };
  controller.feedback = outcomes => {
    for (const o of outcomes) {
      const s = pending.get(o.agentId); pending.delete(o.agentId); if (!s) continue;
      const gain = o.energyAfter - o.energyBefore + s.metabolism; if (!Number.isFinite(gain)) continue;
      if (p.credit > 0) {                                      // 延迟信用分配：冲击出现时归因到窗口内吃过的种类
        const t = lastTick.get(o.agentId) ?? 0, list = (meals.get(o.agentId) ?? []).filter(m => t - m.tick <= p.credit);
        if (o.action === 'eat' && s.desc) list.push({ desc: s.desc, tick: t });
        if (Math.abs(gain) > 1.2 && list.length) { for (const m of list) record(o.agentId, m.desc, gain / 3); list.length = 0; }
        meals.set(o.agentId, list); continue;
      }
      if (s.desc && o.action === 'eat') record(o.agentId, s.desc, gain / 3);
    }
  };
  return controller;
}
