// 终身学习（后天）：线性 actor-critic + 资格迹，只更新该个体自己的后天参数（策略修正 A 与价值权重 w）。
// 先天参数（基因组）只读。学习只使用该个体真实获得的反馈：自己的特征、自己的动作、自己的能量变化奖励。
// 样本高效是首要目标：参数很少、在线更新、带向 0 的衰减，使个体一生内不会偏离先天策略太远。
import { ACTIONS } from '../protocol/ecology.ts';
import type { Proposal } from '../protocol/ecology.ts';
import { N_FEATURES } from './features.ts';
import { ACQUIRED_SIZE, N_ACTIONS, type Policy } from './policy.ts';

export type LearnerConfig = { alphaActor: number; alphaCritic: number; gamma: number; lambda: number; l2: number; clipParam: number; clipTd: number; frozen?: boolean };
export const DEFAULT_LEARNER: LearnerConfig = { alphaActor: 0.05, alphaCritic: 0.1, gamma: 0.95, lambda: 0.8, l2: 0.002, clipParam: 4, clipTd: 2 };

export type Step = { x: Float64Array; probs: Float64Array; action: number };
/** 单个体的后天状态：价值权重与资格迹。不与任何其他个体共享。 */
export class LifetimeState {
  readonly critic = new Float64Array(N_FEATURES);
  readonly traceActor = new Float64Array(ACQUIRED_SIZE);
  readonly traceCritic = new Float64Array(N_FEATURES);
  updates = 0; rejected = 0; last: Step | null = null;
}

/** 把已发出的提案转成一步经历（动作下标 + 合法动作上的概率）。 */
export function stepOf(x: Float64Array, proposal: Proposal): Step {
  const probs = new Float64Array(N_ACTIONS); for (const [a, p] of Object.entries(proposal.distribution ?? {})) probs[ACTIONS.indexOf(a as never)] = p as number;
  return { x, probs, action: ACTIONS.indexOf(proposal.action) };
}
const dot = (w: Float64Array, x: Float64Array) => { let s = 0; for (let i = 0; i < x.length; i++) s += w[i] * x[i]; return s; };

/**
 * 一次时序差分更新：prev 是上一步经历，reward 是该决策真实得到的能量变化奖励，next 是下一步观察到的特征（死亡/终止时为 null）。
 * 返回 TD 误差；输入含非有限数时整次更新被拒绝，不改变任何参数。
 */
export function learn(policy: Policy, state: LifetimeState, cfg: LearnerConfig, prev: Step, reward: number, next: Float64Array | null): number | null {
  if (cfg.frozen) return null;
  if (!Number.isFinite(reward) || !prev.x.every(Number.isFinite) || (next && !next.every(Number.isFinite))) { state.rejected++; return null; }
  const v = dot(state.critic, prev.x), vNext = next ? dot(state.critic, next) : 0;
  const td = Math.max(-cfg.clipTd, Math.min(cfg.clipTd, reward + cfg.gamma * vNext - v)), decay = cfg.gamma * cfg.lambda;
  for (let i = 0; i < N_FEATURES; i++) state.traceCritic[i] = decay * state.traceCritic[i] + prev.x[i];
  for (let a = 0; a < N_ACTIONS; a++) {
    const g = (a === prev.action ? 1 : 0) - prev.probs[a];
    for (let i = 0; i < N_FEATURES; i++) state.traceActor[a * N_FEATURES + i] = decay * state.traceActor[a * N_FEATURES + i] + g * prev.x[i];
  }
  for (let i = 0; i < N_FEATURES; i++) state.critic[i] += cfg.alphaCritic * td * state.traceCritic[i];
  for (let j = 0; j < ACQUIRED_SIZE; j++) {
    const nv = policy.acquired[j] * (1 - cfg.l2) + cfg.alphaActor * td * state.traceActor[j];
    policy.acquired[j] = Math.max(-cfg.clipParam, Math.min(cfg.clipParam, nv));
  }
  if (!next) { state.traceActor.fill(0); state.traceCritic.fill(0); }   // 一生结束：清除资格迹
  state.updates++; return td;
}
