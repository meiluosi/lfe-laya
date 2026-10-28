// G11c：贝叶斯环境推断学习器（docs/DESIGN_G11_DUAL_SYSTEM.md §17）。与 G11b 里手搓的引擎不同，这里用共轭模型与边缘似然：
//  - 每个环境（至多 4 个）对每个描述保存加权的（n, sum）；先验 = Laya 先验 v0(d)，强度 trust；已知观测噪声 σ（基因）。
//    结果 x 的后验预测：N(μ, σ²(1 + 1/(trust + n)))，μ = (trust·v0 + sum)/(trust + n)——证据少的表自动更不确定，不再用固定的方差。
//  - “当前处于哪个环境”的后验由前向滤波维护（隐马尔可夫：每次经历以 h 的概率换环境；换到新环境的份额 ν）；新环境的预测 = 先验预测。
//  - 信念表按后验责任软更新（不再硬分配到 MAP 表），决策用后验加权的混合预测（贝叶斯模型平均），不再是“切表”。
//  - 线索句子变化时（sensor 开）：先以边界换环境概率 hb 抬高“换了”的先验，再把缓存的 LLM 句对判断（packages/evo/cue-sim.json）折算成各环境的似然因子
//    f = rel·s + (1−rel)(1−s)，s = 新句子与该环境此前见过的句子的最大相似概率；新环境 f_new = rel(1−top) + (1−rel)top。rel 是基因（传感器可靠度，由进化决定）。
//  基因：基础 9 个（同 plain）+ σ、h、ν、rel、hb。`sensor: false` 是消融（不读线索，其余相同）。隐藏真值从不进入。
import { ruleProposal } from '../sim/controllers.ts';
import type { Proposal, Request } from '../protocol/ecology.ts';
import { filterRequest } from './filter.ts';
import type { Priors } from './semantic-run.ts';
import { NONSENSE_DEFAULT_V0 } from './sempolicy.ts';
import { decodeGenes as decodeBase, STRUCTURED_GENES as BASE_GENES, type StructuredPrior as Prior } from './structured.ts';
import cueSim from './cue-sim.json' with { type: 'json' };

export const CUE_STATE = (cueSim as unknown as { state: number[] }).state;   // 作者撰写时的状态标签，只用于对照条件（预言机）与度量
export const BAYES_GENES = BASE_GENES + 5, MAX_CTX = 4;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
export const decodeBayesGenes = (g: ArrayLike<number>) => {
  if (g.length !== BAYES_GENES) throw Error('genome_size');
  return { ...decodeBase(Array.from(g).slice(0, BASE_GENES)), sigma: clamp(g[BASE_GENES], .15, 1.5), hazard: clamp(g[BASE_GENES + 1], .001, .3), newShare: clamp(g[BASE_GENES + 2], .05, 1), rel: clamp(g[BASE_GENES + 3], .5, .99), boundary: clamp(g[BASE_GENES + 4], .05, .95) };
};
const SIM = cueSim as unknown as { sentences: string[]; p: number[][] }, SENT = new Map(SIM.sentences.map((t, i) => [t, i]));
type Cell = { n: number; sum: number };
type St = { tables: Map<string, Cell>[]; w: number[]; curCue?: string; cues: { idx: number; ctx: number }[] };
type Feedback = (o: { agentId: string; reward: number; terminated: boolean; energyBefore: number; energyAfter: number; action: string }[], next: Map<string, Request>) => void;
export type BayesCohort = ((q: Request, seed: number) => Proposal) & { feedback: Feedback; contexts: (id: string) => number; active: (id: string) => number; posterior: (id: string) => number[] };
const pdf = (x: number, mu: number, sd: number) => Math.exp(-((x - mu) ** 2) / (2 * sd * sd)) / sd;
const norm = (a: number[]) => { const t = a.reduce((x, y) => x + y, 0); return t > 0 ? a.map(x => x / t) : a.map(() => 1 / a.length); };

/** sim：传感器读数的替换（对照用）。缺省 = 缓存的 LLM 判断；预言机 / 打乱 / 取反 30% 等对照在评估脚本里构造。 */
export type SensorOverride = (i: number, j: number) => number;
export function structuredBayesCohort(genes: ArrayLike<number>, prior: Prior, priors: Priors, opt: { sensor?: boolean; sim?: SensorOverride } = {}): BayesCohort {
  const p = decodeBayesGenes(genes), sensor = opt.sensor !== false, states = new Map<string, St>(), pending = new Map<string, { desc?: string; metabolism: number }>();
  const st = (id: string) => { let s = states.get(id); if (!s) { s = { tables: [new Map()], w: [1], cues: [] }; states.set(id, s); } return s; };
  const v0 = (d: string) => prior === 'none' ? 0 : clamp(p.scale * (priors.get(d) === undefined ? NONSENSE_DEFAULT_V0 : 2 * priors.get(d)! - 1) + p.bias, -1, 1);
  const cell = (t: Map<string, Cell>, d: string) => t.get(d) ?? { n: 0, sum: 0 };
  const pred = (t: Map<string, Cell>, d: string) => { const e = cell(t, d); return { mu: (p.trust * v0(d) + e.sum) / (p.trust + e.n), sd: p.sigma * Math.sqrt(1 + 1 / (p.trust + e.n)), n: e.n }; };
  const value = (id: string, d: string, frac: number) => { const s = st(id); let mu = 0, n = 0; s.tables.forEach((t, k) => { const q = pred(t, d); mu += s.w[k] * q.mu; n += s.w[k] * q.n; }); return mu + (n < .5 && frac < p.risk ? 0 : p.curiosity / (1 + n)); };
  const draw = (id: string, d: string, tick: number) => { let x = 2166136261; for (const ch of `${id}:${d}:${tick}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619); x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; return (x >>> 0) / 4294967296; };
  /** 把（含“新环境”一项的）后验落实：新环境占多数且有空位 → 新开一张空表；否则只保留已有环境并归一化 */
  const settle = (s: St, post: number[], room: boolean) => { if (room && post[post.length - 1] > .5) { s.tables.push(new Map()); s.w = norm(post); } else s.w = norm(post.slice(0, s.tables.length)); };
  const boundary = (s: St, cue: string) => {   // 线索句子变了
    const idx = SENT.get(cue); const prevCue = s.curCue, prevIdx = prevCue === undefined ? undefined : SENT.get(prevCue); s.curCue = cue; if (idx === undefined || prevIdx === undefined) return;
    let map = 0; s.w.forEach((v, k) => { if (v > s.w[map]) map = k; }); const e = s.cues.find(c => c.idx === prevIdx); if (e) e.ctx = map; else s.cues.push({ idx: prevIdx, ctx: map });
    const prev = s.cues.filter(c => c.idx !== idx); if (!prev.length && !s.cues.some(c => c.idx === idx)) return;
    const nC = s.tables.length, room = nC < MAX_CTX, slots = nC + (room ? 1 : 0), top = { v: 0 };
    const smax = s.tables.map((_, k) => { const m = Math.max(0, ...s.cues.filter(c => c.ctx === k).map(c => c.idx === idx ? 1 : (opt.sim ? opt.sim(idx, c.idx) : SIM.p[idx][c.idx]))); top.v = Math.max(top.v, m); return s.cues.some(c => c.ctx === k) ? m : -1; });
    const pri = Array.from({ length: slots }, (_, k) => ((1 - p.boundary) * (k < nC ? s.w[k] : 0)) + p.boundary / slots);
    const post = pri.map((v, k) => k < nC ? (smax[k] < 0 ? v : v * (p.rel * smax[k] + (1 - p.rel) * (1 - smax[k]))) : v * (p.rel * (1 - top.v) + (1 - p.rel) * top.v));
    settle(s, norm(post), room);
  };
  const learn = (id: string, d: string, x: number) => {
    const s = st(id), nC = s.tables.length, room = nC < MAX_CTX; x = clamp(x, -1, 1);
    const pri = Array.from({ length: nC + (room ? 1 : 0) }, (_, k) => k < nC ? (1 - p.hazard) * s.w[k] + p.hazard * (1 - p.newShare) / nC : p.hazard * p.newShare);
    const post = norm(pri.map((v, k) => { if (k < nC) { const q = pred(s.tables[k], d); return v * pdf(x, q.mu, q.sd); } return v * pdf(x, v0(d), p.sigma * Math.sqrt(1 + 1 / p.trust)); }));
    settle(s, post, room);
    s.tables.forEach((t, k) => { const r = s.w[k], e = cell(t, d), keep = 1 - p.forget * r; t.set(d, { n: e.n * keep + r, sum: e.sum * keep + r * x }); });
  };
  const controller = ((q: Request, seed: number): Proposal => {
    const id = q.identity.agentId, tick = q.identity.tick, frac = q.observation.energy / q.observation.capacity;
    if (sensor && q.observation.season) boundary(st(id), q.observation.season);
    const proposal = ruleProposal(filterRequest(q, d => d === undefined || value(id, d, frac) >= p.tau || (p.retry > 0 && draw(id, d, tick) < p.retry)), seed);
    const here = q.observation.local.find(c => Math.hypot(c.dx, c.dy) < .5 && !c.blocked);
    pending.set(id, { desc: proposal.action === 'eat' ? here?.desc : undefined, metabolism: q.observation.costs.metabolismPerTick * q.observation.costs.decisionTicks });
    return { ...proposal, provider: sensor ? 'structured-bayes-v1' : 'structured-bayes-off-v1' };
  }) as BayesCohort;
  controller.contexts = id => st(id).tables.length; controller.posterior = id => st(id).w.slice();
  controller.active = id => { const s = st(id); let m = 0; s.w.forEach((v, k) => { if (v > s.w[m]) m = k; }); return m; };
  controller.feedback = outcomes => {
    for (const o of outcomes) {
      const s = pending.get(o.agentId); pending.delete(o.agentId); if (!s) continue;
      const gain = o.energyAfter - o.energyBefore + s.metabolism; if (!Number.isFinite(gain)) continue;
      if (s.desc && o.action === 'eat') learn(o.agentId, s.desc, gain / 3);
    }
  };
  return controller;
}
