// 更强的经验学习器之二：后验采样（Thompson 式）探索（点子 #6）。结构化个体 v2 的信念本来就是共轭后验均值
// μ = (n0·v0 + Σx)/(n0 + n)（n0 是先验的伪计数）；本个体不再用“好奇心加成 + 重试”，而是对每个种类按后验的不确定度抽样：
//  θ = μ + temp·σ·z，σ = sqrt(max(0.05, 1 − μ²)/(n0 + n + 1))，z 是由 (个体, 描述, tick) 哈希生成的确定性标准正态；θ < τ 则否决。
// 能量不足（低于 risk）且该种类从未吃过时不抽样（θ = μ），即风险意识。基因 = v2 的 9 个（curiosity 与 retry 被忽略）+ temp ∈ [0, 3]。
// temp = 0 时等价于 curiosity = 0、retry = 0 的 v2。隐藏真值从不进入。
import { ruleProposal } from '../sim/controllers.ts';
import type { Proposal, Request } from '../protocol/ecology.ts';
import { filterRequest, type Priors } from './semantic-run.ts';
import { NONSENSE_DEFAULT_V0 } from './sempolicy.ts';
import { decodeGenes as decodeBase, updateBelief, STRUCTURED_GENES as BASE_GENES, type StructuredPrior as Prior } from './structured.ts';

export const BAYES_GENES = BASE_GENES + 1;
export const decodeBayesGenes = (g: ArrayLike<number>) => {
  if (g.length !== BAYES_GENES) throw Error('genome_size');
  return { ...decodeBase(Array.from(g).slice(0, BASE_GENES)), temp: Math.max(0, Math.min(3, g[BASE_GENES])) };
};
type Belief = { n: number; sum: number };
export type BayesCohort = ((q: Request, seed: number) => Proposal) & { feedback: (o: { agentId: string; reward: number; terminated: boolean; energyBefore: number; energyAfter: number; action: string }[], next: Map<string, Request>) => void; beliefs: Map<string, Map<string, Belief>> };

export function structuredBayesCohort(genes: ArrayLike<number>, prior: Prior, priors: Priors): BayesCohort {
  const p = decodeBayesGenes(genes), beliefs = new Map<string, Map<string, Belief>>(), pending = new Map<string, { desc?: string; metabolism: number }>();
  const v0 = (d: string) => prior === 'none' ? 0 : Math.max(-1, Math.min(1, p.scale * (priors.get(d) === undefined ? NONSENSE_DEFAULT_V0 : 2 * priors.get(d)! - 1) + p.bias));
  const hash = (s: string) => { let x = 2166136261; for (const ch of s) x = Math.imul(x ^ ch.charCodeAt(0), 16777619); x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; return (x >>> 0) / 4294967296; };
  const normal = (id: string, d: string, tick: number) => Math.sqrt(-2 * Math.log(hash(`${id}:${d}:${tick}:a`) + 1e-12)) * Math.cos(2 * Math.PI * hash(`${id}:${d}:${tick}:b`));
  const sampled = (id: string, d: string, tick: number, frac: number) => {
    const e = beliefs.get(id)?.get(d), n = e?.n ?? 0, mu = e ? (p.trust * v0(d) + e.sum) / (p.trust + e.n) : v0(d);
    if (p.temp === 0 || (n === 0 && frac < p.risk)) return mu;
    return mu + p.temp * Math.sqrt(Math.max(.05, 1 - mu * mu) / (p.trust + n + 1)) * normal(id, d, tick);
  };
  const meals = new Map<string, { desc: string; tick: number }[]>(), lastTick = new Map<string, number>();
  const record = (id: string, d: string, x: number) => { const m = beliefs.get(id) ?? new Map<string, Belief>(); beliefs.set(id, m); m.set(d, updateBelief(m.get(d), Math.max(-1, Math.min(1, x)), p.forget)); };
  const controller = ((q: Request, seed: number): Proposal => {
    const id = q.identity.agentId, tick = q.identity.tick, frac = q.observation.energy / q.observation.capacity;
    const proposal = ruleProposal(filterRequest(q, d => d === undefined || sampled(id, d, tick, frac) >= p.tau), seed);
    const here = q.observation.local.find(c => Math.hypot(c.dx, c.dy) < .5 && !c.blocked);
    lastTick.set(id, tick);
    pending.set(id, { desc: proposal.action === 'eat' ? here?.desc : undefined, metabolism: q.observation.costs.metabolismPerTick * q.observation.costs.decisionTicks });
    return { ...proposal, provider: 'structured-bayes-v1' };
  }) as BayesCohort;
  controller.beliefs = beliefs;
  controller.feedback = outcomes => {
    for (const o of outcomes) {
      const s = pending.get(o.agentId); pending.delete(o.agentId); if (!s) continue;
      const gain = o.energyAfter - o.energyBefore + s.metabolism; if (!Number.isFinite(gain)) continue;
      if (p.credit > 0) {
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
