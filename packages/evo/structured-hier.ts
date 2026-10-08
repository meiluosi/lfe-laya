// W5b 层次信念：在结构化个体 v2 上加两个基因，让“相似的描述共享经验”。默认不使用（v2 基因组与 structured.ts 不受影响）。
// 基因 = v2 的 9 个 + share（共享强度 h∈[0,3]）+ thr（相似度阈值 θ∈[0.2,0.95]）。
// 对描述 d：邻居证据 = Σ_j w(d,j)·(n_j, sum_j)，其中 j 是该个体自己吃过的其他描述，w = max(0, cos(e_d,e_j) − θ)/(1 − θ)。
// 信念 v = (trust·v0 + sum_d + h·Σw·sum_j)/(trust + n_d + h·Σw·n_j)，好奇心按 n_d + h·Σw·n_j 衰减。
// e_d 是固定 Laya 编码器对描述文本的缓存向量（只依赖文本，系统 1 的输出）；只用于该个体自己经历过的描述之间的相似度，不含隐藏真值。
import { ruleProposal } from '../sim/controllers.ts';
import type { Proposal, Request } from '../protocol/ecology.ts';
import { filterRequest, type Priors } from './semantic-run.ts';
import { NONSENSE_DEFAULT_V0 } from './sempolicy.ts';
import { decodeGenes, updateBelief, STRUCTURED_GENES, type StructuredPrior } from './structured.ts';

export const HIER_GENES = STRUCTURED_GENES + 2;
export type Embeddings = Map<string, ArrayLike<number>>;
export const decodeHierGenes = (g: ArrayLike<number>) => {
  if (g.length !== HIER_GENES) throw Error('genome_size');
  const c = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
  return { ...decodeGenes(Array.from(g).slice(0, STRUCTURED_GENES)), share: c(g[STRUCTURED_GENES], 0, 3), thr: c(g[STRUCTURED_GENES + 1], .2, .95) };
};
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
type Belief = { n: number; sum: number };
export type HierCohort = ((q: Request, seed: number) => Proposal) & { feedback: (o: { agentId: string; reward: number; terminated: boolean; energyBefore: number; energyAfter: number; action: string }[], next: Map<string, Request>) => void; beliefs: Map<string, Map<string, Belief>>; neighbors: (agentId: string, desc: string) => { n: number; sum: number } };

export function structuredHierCohort(genes: ArrayLike<number>, prior: StructuredPrior, priors: Priors, emb: Embeddings): HierCohort {
  const p = decodeHierGenes(genes), beliefs = new Map<string, Map<string, Belief>>(), pending = new Map<string, { desc?: string; metabolism: number }>();
  const v0 = (d: string) => prior === 'none' ? 0 : Math.max(-1, Math.min(1, p.scale * (priors.get(d) === undefined ? NONSENSE_DEFAULT_V0 : 2 * priors.get(d)! - 1) + p.bias));
  const neighbors = (id: string, d: string) => {
    const e = emb.get(d), m = beliefs.get(id); let n = 0, sum = 0; if (!e || !m || p.share === 0) return { n, sum };
    for (const [j, b] of m) { if (j === d) continue; const ej = emb.get(j); if (!ej) continue; const w = (dot(e, ej) - p.thr) / (1 - p.thr); if (w > 0) { n += w * b.n; sum += w * b.sum; } }
    return { n: p.share * n, sum: p.share * sum };
  };
  const value = (id: string, d: string, frac: number) => {
    const e = beliefs.get(id)?.get(d), own = e?.n ?? 0, nb = neighbors(id, d), nAll = own + nb.n;
    const v = nAll === 0 ? v0(d) : (p.trust * v0(d) + (e?.sum ?? 0) + nb.sum) / (p.trust + own + nb.n);
    return v + (own === 0 && frac < p.risk ? 0 : p.curiosity / (1 + nAll));
  };
  const draw = (id: string, d: string, tick: number) => { let x = 2166136261; for (const ch of `${id}:${d}:${tick}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619); x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; return (x >>> 0) / 4294967296; };
  const meals = new Map<string, { desc: string; tick: number }[]>(), lastTick = new Map<string, number>();
  const controller = ((q: Request, seed: number): Proposal => {
    const id = q.identity.agentId, tick = q.identity.tick, frac = q.observation.energy / q.observation.capacity;
    const proposal = ruleProposal(filterRequest(q, d => d === undefined || value(id, d, frac) >= p.tau || (p.retry > 0 && draw(id, d, tick) < p.retry)), seed);
    const here = q.observation.local.find(c => Math.hypot(c.dx, c.dy) < .5 && !c.blocked);
    lastTick.set(id, tick);
    pending.set(id, { desc: proposal.action === 'eat' ? here?.desc : undefined, metabolism: q.observation.costs.metabolismPerTick * q.observation.costs.decisionTicks });
    return { ...proposal, provider: 'structured-hier-v1' };
  }) as HierCohort;
  controller.beliefs = beliefs; controller.neighbors = neighbors;
  const record = (id: string, d: string, x: number) => { const m = beliefs.get(id) ?? new Map(); beliefs.set(id, m); m.set(d, updateBelief(m.get(d), Math.max(-1, Math.min(1, x)), p.forget)); };
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
