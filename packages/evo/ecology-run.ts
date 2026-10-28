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
  /** 反转后原本有益的种类的伤害系数（默认关闭）；G10 致命反转世界 */ flipHarm?: number;
  supply: number; threshold: number; init: number; maxAge?: number; cooldown?: number;
  /** 初始个体按顺序轮流分配这些类型（纯种群：只有一个；混合：两个；中性对照：两个标签、同一基因组） */
  types: TypeSpec[];
  /** G8b 探针（开发期）：孩子的基因组 = 父母基因组 + 高斯噪声，每个个体用自己的基因组；不设则同一类型共用一个控制器（G8a 路径）。
   *  噪声标准差 = sigma（第 creditIndex 个基因 = 延迟信用窗口，量纲大，乘 creditScale）。后天信念仍不遗传。 */
  mutation?: { sigma: number; creditIndex?: number; creditScale?: number };
};
export type EcologyResult = {
  established: boolean; births: number; deaths: number; finalLiving: number; extinctAt: number; capHits: number; maxGeneration: number;
  /** 每个阶段内的平均在世个体数（每 50 tick 采样一次），总数与各类型 */
  phaseMean: number[]; phaseMeanByType: Record<string, number[]>;
  finalByType: Record<string, number>; bornByType: Record<string, number>;
  /** 恢复 = 最后一个 A 阶段的平均个体数 / max(1, 第一个 A 阶段的平均个体数) */
  recovery: number; meanLast2: number; hash: string;
  /** 仅在 spec.mutation 时：所有出生过的个体（含初始）的类型、代数与基因组（观察者统计，不进入个体输入） */
  genomes?: { id: string; parentId: string | null; generation: number; type: number; genes: number[] }[];
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
  const cfg = { ...semanticWorldConfig({ seed: spec.seed, options: { split: spec.split, pool: spec.pool, sensible: 6, harmCap: 1, inversion: 0, horizon: np * PHASE, drift: { everyTicks: PHASE, fraction: 1, pattern: spec.pattern, cue: spec.cue, ...(spec.flipHarm ? { flipHarm: spec.flipHarm } : {}) } } }), reproduction: true, maxAge: spec.maxAge ?? 2400, birthThreshold: spec.threshold, birthCooldown: spec.cooldown ?? 150, supplyAmount: spec.supply, initialAgents: spec.init };
  const w = new Ecology(cfg), cohorts = spec.types.map(t => make(t, spec.priors));
  const typeIndex = new Map<string, number>(); let nextRoot = 0;
  const parentOf = (id: string) => w.snapshot().lineage.find(l => l.id === id)?.parentId ?? null;
  const typeOf = (id: string): number => {
    let t = typeIndex.get(id); if (t !== undefined) return t;
    const par = parentOf(id); t = par ? typeOf(par) : (nextRoot++ % spec.types.length); typeIndex.set(id, t); return t;
  };
  const mut = spec.mutation, genomes = new Map<string, { parentId: string | null; generation: number; type: number; genes: number[] }>(), own = new Map<string, ReturnType<typeof make>>();
  const noise = (id: string, n: number): number[] => {   // 由（世界种子，个体 id）确定的高斯噪声
    let h = 2166136261 ^ spec.seed; for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    const u = () => { h = (h + 0x6d2b79f5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    return Array.from({ length: n }, () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u()));
  };
  const genomeOf = (id: string): { parentId: string | null; generation: number; type: number; genes: number[] } => {
    let g = genomes.get(id); if (g) return g;
    const par = parentOf(id);
    if (!par) g = { parentId: null, generation: 0, type: typeOf(id), genes: spec.types[typeOf(id)].genes! };
    else { const pg = genomeOf(par), z = noise(id, pg.genes.length), ci = mut!.creditIndex ?? 8; g = { parentId: par, generation: pg.generation + 1, type: pg.type, genes: pg.genes.map((x, i) => x + mut!.sigma * (i === ci ? mut!.creditScale ?? 10 : 1) * z[i]) }; }
    genomes.set(id, g); return g;
  };
  const cohortOf = (id: string) => { let c = own.get(id); if (c === undefined) { const g = genomeOf(id); c = make({ ...spec.types[g.type], genes: g.genes }, spec.priors); own.set(id, c); } return c; };
  const decide = (q: Request): Proposal => {
    const t = typeOf(q.identity.agentId);
    if (q.candidates.some(c => c.id === 'reproduce')) return { identity: q.identity, action: 'reproduce', provider: 'instinct', distribution: Object.fromEntries(q.candidates.map(c => [c.id, c.id === 'reproduce' ? 1 : 0])) };
    const c = mut ? cohortOf(q.identity.agentId) : cohorts[t]; return c ? c(q, spec.seed) : ruleProposal(q, spec.seed);
  };
  const labels = spec.types.map(t => t.label), sum = Array.from({ length: np }, () => 0), cnt = Array.from({ length: np }, () => 0), sumBy = labels.map(() => Array.from({ length: np }, () => 0));
  let extinctAt = -1;
  while (!w.done()) {
    const reqs = w.requests(); for (const q of reqs) typeOf(q.identity.agentId);
    const r = w.step(reqs.map(decide)); if (!r.accepted) throw Error(r.reason);
    const next = new Map((w.done() ? [] : w.requests()).map(q => [q.identity.agentId, q] as const));
    if (mut) { for (const o of r.outcomes!) { const c = own.get(o.agentId); if (c) c.feedback([{ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action }], next.has(o.agentId) ? new Map([[o.agentId, next.get(o.agentId)!]]) : new Map()); } }
    else cohorts.forEach((c, i) => c?.feedback(r.outcomes!.filter(o => typeIndex.get(o.agentId) === i).map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action })), next));
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
    ...(mut ? { genomes: s.lineage.map(l => ({ id: l.id, ...genomeOf(l.id) })) } : {}),
    phaseMean, phaseMeanByType, finalByType, bornByType, recovery: phaseMean[lastA] / Math.max(1, phaseMean[0]), meanLast2: (phaseMean[np - 1] + phaseMean[np - 2]) / 2, hash: String(s.tick) + ':' + s.metrics.births + ':' + s.metrics.deaths + ':' + s.agents.map(a => `${a.id}@${a.x},${a.y}/${a.energy.toFixed(3)}`).join('|') };
}
export type { SemanticFactory };
