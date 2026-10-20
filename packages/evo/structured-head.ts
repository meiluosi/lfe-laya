// 先天线性头（Baldwin 式同化的检验）：结构化个体 v2 + 一个作用在 Laya 编码器嵌入（32 维，PCA、L2 归一化）上的线性读出。
// 基因 = v2 的 9 个 + HEAD_DIM 个权重 + 1 个偏置。对描述 d 的先验价值：v0 = clamp(scale·(2p−1) + bias + tanh(w·e_d + b))，其中 p 是 Laya 的缓存判断（prior = 'none' 时为 0），
// e_d 是描述的缓存嵌入（只依赖文本）。"none + head" 不用 Laya 的判断头，但仍使用其编码器的特征，所以是"进化出的读出 + 固定编码器"，不是完全不依赖 Laya。
// 隐藏真值从不进入；头只能通过进化（先天）获得，个体一生内不更新（后天信念仍只来自经历）。
import { ruleProposal } from '../sim/controllers.ts';
import type { Proposal, Request } from '../protocol/ecology.ts';
import { filterRequest, type Priors } from './semantic-run.ts';
import { NONSENSE_DEFAULT_V0 } from './sempolicy.ts';
import { decodeGenes as decodeBase, updateBelief, STRUCTURED_GENES as BASE_GENES, type StructuredPrior as Prior } from './structured.ts';

export const HEAD_DIM = 32, HEAD_GENES = BASE_GENES + HEAD_DIM + 1;
export type Embeddings = Map<string, ArrayLike<number>>;
export const decodeHeadGenes = (g: ArrayLike<number>) => {
  if (g.length !== HEAD_GENES) throw Error('genome_size');
  return { ...decodeBase(Array.from(g).slice(0, BASE_GENES)), w: Array.from(g).slice(BASE_GENES, BASE_GENES + HEAD_DIM), b: g[BASE_GENES + HEAD_DIM] };
};
type Belief = { n: number; sum: number };
export type HeadCohort = ((q: Request, seed: number) => Proposal) & { feedback: (o: { agentId: string; reward: number; terminated: boolean; energyBefore: number; energyAfter: number; action: string }[], next: Map<string, Request>) => void; beliefs: Map<string, Map<string, Belief>>; innate: (desc: string) => number };

export function structuredHeadCohort(genes: ArrayLike<number>, prior: Prior, priors: Priors, emb: Embeddings): HeadCohort {
  const p = decodeHeadGenes(genes), beliefs = new Map<string, Map<string, Belief>>(), pending = new Map<string, { desc?: string; metabolism: number }>(), cache = new Map<string, number>();
  const readout = (d: string) => { let v = cache.get(d); if (v !== undefined) return v; const e = emb.get(d); let s = p.b; if (e) for (let i = 0; i < HEAD_DIM; i++) s += p.w[i] * e[i]; v = Math.tanh(s); cache.set(d, v); return v; };
  const v0 = (d: string) => Math.max(-1, Math.min(1, (prior === 'none' ? 0 : p.scale * (priors.get(d) === undefined ? NONSENSE_DEFAULT_V0 : 2 * priors.get(d)! - 1)) + p.bias + readout(d)));
  const value = (id: string, d: string, frac: number) => { const e = beliefs.get(id)?.get(d), n = e?.n ?? 0; return (e ? (p.trust * v0(d) + e.sum) / (p.trust + e.n) : v0(d)) + (n === 0 && frac < p.risk ? 0 : p.curiosity / (1 + n)); };
  const draw = (id: string, d: string, tick: number) => { let x = 2166136261; for (const ch of `${id}:${d}:${tick}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619); x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; return (x >>> 0) / 4294967296; };
  const controller = ((q: Request, seed: number): Proposal => {
    const id = q.identity.agentId, tick = q.identity.tick, frac = q.observation.energy / q.observation.capacity;
    const proposal = ruleProposal(filterRequest(q, d => d === undefined || value(id, d, frac) >= p.tau || (p.retry > 0 && draw(id, d, tick) < p.retry)), seed);
    const here = q.observation.local.find(c => Math.hypot(c.dx, c.dy) < .5 && !c.blocked);
    lastTick.set(id, tick);
    pending.set(id, { desc: proposal.action === 'eat' ? here?.desc : undefined, metabolism: q.observation.costs.metabolismPerTick * q.observation.costs.decisionTicks });
    return { ...proposal, provider: 'structured-head-v1' };
  }) as HeadCohort;
  controller.beliefs = beliefs; controller.innate = v0;
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
