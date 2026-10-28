// G12：structured-benv.ts 的扩展版（benv.ts 本身是预注册 21 的冻结代码，不动）。在贝叶斯环境推断学习器上加四件事（均为开发期，非确认性）：
//  1. 传感器可靠度由个体在线估计（reliability: 'online'）：每次线索边界后记下“传感器认为是哪个环境”，经过 τc 次经历后看后验是否仍支持它
//     （后验 > .8 记一次正确，< .2 记一次错误，其间不记）；rel = (a + m·rel0)/(a + b + m)，rel0 是基因，m = 6 个伪计数。'gene' = 固定的基因值（同 benv）。
//  2. 线索句子的环境标签改为“出现后 τ 次经历”时落定（而不是下一次线索变化时）：线索缺失 / 误导时，下一次变化才打标签会把标签打错。
//  3. 思考有代价（think）：线索变化时发起一次传感器查询；ticks 个 tick 之后证据才到（delay）；rest = true 时这段时间个体什么也不做（休眠，照常耗能）。
//  4. 两种传感器矩阵：pair = LLM 对句对“是否同一类条件”的判断（cue-sim2.json，72 句：作者 36 + LLM 36）；desc = 由 LLM 对每句的结构化命名（温度 / 湿度 / 风 / 能见度 / 光线，未提及记 unknown）
//     得到的相容度（cue-sim3.json）：只提到部分属性的句子与若干环境相容，未知不惩罚。
// 基因与 benv 相同（9 + σ、h、ν、rel0、hb）。隐藏真值从不进入。
import { ruleProposal } from '../sim/controllers.ts';
import type { Proposal, Request } from '../protocol/ecology.ts';
import { filterRequest } from './filter.ts';
import type { Priors } from './semantic-run.ts';
import { NONSENSE_DEFAULT_V0 } from './sempolicy.ts';
import { decodeBenvGenes, BENV_GENES, MAX_CTX, type SensorOverride } from './structured-benv.ts';
import cueSim2 from './cue-sim2.json' with { type: 'json' };
import cueSim3 from './cue-sim3.json' with { type: 'json' };

export { BENV_GENES };
const PAIR = cueSim2 as unknown as { sentences: string[]; state: number[]; p: number[][] }, DESC = cueSim3 as unknown as { sentences: string[]; p: number[][] };
export const CUE2_STATE = PAIR.state, SENT = new Map(PAIR.sentences.map((t, i) => [t, i]));
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
type Cell = { n: number; sum: number };
type St = { tables: Map<string, Cell>[]; w: number[]; curCue?: string; cues: { idx: number; ctx: number }[]; pendLabel?: { idx: number; left: number }; check?: { claim: number; left: number }; a: number; b: number; pendEv?: { idx: number; due: number }; thinkUntil: number };
type Feedback = (o: { agentId: string; reward: number; terminated: boolean; energyBefore: number; energyAfter: number; action: string }[], next: Map<string, Request>) => void;
export type Benv2Cohort = ((q: Request, seed: number) => Proposal) & { feedback: Feedback; contexts: (id: string) => number; active: (id: string) => number; posterior: (id: string) => number[]; reliability: (id: string) => number; queries: () => number };
export type Benv2Opt = { sensor?: boolean; matrix?: 'pair' | 'desc'; sim?: SensorOverride; reliability?: 'gene' | 'online'; think?: { ticks: number; rest: boolean }; tau?: number; checkAfter?: number; pseudo?: number };
const pdf = (x: number, mu: number, sd: number) => Math.exp(-((x - mu) ** 2) / (2 * sd * sd)) / sd;
const norm = (a: number[]) => { const t = a.reduce((x, y) => x + y, 0); return t > 0 ? a.map(x => x / t) : a.map(() => 1 / a.length); };

export function structuredBenv2Cohort(genes: ArrayLike<number>, prior: 'none' | 'laya', priors: Priors, opt: Benv2Opt = {}): Benv2Cohort {
  const p = decodeBenvGenes(genes), sensor = opt.sensor !== false, M = opt.matrix === 'desc' ? DESC.p : PAIR.p, online = opt.reliability === 'online', TAU = opt.tau ?? 8, TAUC = opt.checkAfter ?? 8, PSEUDO = opt.pseudo ?? 6;
  const states = new Map<string, St>(), pending = new Map<string, { desc?: string; metabolism: number }>(); let queries = 0;
  const st = (id: string) => { let s = states.get(id); if (!s) { s = { tables: [new Map()], w: [1], cues: [], a: 0, b: 0, thinkUntil: -1 }; states.set(id, s); } return s; };
  const v0 = (d: string) => prior === 'none' ? 0 : clamp(p.scale * (priors.get(d) === undefined ? NONSENSE_DEFAULT_V0 : 2 * priors.get(d)! - 1) + p.bias, -1, 1);
  const cell = (t: Map<string, Cell>, d: string) => t.get(d) ?? { n: 0, sum: 0 };
  const pred = (t: Map<string, Cell>, d: string) => { const e = cell(t, d); return { mu: (p.trust * v0(d) + e.sum) / (p.trust + e.n), sd: p.sigma * Math.sqrt(1 + 1 / (p.trust + e.n)), n: e.n }; };
  const value = (id: string, d: string, frac: number) => { const s = st(id); let mu = 0, n = 0; s.tables.forEach((t, k) => { const q = pred(t, d); mu += s.w[k] * q.mu; n += s.w[k] * q.n; }); return mu + (n < .5 && frac < p.risk ? 0 : p.curiosity / (1 + n)); };
  const draw = (id: string, d: string, tick: number) => { let x = 2166136261; for (const ch of `${id}:${d}:${tick}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619); x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; return (x >>> 0) / 4294967296; };
  const settle = (s: St, post: number[], room: boolean) => { if (room && post[post.length - 1] > .5) { s.tables.push(new Map()); s.w = norm(post); } else s.w = norm(post.slice(0, s.tables.length)); };
  const map = (s: St) => { let m = 0; s.w.forEach((v, k) => { if (v > s.w[m]) m = k; }); return m; };
  const rel = (s: St) => online ? clamp((s.a + PSEUDO * p.rel) / (s.a + s.b + PSEUDO), .5, .99) : p.rel;
  const label = (s: St, idx: number) => { const e = s.cues.find(c => c.idx === idx); if (e) e.ctx = map(s); else s.cues.push({ idx, ctx: map(s) }); };
  const similarity = (i: number, j: number) => i === j ? 1 : opt.sim ? opt.sim(i, j) : M[i][j];
  const applyEvidence = (s: St, idx: number) => {   // 传感器证据：新句子与此前已落定标签的句子的相似度 → 各环境的似然因子
    queries++; const nC = s.tables.length, room = nC < MAX_CTX, r = rel(s), top = { v: 0 };
    const smax = s.tables.map((_, k) => { const labeled = s.cues.filter(c => c.ctx === k && c.idx !== -1); const m = Math.max(0, ...labeled.map(c => similarity(idx, c.idx))); top.v = Math.max(top.v, labeled.length ? m : 0); return labeled.length ? m : -1; });
    const slots = nC + (room ? 1 : 0), pri = Array.from({ length: slots }, (_, k) => (1 - p.boundary) * (k < nC ? s.w[k] : 0) + p.boundary / slots);   // 线索句子变了：环境很可能换了（先验），具体是哪个交给传感器
    const post = pri.map((v, k) => k < nC ? (smax[k] < 0 ? v : v * (r * smax[k] + (1 - r) * (1 - smax[k]))) : v * (r * (1 - top.v) + (1 - r) * top.v));
    settle(s, norm(post), room); s.check = { claim: map(s), left: TAUC };
  };
  const onCue = (s: St, cue: string, tick: number) => {
    const idx = SENT.get(cue); if (s.pendLabel) { label(s, s.pendLabel.idx); s.pendLabel = undefined; } s.curCue = cue; if (idx === undefined) return;
    if (!s.cues.length) { s.pendLabel = { idx, left: TAU }; return; }   // 第一条线索：没有可比较的句子
    s.pendLabel = { idx, left: TAU };
    if (opt.think && opt.think.ticks > 0) { s.pendEv = { idx, due: tick + opt.think.ticks }; s.thinkUntil = opt.think.rest ? tick + opt.think.ticks : -1; } else applyEvidence(s, idx);
  };
  const learn = (id: string, d: string, x: number) => {
    const s = st(id), nC = s.tables.length, room = nC < MAX_CTX; x = clamp(x, -1, 1);
    const pri = Array.from({ length: nC + (room ? 1 : 0) }, (_, k) => k < nC ? (1 - p.hazard) * s.w[k] + p.hazard * (1 - p.newShare) / nC : p.hazard * p.newShare);
    const post = norm(pri.map((v, k) => { if (k < nC) { const q = pred(s.tables[k], d); return v * pdf(x, q.mu, q.sd); } return v * pdf(x, v0(d), p.sigma * Math.sqrt(1 + 1 / p.trust)); }));
    settle(s, post, room);
    s.tables.forEach((t, k) => { const r = s.w[k], e = cell(t, d), keep = 1 - p.forget * r; t.set(d, { n: e.n * keep + r, sum: e.sum * keep + r * x }); });
    if (s.pendLabel && --s.pendLabel.left <= 0) { label(s, s.pendLabel.idx); s.pendLabel = undefined; }
    if (s.check && --s.check.left <= 0) { const m = s.w[s.check.claim] ?? 0; if (m > .8) s.a++; else if (m < .2) s.b++; s.check = undefined; }
  };
  const controller = ((q: Request, seed: number): Proposal => {
    const id = q.identity.agentId, tick = q.identity.tick, frac = q.observation.energy / q.observation.capacity, s = st(id);
    if (sensor && q.observation.season && q.observation.season !== s.curCue) onCue(s, q.observation.season, tick);
    if (s.pendEv && tick >= s.pendEv.due) { applyEvidence(s, s.pendEv.idx); s.pendEv = undefined; }
    if (tick < s.thinkUntil && q.candidates.some(c => c.id === 'rest')) { pending.set(id, { metabolism: 0 }); return { identity: q.identity, action: 'rest', provider: 'structured-benv2-think', distribution: Object.fromEntries(q.candidates.map(c => [c.id, c.id === 'rest' ? 1 : 0])) } as Proposal; }
    const proposal = ruleProposal(filterRequest(q, d => d === undefined || value(id, d, frac) >= p.tau || (p.retry > 0 && draw(id, d, tick) < p.retry)), seed);
    const here = q.observation.local.find(c => Math.hypot(c.dx, c.dy) < .5 && !c.blocked);
    pending.set(id, { desc: proposal.action === 'eat' ? here?.desc : undefined, metabolism: q.observation.costs.metabolismPerTick * q.observation.costs.decisionTicks });
    return { ...proposal, provider: 'structured-benv2-v1' };
  }) as Benv2Cohort;
  controller.contexts = id => st(id).tables.length; controller.posterior = id => st(id).w.slice(); controller.active = id => map(st(id)); controller.reliability = id => rel(st(id)); controller.queries = () => queries;
  controller.feedback = outcomes => { for (const o of outcomes) { const s = pending.get(o.agentId); pending.delete(o.agentId); if (!s) continue; const gain = o.energyAfter - o.energyBefore + s.metabolism; if (!Number.isFinite(gain)) continue; if (s.desc && o.action === 'eat') learn(o.agentId, s.desc, gain / 3); } };
  return controller;
}
