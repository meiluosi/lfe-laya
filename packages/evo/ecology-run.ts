// G8 评估框架：一个“繁殖生态世界”的运行器。类型（先天基因组 + 学习器）由本框架按谱系分配（孩子继承父母的类型），不是个体的输入；
// 繁殖是固定本能（合法动作里出现“繁殖”就繁殖）；后天信念一生内从头开始、不遗传。设计与协议：docs/DESIGN_G8_ECOLOGY.md、docs/G8_CALIBRATION.md。
import { Ecology } from '../sim/ecology.ts';
import { semanticWorldConfig, type SemanticFactory } from './semantic-run.ts';
import { ruleProposal } from '../sim/controllers.ts';
import { structuredCohort } from './structured.ts';
import { structuredDualCohort, structuredRegimeCohort, structuredCueCohort } from './structured-ctx.ts';
import type { Priors } from './semantic-run.ts';
import type { Proposal, Request } from '../protocol/ecology.ts';

export type Learner = 'plain' | 'dual' | 'regime' | 'cue' | 'eatall';
export type TypeSpec = { label: string; learner: Learner; genes?: number[]; prior?: 'laya' | 'none' };
export type EcologySpec = {
  seed: number; pool: string; split: 'train' | 'test'; priors: Priors;
  pattern: 'aba' | 'abab' | 'long' | 'half'; cue: 'off' | 'true' | 'random';
  supply: number; threshold: number; init: number; maxAge?: number; cooldown?: number;
  /** 初始个体按顺序轮流分配这些类型（纯种群：只有一个；混合：两个；中性对照：两个标签、同一基因组） */
  types: TypeSpec[];
};
export type EcologyResult = {
  established: boolean; births: number; deaths: number; finalLiving: number; extinctAt: number; capHits: number; maxGeneration: number;
  /** 每个阶段内的平均在世个体数（每 50 tick 采样一次），总数与各类型 */
  phaseMean: number[]; phaseMeanByType: Record<string, number[]>;
  finalByType: Record<string, number>; bornByType: Record<string, number>;
  /** 恢复 = 最后一个 A 阶段的平均个体数 / max(1, 第一个 A 阶段的平均个体数) */
  recovery: number; meanLast2: number; hash: string;
};
const PHASE = 1200, PHASES = { aba: 3, abab: 5, long: 5, half: 3 };
const make = (t: TypeSpec, priors: Priors) => {
  const pr = t.prior ?? 'laya';
  switch (t.learner) {
    case 'plain': return structuredCohort(t.genes!, pr, priors);
    case 'dual': return structuredDualCohort(t.genes!, pr, priors);
    case 'regime': return structuredRegimeCohort(t.genes!, pr, priors);
    case 'cue': return structuredCueCohort(t.genes!, pr, priors);
    default: return null;
  }
};
export function runEcology(spec: EcologySpec): EcologyResult {
  const np = PHASES[spec.pattern];
  const cfg = { ...semanticWorldConfig({ seed: spec.seed, options: { split: spec.split, pool: spec.pool, sensible: 6, harmCap: 1, inversion: 0, horizon: np * PHASE, drift: { everyTicks: PHASE, fraction: 1, pattern: spec.pattern, cue: spec.cue } } }), reproduction: true, maxAge: spec.maxAge ?? 2400, birthThreshold: spec.threshold, birthCooldown: spec.cooldown ?? 150, supplyAmount: spec.supply, initialAgents: spec.init };
  const w = new Ecology(cfg), cohorts = spec.types.map(t => make(t, spec.priors));
  const typeIndex = new Map<string, number>(); let nextRoot = 0;
  const parentOf = (id: string) => w.snapshot().lineage.find(l => l.id === id)?.parentId ?? null;
  const typeOf = (id: string): number => {
    let t = typeIndex.get(id); if (t !== undefined) return t;
    const par = parentOf(id); t = par ? typeOf(par) : (nextRoot++ % spec.types.length); typeIndex.set(id, t); return t;
  };
  const decide = (q: Request): Proposal => {
    const t = typeOf(q.identity.agentId);
    if (q.candidates.some(c => c.id === 'reproduce')) return { identity: q.identity, action: 'reproduce', provider: 'instinct', distribution: Object.fromEntries(q.candidates.map(c => [c.id, c.id === 'reproduce' ? 1 : 0])) };
    const c = cohorts[t]; return c ? c(q, spec.seed) : ruleProposal(q, spec.seed);
  };
  const labels = spec.types.map(t => t.label), sum = Array.from({ length: np }, () => 0), cnt = Array.from({ length: np }, () => 0), sumBy = labels.map(() => Array.from({ length: np }, () => 0));
  let extinctAt = -1;
  while (!w.done()) {
    const reqs = w.requests(); for (const q of reqs) typeOf(q.identity.agentId);
    const r = w.step(reqs.map(decide)); if (!r.accepted) throw Error(r.reason);
    const next = new Map((w.done() ? [] : w.requests()).map(q => [q.identity.agentId, q] as const));
    cohorts.forEach((c, i) => c?.feedback(r.outcomes!.filter(o => typeIndex.get(o.agentId) === i).map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action })), next));
    if (w.tick % 50 === 0) {
      const s = w.snapshot(), p = Math.min(np - 1, Math.floor((w.tick - 1) / PHASE)); sum[p] += s.agents.length; cnt[p]++;
      for (const a of s.agents) sumBy[typeOf(a.id)][p]++;
    }
    if (extinctAt < 0 && !w.snapshot().agents.length) extinctAt = w.tick;
  }
  const s = w.snapshot(), phaseMean = sum.map((x, i) => cnt[i] ? x / cnt[i] : 0), phaseMeanByType = Object.fromEntries(labels.map((l, i) => [l, sumBy[i].map((x, p) => cnt[p] ? x / cnt[p] : 0)]));
  const finalByType = Object.fromEntries(labels.map(l => [l, 0])), bornByType = Object.fromEntries(labels.map(l => [l, 0]));
  for (const a of s.agents) finalByType[labels[typeOf(a.id)]]++;
  for (const l of s.lineage) if (l.parentId) bornByType[labels[typeOf(l.id)]]++;
  const lastA = np - 1;
  return { established: s.agents.length > 0 && s.metrics.births >= 20, births: s.metrics.births, deaths: s.metrics.deaths, finalLiving: s.agents.length, extinctAt, capHits: s.metrics.populationCapHits, maxGeneration: Math.max(...s.lineage.map(l => l.generation)),
    phaseMean, phaseMeanByType, finalByType, bornByType, recovery: phaseMean[lastA] / Math.max(1, phaseMean[0]), meanLast2: (phaseMean[np - 1] + phaseMean[np - 2]) / 2, hash: String(s.tick) + ':' + s.metrics.births + ':' + s.metrics.deaths + ':' + s.agents.map(a => `${a.id}@${a.x},${a.y}/${a.energy.toFixed(3)}`).join('|') };
}
export type { SemanticFactory };
