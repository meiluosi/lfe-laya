// 语义世界的评估与基线控制器。预言机（oracle）读取模拟器的隐藏真值，只用于度量“上限/余量”，不是个体可用的信息。
import { readFileSync } from 'node:fs';
import { Ecology } from '../sim/ecology.ts';
import type { SemanticKind, SemanticConfig } from '../sim/ecology.ts';
import { ruleProposal, randomProposal } from '../sim/controllers.ts';
import type { Request } from '../protocol/ecology.ts';
import { BASE, SCENARIOS, FITNESS_WEIGHTS, type Controller, type EvalResult } from './evaluate.ts';
import { semanticConfig, NONSENSE_POOL, type SemanticOptions } from './semantic.ts';

export type SemanticSpec = { seed: number; options: SemanticOptions; scenario?: keyof typeof SCENARIOS };
export type SemanticFactory = (kinds: SemanticKind[], semantic?: SemanticConfig) => Controller;
export type Priors = Map<string, number>;

export function loadPriors(path = new URL('../../experiments/evo/laya-prior-v1.json', import.meta.url)): Priors {
  const doc = JSON.parse(readFileSync(path, 'utf8')); return new Map(Object.entries(doc.priors as Record<string, { pEat: number }>).map(([k, v]) => [k, v.pEat]));
}
export function semanticWorldConfig(spec: SemanticSpec) {
  return { ...BASE, ...SCENARIOS[spec.scenario ?? 'semantic'], ...semanticConfig(spec.seed, spec.options), seed: spec.seed, runId: `sem-${spec.options.split}-${spec.seed}` };
}
export function runSemanticWorld(spec: SemanticSpec, factory: SemanticFactory): EvalResult & { toxicBites: number } {
  const config = semanticWorldConfig(spec), w = new Ecology(config), controller = factory(config.semantic.kinds, config.semantic);
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
export const oracleRule: SemanticFactory = (kinds, semantic) => {
  const drift = semantic?.drift;
  return (q, seed) => {
    const flipped = !!drift && Math.floor(q.identity.tick / drift.everyTicks) % 2 === 1;
    const good = new Set(kinds.filter((k, i) => (flipped && drift!.flip.includes(i) ? -k.factor : k.factor) > 0).map(k => k.description));
    return ruleProposal(filterRequest(q, d => d === undefined || good.has(d)), seed);
  };
};

export type ExplorerOptions = {
  goodAt?: number; badAt?: number;
  /** 先验来源：laya = 缓存的 Laya；oracleNonsense = 无语义词用真值、其余用 Laya；oracleSensible = 有语义词用真值、无语义词留给探索；oracleAll = 全部真值（应等于预言机）。仅用于差距拆解。 */
  prior?: 'laya' | 'oracleNonsense' | 'oracleSensible' | 'oracleAll';
  /** 诊断：队列内共享经验（社会学习上限）。这是另一种机制（传承），不是个体学习，必须单独标注。 */
  share?: boolean;
  /** 经验的遗忘（0=不遗忘；0.1=每次新经验把旧经验权重乘 0.9）：用于环境漂移。 */
  forget?: number;
  /** 每个决策里，已被经验否决的食物以此概率被放行再试一次（让个体有机会发现环境变了）。0 = 永不重试。 */
  retry?: number;
};
export const explorerRule = (priors: Priors, opt: ExplorerOptions = {}): SemanticFactory => kinds => {
  const goodAt = opt.goodAt ?? .5, badAt = opt.badAt ?? .3, truth = new Map(kinds.map(k => [k.description, (k.factor + 1) / 2]));
  const nonsense = (d: string) => (priors.get(d) ?? .36) > .3 && (priors.get(d) ?? .36) < .45 && NONSENSE_SET.has(d);
  const priorOf = (d: string): number => {
    const mode = opt.prior ?? 'laya';
    if (mode === 'oracleAll' || (mode === 'oracleNonsense' && NONSENSE_SET.has(d)) || (mode === 'oracleSensible' && !NONSENSE_SET.has(d))) return truth.get(d) ?? .5;
    return priors.get(d) ?? .36;
  };
  void nonsense;
  const exp = new Map<string, Map<string, { n: number; sum: number }>>(), shared = new Map<string, { n: number; sum: number }>(), pending = new Map<string, { desc?: string; metabolism: number }>();
  const stat = (id: string, d: string) => opt.share ? shared.get(d) : exp.get(id)?.get(d);
  let nowTick = 0, nowId = '';
  const retryDraw = (id: string, d: string) => { let x = 2166136261; for (const ch of `${id}:${d}:${nowTick}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619); x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; return (x >>> 0) / 4294967296; };
  const keepFor = (id: string) => (d: string | undefined) => {
    if (d === undefined) return true;
    const e = stat(id, d); if (e && e.n > 0) return e.sum / e.n > 0 || (opt.retry ? retryDraw(id, d) < opt.retry : false);
    const p = priorOf(d); return p >= goodAt || p >= badAt;
  };
  const controller = ((q: Request, seed: number) => {
    nowTick = q.identity.tick; nowId = q.identity.agentId; void nowId;
    const id = q.identity.agentId, proposal = ruleProposal(filterRequest(q, keepFor(id)), seed);
    const here = q.observation.local.find(c => Math.hypot(c.dx, c.dy) < .5 && !c.blocked);
    pending.set(id, { desc: proposal.action === 'eat' ? here?.desc : undefined, metabolism: q.observation.costs.metabolismPerTick * q.observation.costs.decisionTicks });
    return proposal;
  }) as Controller;
  controller.feedback = outcomes => {
    for (const o of outcomes) {
      const p = pending.get(o.agentId); pending.delete(o.agentId); if (!p?.desc || o.action !== 'eat') continue;
      const gain = o.energyAfter - o.energyBefore + p.metabolism, x = Math.max(-1, Math.min(1, gain / 3));
      const target = opt.share ? shared : (exp.get(o.agentId) ?? (exp.set(o.agentId, new Map()), exp.get(o.agentId)!)) as Map<string, { n: number; sum: number }>;
      const e = (target as Map<string, { n: number; sum: number }>).get(p.desc) ?? { n: 0, sum: 0 };
      const keep = 1 - (opt.forget ?? 0); e.n = e.n * keep + 1; e.sum = e.sum * keep + x; (target as Map<string, { n: number; sum: number }>).set(p.desc, e);
    }
  };
  return controller;
};
const NONSENSE_SET = new Set(NONSENSE_POOL);
