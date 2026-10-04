// 语义世界的评估与基线控制器。预言机（oracle）读取模拟器的隐藏真值，只用于度量“上限/余量”，不是个体可用的信息。
import { readFileSync } from 'node:fs';
import { Ecology } from '../sim/ecology.ts';
import type { SemanticKind } from '../sim/ecology.ts';
import { ruleProposal, randomProposal } from '../sim/controllers.ts';
import type { Request } from '../protocol/ecology.ts';
import { BASE, SCENARIOS, FITNESS_WEIGHTS, type Controller, type EvalResult } from './evaluate.ts';
import { semanticConfig, type SemanticOptions } from './semantic.ts';

export type SemanticSpec = { seed: number; options: SemanticOptions; scenario?: keyof typeof SCENARIOS };
export type SemanticFactory = (kinds: SemanticKind[]) => Controller;
export type Priors = Map<string, number>;

export function loadPriors(path = new URL('../../experiments/evo/laya-prior-v1.json', import.meta.url)): Priors {
  const doc = JSON.parse(readFileSync(path, 'utf8')); return new Map(Object.entries(doc.priors as Record<string, { pEat: number }>).map(([k, v]) => [k, v.pEat]));
}
export function semanticWorldConfig(spec: SemanticSpec) {
  return { ...BASE, ...SCENARIOS[spec.scenario ?? 'semantic'], ...semanticConfig(spec.seed, spec.options), seed: spec.seed, runId: `sem-${spec.options.split}-${spec.seed}` };
}
export function runSemanticWorld(spec: SemanticSpec, factory: SemanticFactory): EvalResult & { toxicBites: number } {
  const config = semanticWorldConfig(spec), w = new Ecology(config), controller = factory(config.semantic.kinds);
  let toxic = 0;
  while (!w.done()) {
    const r = w.step(w.requests().map(q => controller(q, spec.seed))); if (!r.accepted) throw Error(r.reason);
    toxic += r.events!.filter(e => e.kind === 'ate' && e.reason === 'toxic').length;
    if (controller.feedback) controller.feedback(r.outcomes!.map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action })), new Map((w.done() ? [] : w.requests()).map(q => [q.identity.agentId, q])));
  }
  const s = w.snapshot(), n = config.initialAgents, cap = s.config.capacity;
  const survival = s.metrics.agentTicks / (n * config.horizon), lowEnergy = s.metrics.lowEnergyTicks / s.metrics.agentTicks;
  const energyFraction = s.agents.reduce((a, x) => a + x.energy / (cap * x.traits.size), 0) / n;
  return { survival, lowEnergy, energyFraction, living: s.agents.length, deaths: s.metrics.deaths, toxicBites: toxic, fitness: FITNESS_WEIGHTS.survival * survival + FITNESS_WEIGHTS.energy * energyFraction };
}
/** 把不想要的食物从个体的观测里“抹掉”，再交给无语义的规则控制器。 */
export function filterRequest(q: Request, keep: (desc: string | undefined) => boolean): Request {
  const o = q.observation;
  return { ...q, observation: { ...o,
    local: o.local.map(c => (c.food > .05 && !keep(c.desc)) ? { dx: c.dx, dy: c.dy, blocked: c.blocked, food: 0 } : c),
    memory: o.memory.filter(m => keep(m.desc)) } };
}
export const blindRule: SemanticFactory = () => (q, seed) => ruleProposal(q, seed);
export const randomPolicy: SemanticFactory = () => (q, seed) => randomProposal(q, seed);
/** 用 Laya 先验的规则：只追逐 Laya 判断“可以吃”的食物（P(吃) ≥ 阈值）；未知描述按 0 处理。 */
export const layaRule = (priors: Priors, threshold = .5): SemanticFactory => () => (q, seed) => ruleProposal(filterRequest(q, d => d === undefined || (priors.get(d) ?? 0) >= threshold), seed);
/** 预言机：知道每种食物的真实影响（上限，不可用于个体）。 */
export const oracleRule: SemanticFactory = kinds => { const good = new Set(kinds.filter(k => k.factor > 0).map(k => k.description)); return (q, seed) => ruleProposal(filterRequest(q, d => d === undefined || good.has(d)), seed); };

/**
 * 手写的“探索型”终身学习控制器（上限参考，不是进化结果）：对每个个体独立维护自己的经验。
 * 先验明确好（P(吃)≥goodAt）→ 追；明确坏（<badAt）→ 避；介于其间（Laya 拿不准，如无语义词）→ 先试一口，
 * 吃过之后按自己的真实能量后果决定保留（平均后果>0）还是放弃。经验只来自该个体自己，不共享。
 */
export const explorerRule = (priors: Priors, goodAt = .5, badAt = .3): SemanticFactory => () => {
  const exp = new Map<string, Map<string, { n: number; sum: number }>>(), pending = new Map<string, { desc?: string; metabolism: number }>();
  const keepFor = (id: string) => (d: string | undefined) => {
    if (d === undefined) return true;
    const e = exp.get(id)?.get(d); if (e && e.n > 0) return e.sum / e.n > 0;
    const p = priors.get(d) ?? .36; return p >= goodAt || p >= badAt;      // 明确坏的才避开；模糊的先试
  };
  const controller = ((q: Request, seed: number) => {
    const id = q.identity.agentId, proposal = ruleProposal(filterRequest(q, keepFor(id)), seed);
    const here = q.observation.local.find(c => Math.hypot(c.dx, c.dy) < .5 && !c.blocked);
    pending.set(id, { desc: proposal.action === 'eat' ? here?.desc : undefined, metabolism: q.observation.costs.metabolismPerTick * q.observation.costs.decisionTicks });
    return proposal;
  }) as Controller;
  controller.feedback = outcomes => {
    for (const o of outcomes) {
      const p = pending.get(o.agentId); pending.delete(o.agentId); if (!p?.desc || o.action !== 'eat') continue;
      const gain = o.energyAfter - o.energyBefore + p.metabolism, m = exp.get(o.agentId) ?? new Map(); exp.set(o.agentId, m);
      const e = m.get(p.desc) ?? { n: 0, sum: 0 }; e.n++; e.sum += Math.max(-1, Math.min(1, gain / 3)); m.set(p.desc, e);
    }
  };
  return controller;
};
