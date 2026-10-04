// 语义世界里的决策层：先天 MLP（基因组，可遗传）+ 个体一生内的“食物价值信念”（后天，不遗传、不共享）。
// 系统 1（固定 Laya）给出对描述词的先验价值 v0；个体用自己吃过之后的真实后果更新：v = (n0·v0 + Σx)/(n0 + n)。
// n0 是先天的“对系统 1 的信任强度”（基因）。没有先验时 v0 = 0；关闭终身学习时 v = v0。
import type { Action, Proposal, Request } from '../protocol/ecology.ts';
import { ACTIONS } from '../protocol/ecology.ts';
import { uniform } from './policy.ts';
import type { Priors } from './semantic-run.ts';

/** prior='oracle' 仅用于容量诊断：把真实 factor 当作先验，检验策略结构/进化能否利用完美信息。个体永远拿不到这个信息。 */
export type SemCondition = { prior: 'none' | 'laya' | 'oracle'; learning: boolean };
export const SEM_HIDDEN = 10, N_ACTIONS = ACTIONS.length, SECTORS = 4, PER_SECTOR = 5, N_BASE = 7, N_SEM_FEATURES = N_BASE + SECTORS * PER_SECTOR;
export const SEM_INNATE_SIZE_V1 = SEM_HIDDEN * N_SEM_FEATURES + SEM_HIDDEN + N_ACTIONS * SEM_HIDDEN + N_ACTIONS + 2;   // 旧版：... + logTemperature + logTrust
/** 当前版本再加一个先天基因：好奇心（对没吃过的食物的探索加成，随经验衰减）。旧版基因组（长度 SEM_INNATE_SIZE_V1）仍可加载，好奇心视为 0。 */
export const SEM_INNATE_SIZE = SEM_INNATE_SIZE_V1 + 1;
const TEMP_IDX = SEM_INNATE_SIZE_V1 - 2, TRUST_IDX = SEM_INNATE_SIZE_V1 - 1, CURIOSITY_IDX = SEM_INNATE_SIZE_V1;
export const NONSENSE_DEFAULT_V0 = 2 * 0.36 - 1;                                                              // 表中没有的描述词：Laya 对无语义词的典型回答
const sectorOf = (dx: number, dy: number): number => Math.abs(dy) >= Math.abs(dx) ? (dy < 0 ? 0 : 2) : (dx > 0 ? 1 : 3);

/** 个体的食物价值信念。经验只来自它自己吃过之后的能量变化。 */
export class FoodBeliefs {
  readonly experience = new Map<string, { n: number; sum: number }>();
  readonly cond: SemCondition; readonly priors: Priors; readonly trust: number; readonly curiosity: number;
  constructor(cond: SemCondition, priors: Priors, trust: number, curiosity = 0) { this.cond = cond; this.priors = priors; this.trust = trust; this.curiosity = curiosity; }
  prior(desc: string): number { if (this.cond.prior === 'none') return 0; const p = this.priors.get(desc); return p === undefined ? NONSENSE_DEFAULT_V0 : 2 * p - 1; }
  value(desc: string | undefined): number {
    if (desc === undefined) return .5;                          // 非语义食物：视为中性偏好
    const v0 = this.prior(desc); if (!this.cond.learning) return v0;
    const e = this.experience.get(desc), base = e ? (this.trust * v0 + e.sum) / (this.trust + e.n) : v0;
    return base + this.curiosity / (1 + (e?.n ?? 0));          // 好奇心：没试过的食物有加成，试得越多越小（只在终身学习开启时有意义）
  }
  record(desc: string, x: number): void { const e = this.experience.get(desc) ?? { n: 0, sum: 0 }; e.n++; e.sum += x; this.experience.set(desc, e); }
}

export function semanticFeatures(request: Request, beliefs: FoodBeliefs): Float64Array {
  const o = request.observation, f = new Float64Array(N_SEM_FEATURES), ids = new Set(request.candidates.map(c => c.id));
  const pos = new Float64Array(SECTORS), neg = new Float64Array(SECTORS), nearest = new Float64Array(SECTORS).fill(Infinity), wall = new Float64Array(SECTORS), mem = new Float64Array(SECTORS);
  let hereFood = 0, hereValue = 0;
  for (const c of o.local) {
    const d = Math.hypot(c.dx, c.dy);
    if (d < .5) { if (!c.blocked && c.food > 0) { hereFood = c.food; hereValue = beliefs.value(c.desc); } continue; }
    const s = sectorOf(c.dx, c.dy);
    if (c.blocked) { if (d <= 1.2) wall[s] = 1; continue; }
    if (c.food < .02) continue;
    const v = beliefs.value(c.desc), w = c.food / (1 + d);
    if (v > 0) { pos[s] += w * v; if (c.food >= .05 && d < nearest[s]) nearest[s] = d; } else neg[s] += w * -v;
  }
  for (const m of o.memory) { const d = Math.hypot(m.dx, m.dy); if (d < .5) continue; const v = beliefs.value(m.desc); if (v > 0) mem[sectorOf(m.dx, m.dy)] += m.food * v * Math.exp(-m.stepsAgo / 300) / (1 + d); }
  const frac = o.energy / o.capacity;
  f[0] = frac; f[1] = frac < .3 ? 1 : 0; f[2] = ids.has('eat') ? 1 : 0; f[3] = Math.min(4, o.neighbors.length) / 4; f[4] = o.lastRejected ? 1 : 0; f[5] = Math.tanh(hereFood / 2); f[6] = hereValue;
  for (let s = 0; s < SECTORS; s++) {
    const b = N_BASE + s * PER_SECTOR;
    f[b] = Math.tanh(pos[s] / 2); f[b + 1] = Math.tanh(neg[s] / 2); f[b + 2] = Number.isFinite(nearest[s]) ? 1 / (1 + nearest[s]) : 0; f[b + 3] = wall[s]; f[b + 4] = Math.tanh(mem[s] / 2);
  }
  return f;
}

/** 先天 MLP：logits = W2·tanh(W1·x + b1) + b2。 */
export function semLogits(theta: ArrayLike<number>, x: Float64Array): Float64Array {
  const w1 = 0, b1 = SEM_HIDDEN * N_SEM_FEATURES, w2 = b1 + SEM_HIDDEN, b2 = w2 + N_ACTIONS * SEM_HIDDEN, out = new Float64Array(N_ACTIONS), h = new Float64Array(SEM_HIDDEN);
  for (let j = 0; j < SEM_HIDDEN; j++) { let s = theta[b1 + j]; for (let i = 0; i < N_SEM_FEATURES; i++) s += theta[w1 + j * N_SEM_FEATURES + i] * x[i]; h[j] = Math.tanh(s); }
  for (let a = 0; a < N_ACTIONS; a++) { let s = theta[b2 + a]; for (let j = 0; j < SEM_HIDDEN; j++) s += theta[w2 + a * SEM_HIDDEN + j] * h[j]; out[a] = s; }
  return out;
}
export const semTemperature = (theta: ArrayLike<number>) => Math.exp(Math.max(-3, Math.min(2, theta[TEMP_IDX])));
export const semTrust = (theta: ArrayLike<number>) => Math.exp(Math.max(-2, Math.min(4, theta[TRUST_IDX])));
export const semCuriosity = (theta: ArrayLike<number>) => theta.length > SEM_INNATE_SIZE_V1 ? Math.max(0, Math.min(1.5, theta[CURIOSITY_IDX])) : 0;

export type SemCohort = ((q: Request, seed: number) => Proposal) & { feedback: (o: { agentId: string; reward: number; terminated: boolean; energyBefore: number; energyAfter: number; action: string }[], next: Map<string, Request>) => void; beliefs: Map<string, FoodBeliefs> };
/** 队列：先天参数共享（只读），信念各个体独立。 */
export function semanticCohort(innate: ArrayLike<number>, cond: SemCondition, priors: Priors, greedy = false): SemCohort {
  if (innate.length !== SEM_INNATE_SIZE && innate.length !== SEM_INNATE_SIZE_V1) throw Error('innate_size');
  const theta = Float64Array.from(innate), beliefs = new Map<string, FoodBeliefs>(), pending = new Map<string, { desc?: string; metabolism: number }>();
  const controller = (q: Request, seed: number): Proposal => {
    const id = q.identity.agentId; let b = beliefs.get(id); if (!b) { b = new FoodBeliefs(cond, priors, semTrust(theta), semCuriosity(theta)); beliefs.set(id, b); }
    const x = semanticFeatures(q, b), z = semLogits(theta, x), T = semTemperature(theta);
    const legal = q.candidates.map(c => c.id as Action), idx = legal.map(a => ACTIONS.indexOf(a)), m = Math.max(...idx.map(i => z[i] / T)), w = idx.map(i => Math.exp(z[i] / T - m)), total = w.reduce((a, c) => a + c, 0);
    let choice = 0; if (greedy) choice = w.indexOf(Math.max(...w)); else { let u = uniform(seed, id, q.identity.tick) * total; for (; choice < w.length - 1; choice++) { u -= w[choice]; if (u <= 0) break; } }
    const distribution: Partial<Record<Action, number>> = {}; legal.forEach((a, i) => { distribution[a] = w[i] / total; });
    const here = q.observation.local.find(c => Math.hypot(c.dx, c.dy) < .5 && !c.blocked);
    pending.set(id, { desc: legal[choice] === 'eat' ? here?.desc : undefined, metabolism: q.observation.costs.metabolismPerTick * q.observation.costs.decisionTicks });
    return { identity: q.identity, action: legal[choice], provider: 'evolved-semantic-v1', distribution };
  };
  const feedback: SemCohort['feedback'] = outcomes => {
    for (const o of outcomes) {
      const p = pending.get(o.agentId), b = beliefs.get(o.agentId); pending.delete(o.agentId);
      if (!p || !b || !p.desc || o.action !== 'eat') continue;
      const gain = o.energyAfter - o.energyBefore + p.metabolism;              // 吃下去的净能量变化（扣除这一决策里本来就要付的代谢）
      if (Number.isFinite(gain)) b.record(p.desc, Math.max(-1, Math.min(1, gain / 3)));
    }
  };
  return Object.assign(controller, { feedback, beliefs });
}
