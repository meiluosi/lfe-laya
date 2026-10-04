// 进程内评估：同一 TS 模拟器，不经 JSON 桥。每个世界是同一基因组的队列（初始个体共享先天参数，后天参数各自独立为 0）。
import { Ecology } from '../sim/ecology.ts';
import { ruleProposal, randomProposal } from '../sim/controllers.ts';
import type { Request, Proposal } from '../protocol/ecology.ts';
import { Policy } from './policy.ts';
import { extractFeatures } from './features.ts';
import { DEFAULT_LEARNER, LifetimeState, learn, stepOf, type LearnerConfig } from './learner.ts';

export const BASE = { width: 16, height: 12, initialAgents: 8, reproduction: false, mutation: false, maxAge: 100000, horizon: 3600, phaseTicks: 1200, initialEnergy: 32, metabolism: 0.012 };
// 与 experiments/ecology/difficulty-v2.json 的开发场景一致。
export const SCENARIOS = {
  moderate: { initialFood: 100, supplyAmount: 6, foodDecay: 0.003, diffusion: 0.002 },
  scarce: { initialFood: 80, supplyAmount: 4, foodDecay: 0.004, diffusion: 0.002 },
  // 语义世界：约半数食物有毒，供给据此加倍；只在训练划分上调节（见 experiments/evo/headroom-02 的说明），测试划分不参与调参。
  semantic: { initialFood: 140, supplyAmount: 14, foodDecay: 0.003, diffusion: 0 },
} as const;
export type ScenarioName = keyof typeof SCENARIOS;
export type Controller = ((request: Request, seed: number) => Proposal) & { feedback?: (outcomes: { agentId: string; reward: number; terminated: boolean; energyBefore: number; energyAfter: number; action: string }[], next: Map<string, Request>) => void };
export type WorldSpec = { scenario: ScenarioName; seed: number };
export type EvalResult = { survival: number; lowEnergy: number; energyFraction: number; living: number; fitness: number; deaths: number };

/** 适应度：幸存时间占比为主，终态队列能量占比为辅（死亡个体计 0）。仅用于进化选择，不进入任何个体的输入。 */
export const FITNESS_WEIGHTS = { survival: 0.7, energy: 0.3 };

export function runWorld(spec: WorldSpec, controller: Controller): EvalResult {
  // 学习型控制器通过 feedback 接收每个个体自己的真实反馈；规则/随机控制器没有 feedback。
  const config = { ...BASE, ...SCENARIOS[spec.scenario], seed: spec.seed, runId: `evo-${spec.scenario}-${spec.seed}` };
  const w = new Ecology(config);
  while (!w.done()) {
    const r = w.step(w.requests().map(q => controller(q, spec.seed))); if (!r.accepted) throw Error(r.reason);
    if (controller.feedback) controller.feedback(r.outcomes!.map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action })), new Map((w.done() ? [] : w.requests()).map(q => [q.identity.agentId, q])));
  }
  const s = w.snapshot(), n = config.initialAgents, cap = s.config.capacity;
  const survival = s.metrics.agentTicks / (n * config.horizon), lowEnergy = s.metrics.lowEnergyTicks / s.metrics.agentTicks;
  const energyFraction = s.agents.reduce((a, x) => a + x.energy / (cap * x.traits.size), 0) / n;
  return { survival, lowEnergy, energyFraction, living: s.agents.length, deaths: s.metrics.deaths, fitness: FITNESS_WEIGHTS.survival * survival + FITNESS_WEIGHTS.energy * energyFraction };
}
/** 队列控制器：所有个体共享同一份先天参数（只读拷贝），后天参数每个个体各自独立（出生时为 0，由终身学习更新）。 */
export type LearningCohort = Controller & { policies: Map<string, Policy>; states: Map<string, LifetimeState> };
/** 带终身学习的队列：先天参数共享（只读拷贝），后天参数与学习状态每个个体独立；只用该个体自己的反馈。 */
export const learningController = (innate: ArrayLike<number>, cfg: LearnerConfig = DEFAULT_LEARNER): LearningCohort => {
  const policies = new Map<string, Policy>(), states = new Map<string, LifetimeState>();
  const controller = Object.assign((q: Request, seed: number) => {
    const id = q.identity.agentId; let p = policies.get(id); if (!p) { p = new Policy(innate); policies.set(id, p); states.set(id, new LifetimeState()); }
    const proposal = p.propose(q, seed, null), st = states.get(id)!; st.last = stepOf(extractFeatures(q), proposal); return proposal;
  }, {
    policies, states,
    feedback: (outcomes: { agentId: string; reward: number; terminated: boolean; energyBefore: number; energyAfter: number; action: string }[], next: Map<string, Request>) => {
      for (const o of outcomes) {
        const st = states.get(o.agentId), p = policies.get(o.agentId); if (!st || !p || !st.last) continue;
        const nextRequest = o.terminated ? undefined : next.get(o.agentId);
        learn(p, st, cfg, st.last, o.reward, nextRequest ? extractFeatures(nextRequest) : null); st.last = null;
      }
    },
  });
  return controller;
};
export const policyController = (innate: ArrayLike<number>, greedy = false): Controller & { policies: Map<string, Policy> } => {
  const policies = new Map<string, Policy>();
  const controller: Controller & { policies: Map<string, Policy> } = Object.assign((q: Request, seed: number) => {
    const id = q.identity.agentId; let p = policies.get(id);
    if (!p) { p = new Policy(innate); policies.set(id, p); }
    return p.propose(q, seed, null, greedy);
  }, { policies });
  return controller;
};
export const ruleController: Controller = (q, seed) => ruleProposal(q, seed);
export const randomController: Controller = (q, seed) => randomProposal(q, seed);

export function evaluate(controller: Controller, specs: WorldSpec[]): EvalResult {
  const rs = specs.map(s => runWorld(s, controller)), mean = (k: keyof EvalResult) => rs.reduce((a, r) => a + r[k], 0) / rs.length;
  return { survival: mean('survival'), lowEnergy: mean('lowEnergy'), energyFraction: mean('energyFraction'), living: mean('living'), deaths: mean('deaths'), fitness: mean('fitness') };
}
