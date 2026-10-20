// 蒸馏先验（预注册 12 / 点子 #13）：把固定 Laya 对训练方言描述的缓存判断 P(eat) 回归到其编码器的 32 维嵌入上（岭回归，λ=1，概率目标，含偏置），
// 得到一个固定的线性读出；之后任何方言的描述只要有缓存嵌入，就由该读出给出先验 p̂ = clamp(w·e + b)。只用文本与 Laya 的缓存判断，不用任何隐藏标签。
// 拟合在设计时完成一次（确定性），不在个体一生内更新，也不被进化修改；个体与 laya 个体共用同一套基因，只是先验来源不同。
import { loadLayaPriors, loadEmbeddings, registerPools } from './pools.ts';
import type { Priors } from './pools.ts';

export const DISTILL_LAMBDA = 1, D = 32;
let head: number[] | null = null;
export function fitHead(): number[] {
  if (head) return head;
  const pri = loadLayaPriors('train'), emb = loadEmbeddings('train'), pool = (registerPools() as Record<string, { text: string }[] | undefined>).train ?? [];
  const n = D + 1, A = Array.from({ length: n }, () => new Array(n).fill(0)), b = new Array(n).fill(0); let used = 0;
  for (const e of pool) { const p = pri.get(e.text), v = emb.get(e.text); if (p === undefined || !v) continue; used++; const x = [...Array.from(v), 1]; for (let i = 0; i < n; i++) { b[i] += x[i] * p; for (let j = 0; j < n; j++) A[i][j] += x[i] * x[j]; } }
  if (used === 0) throw Error('distill_no_training_data');
  for (let i = 0; i < D; i++) A[i][i] += DISTILL_LAMBDA;
  for (let i = 0; i < n; i++) { let m = i; for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[m][i])) m = k; [A[i], A[m]] = [A[m], A[i]]; [b[i], b[m]] = [b[m], b[i]]; for (let k = i + 1; k < n; k++) { const f = A[k][i] / A[i][i]; for (let j = i; j < n; j++) A[k][j] -= f * A[i][j]; b[k] -= f * b[i]; } }
  const w = new Array(n).fill(0); for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let j = i + 1; j < n; j++) s -= A[i][j] * w[j]; w[i] = s / A[i][i]; }
  return head = w;
}
/** 某方言所有有缓存嵌入的描述 → 蒸馏先验。 */
export function distilledPrior(dialect: string): Priors {
  const w = fitHead(), emb = loadEmbeddings(dialect as 'train'), out: Priors = new Map<string, number>();
  for (const [text, v] of emb) { let s = w[D]; for (let i = 0; i < D; i++) s += w[i] * v[i]; out.set(text, Math.min(.999, Math.max(.001, s))); }
  return out;
}
