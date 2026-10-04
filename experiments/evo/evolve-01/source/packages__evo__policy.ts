// 决策层策略：先天参数（基因组，可遗传）与后天参数（个体一生内学习，默认不遗传）严格分开。
// logits = 先天 MLP(特征) + 后天线性修正(特征)。后天参数初始为 0，本切片只读取、不更新（终身学习在 E3 实现）。
import { ACTIONS, type Action, type Proposal, type Request } from '../protocol/ecology.ts';
import { N_FEATURES, extractFeatures } from './features.ts';

export const HIDDEN = 10, N_ACTIONS = ACTIONS.length;
export const INNATE_SIZE = HIDDEN * N_FEATURES + HIDDEN + N_ACTIONS * HIDDEN + N_ACTIONS + 1;   // W1,b1,W2,b2,logTemperature
export const ACQUIRED_SIZE = N_ACTIONS * N_FEATURES;                                              // 线性修正 A（仅后天）

export function uniform(seed: number, agentId: string, tick: number, slot = 0): number {
  let x = 2166136261; for (const ch of `${seed}:policy:${agentId}:${tick}:${slot}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16; return (x >>> 0) / 4294967296;
}

export class Policy {
  readonly innate: Float64Array;
  readonly acquired: Float64Array;
  constructor(innate: ArrayLike<number>, acquired?: ArrayLike<number>) {
    if (innate.length !== INNATE_SIZE) throw Error('innate_size');
    this.innate = Float64Array.from(innate); this.acquired = acquired ? Float64Array.from(acquired) : new Float64Array(ACQUIRED_SIZE);
    if (this.acquired.length !== ACQUIRED_SIZE) throw Error('acquired_size');
  }
  /** 所有 7 个动作的原始 logits（未做合法性屏蔽）。 */
  logits(x: Float64Array): Float64Array {
    const w1 = 0, b1 = HIDDEN * N_FEATURES, w2 = b1 + HIDDEN, b2 = w2 + N_ACTIONS * HIDDEN, th = this.innate, out = new Float64Array(N_ACTIONS), h = new Float64Array(HIDDEN);
    for (let j = 0; j < HIDDEN; j++) { let s = th[b1 + j]; for (let i = 0; i < N_FEATURES; i++) s += th[w1 + j * N_FEATURES + i] * x[i]; h[j] = Math.tanh(s); }
    for (let a = 0; a < N_ACTIONS; a++) {
      let s = th[b2 + a]; for (let j = 0; j < HIDDEN; j++) s += th[w2 + a * HIDDEN + j] * h[j];
      for (let i = 0; i < N_FEATURES; i++) s += this.acquired[a * N_FEATURES + i] * x[i];
      out[a] = s;
    }
    return out;
  }
  temperature(): number { return Math.exp(Math.max(-3, Math.min(2, this.innate[INNATE_SIZE - 1]))); }
  /** 在合法候选上按 softmax(logits/T) 采样；随机数由 (seed, 个体, 时刻) 决定，保证可复现。 */
  propose(request: Request, seed: number, percept?: readonly number[] | null, greedy = false): Proposal {
    const x = extractFeatures(request, percept), z = this.logits(x), T = this.temperature();
    const legal = request.candidates.map(c => c.id as Action), idx = legal.map(a => ACTIONS.indexOf(a));
    const m = Math.max(...idx.map(i => z[i] / T)), w = idx.map(i => Math.exp(z[i] / T - m)), total = w.reduce((a, b) => a + b, 0);
    let choice = 0;
    if (greedy) choice = w.indexOf(Math.max(...w));
    else { let u = uniform(seed, request.identity.agentId, request.identity.tick) * total; for (; choice < w.length - 1; choice++) { u -= w[choice]; if (u <= 0) break; } }
    const distribution: Partial<Record<Action, number>> = {}; legal.forEach((a, i) => { distribution[a] = w[i] / total; });
    return { identity: request.identity, action: legal[choice], provider: 'evolved-policy-v1', distribution };
  }
}
