// G13：层级可靠度 + 多条线索通道的贝叶斯环境推断学习器（structured-benv.ts / structured-benv2.ts 不动）。设计：docs/DESIGN_G13_CUE_RELIABILITY.md。
//  - 每条通道 c 有自己的可靠度 ρ_c：先天给 Beta 先验（均值 rel0、强度 S，都是基因，由进化决定），一生内用一致性证据更新：每次线索边界后记下该通道认为的环境（claim），
//    边界后遇到的前 3 种不同食物（每种只取第一次）：用各个已有环境、以及“全新先验”对这次结果的预测似然（预测在更新信念之前做出；这些食物在这个阶段还没被吃过，
//    所以环境表里的是它在此前同类环境里学到的知识——这正是检验“现在是不是那个环境”的证据）累加对数似然；最大者领先超过 1 才计数：它就是线索指向的环境（claim）→ 记一次正确（a），否则记一次错误（b）。
//    ρ_c = (a + S·rel0)/(a + b + S)，限制在 [0.5, 0.99]（0.5 = 完全不可靠，线索因子恒等于 0.5，相当于被遗弃）；online = false 时 ρ_c = rel0（只有先天）。
//  - 线索句子的环境标签在出现后 8 次经历落定（不是下一次变化时）；通道缺失时沿用最后一句。
//  - 传感器 = LLM 对每句线索的结构化命名得到的相容度（cue-sim3.json，似然比校准，覆盖作者句与 LLM 句共 72 句）。
//  基因：基础 9 + σ、h、ν、hb、rel0、S = 15 个。channels = 1 只读第一通道（没有第二感官的物种）；sensor = false 只用数值证据。隐藏真值从不进入。
import { ruleProposal } from '../sim/controllers.ts';
import type { Proposal, Request } from '../protocol/ecology.ts';
import { filterRequest } from './filter.ts';
import type { Priors } from './semantic-run.ts';
import { NONSENSE_DEFAULT_V0 } from './sempolicy.ts';
import { decodeGenes as decodeBase, STRUCTURED_GENES as BASE_GENES } from './structured.ts';
import { MAX_CTX } from './structured-benv.ts';
import cueSim3 from './cue-sim3.json' with { type: 'json' };

export const BENV3_GENES = BASE_GENES + 6;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
export const decodeBenv3Genes = (g: ArrayLike<number>) => {
  if (g.length !== BENV3_GENES) throw Error('genome_size');
  return { ...decodeBase(Array.from(g).slice(0, BASE_GENES)), sigma: clamp(g[BASE_GENES], .15, 1.5), hazard: clamp(g[BASE_GENES + 1], .001, .3), newShare: clamp(g[BASE_GENES + 2], .05, 1), boundary: clamp(g[BASE_GENES + 3], .05, .95), rel0: clamp(g[BASE_GENES + 4], .5, .99), strength: clamp(g[BASE_GENES + 5], 1, 40) };
};
const SIM = cueSim3 as unknown as { sentences: string[]; state: number[]; p: number[][] }, SENT = new Map(SIM.sentences.map((t, i) => [t, i]));
type Cell = { n: number; sum: number };
type Chan = { curCue?: string; cues: { idx: number; ctx: number }[]; pendLabel?: { idx: number; left: number }; check?: { claim: number; slots: number; nOld: number; seen: Set<string>; L: number[]; left: number }; a: number; b: number };
type St = { tables: Map<string, Cell>[]; w: number[]; ch: [Chan, Chan] };
type Feedback = (o: { agentId: string; reward: number; terminated: boolean; energyBefore: number; energyAfter: number; action: string }[], next: Map<string, Request>) => void;
export type Benv3Cohort = ((q: Request, seed: number) => Proposal) & { feedback: Feedback; contexts: (id: string) => number; active: (id: string) => number; posterior: (id: string) => number[]; reliability: (id: string, channel: 0 | 1) => number };
export type Benv3Opt = { sensor?: boolean; channels?: 1 | 2; online?: boolean; tau?: number; checkAfter?: number };
const pdf = (x: number, mu: number, sd: number) => Math.exp(-((x - mu) ** 2) / (2 * sd * sd)) / sd;
const norm = (a: number[]) => { const t = a.reduce((x, y) => x + y, 0); return t > 0 ? a.map(x => x / t) : a.map(() => 1 / a.length); };

export function structuredBenv3Cohort(genes: ArrayLike<number>, prior: 'none' | 'laya', priors: Priors, opt: Benv3Opt = {}): Benv3Cohort {
  const p = decodeBenv3Genes(genes), sensor = opt.sensor !== false, nCh = opt.channels ?? 1, online = opt.online === true, TAU = opt.tau ?? 8, TAUC = opt.checkAfter ?? 8;
  const states = new Map<string, St>(), pending = new Map<string, { desc?: string; metabolism: number }>();
  const fresh = (): Chan => ({ cues: [], a: 0, b: 0 }), st = (id: string) => { let s = states.get(id); if (!s) { s = { tables: [new Map()], w: [1], ch: [fresh(), fresh()] }; states.set(id, s); } return s; };
  const v0 = (d: string) => prior === 'none' ? 0 : clamp(p.scale * (priors.get(d) === undefined ? NONSENSE_DEFAULT_V0 : 2 * priors.get(d)! - 1) + p.bias, -1, 1);
  const cell = (t: Map<string, Cell>, d: string) => t.get(d) ?? { n: 0, sum: 0 };
  const pred = (t: Map<string, Cell>, d: string) => { const e = cell(t, d); return { mu: (p.trust * v0(d) + e.sum) / (p.trust + e.n), sd: p.sigma * Math.sqrt(1 + 1 / (p.trust + e.n)), n: e.n }; };
  const value = (id: string, d: string, frac: number) => { const s = st(id); let mu = 0, n = 0; s.tables.forEach((t, k) => { const q = pred(t, d); mu += s.w[k] * q.mu; n += s.w[k] * q.n; }); return mu + (n < .5 && frac < p.risk ? 0 : p.curiosity / (1 + n)); };
  const draw = (id: string, d: string, tick: number) => { let x = 2166136261; for (const ch of `${id}:${d}:${tick}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619); x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; return (x >>> 0) / 4294967296; };
  const settle = (s: St, post: number[], room: boolean) => { if (room && post[post.length - 1] > .5) { s.tables.push(new Map()); s.w = norm(post); } else s.w = norm(post.slice(0, s.tables.length)); };
  const map = (s: St) => { let m = 0; s.w.forEach((v, k) => { if (v > s.w[m]) m = k; }); return m; };
  const rel = (c: Chan) => online ? clamp((c.a + p.strength * p.rel0) / (c.a + c.b + p.strength), .5, .99) : p.rel0;
  const label = (s: St, c: Chan, idx: number) => { const e = c.cues.find(x => x.idx === idx); if (e) e.ctx = map(s); else c.cues.push({ idx, ctx: map(s) }); };
  /** 一条通道的线索变了：返回它对各环境（含“新环境”）的似然因子；没有可比较的句子返回 null */
  const factors = (s: St, c: Chan, idx: number, slots: number, pri: number[]) => {
    const nC = s.tables.length, r = rel(c); let top = 0;
    const smax = s.tables.map((_, k) => { const labeled = c.cues.filter(x => x.ctx === k); const m = Math.max(0, ...labeled.map(x => x.idx === idx ? 1 : SIM.p[idx][x.idx])); top = Math.max(top, labeled.length ? m : 0); return labeled.length ? m : -1; });
    if (!c.cues.length) return null;
    return Array.from({ length: slots }, (_, k) => k < nC ? (smax[k] < 0 ? 1 : r * smax[k] + (1 - r) * (1 - smax[k])) : r * (1 - top) + (1 - r) * top).map((f, k) => ({ f, claimScore: pri[k] * f }));
  };
  const onSeason = (s: St, season: string) => {
    const parts = season.includes('||') ? season.split('||') : [season, ''], changed: { c: Chan; idx: number }[] = [];
    for (let ci = 0; ci < nCh; ci++) { const text = parts[ci]; if (!text) continue; const c = s.ch[ci]; if (text === c.curCue) continue; if (c.pendLabel) { label(s, c, c.pendLabel.idx); c.pendLabel = undefined; } c.curCue = text; const idx = SENT.get(text); if (idx === undefined) continue; changed.push({ c, idx }); }
    if (!changed.length) return;
    const nC = s.tables.length, room = nC < MAX_CTX, slots = nC + (room ? 1 : 0), pri = Array.from({ length: slots }, (_, k) => (1 - p.boundary) * (k < nC ? s.w[k] : 0) + p.boundary / slots);
    const fused = pri.slice(); let any = false;
    for (const { c, idx } of changed) { const fs = factors(s, c, idx, slots, pri); if (fs) { any = true; fs.forEach((x, k) => { fused[k] *= x.f; }); let best = 0; fs.forEach((x, k) => { if (x.claimScore > fs[best].claimScore) best = k; }); c.check = { claim: best, slots, nOld: nC, seen: new Set(), L: new Array(nC + 1).fill(0), left: 3 }; } c.pendLabel = { idx, left: TAU }; }
    if (any) settle(s, norm(fused), room);   // 第一条线索（没有可比较的句子）不改变后验
  };
  const learn = (id: string, d: string, x: number) => {
    const s = st(id), nC = s.tables.length, room = nC < MAX_CTX; x = clamp(x, -1, 1);
    for (const c of s.ch) if (c.check && !c.check.seen.has(d)) { const ck = c.check; ck.seen.add(d); for (let k = 0; k <= ck.nOld; k++) { const q = k < ck.nOld ? pred(s.tables[k], d) : { mu: v0(d), sd: p.sigma * Math.sqrt(1 + 1 / p.trust) }; ck.L[k] += Math.log(pdf(x, q.mu, q.sd) + 1e-12); } ck.left--; }   // 预测在更新之前；第 nOld 项 = 全新先验
    const pri = Array.from({ length: nC + (room ? 1 : 0) }, (_, k) => k < nC ? (1 - p.hazard) * s.w[k] + p.hazard * (1 - p.newShare) / nC : p.hazard * p.newShare);
    const post = norm(pri.map((v, k) => { if (k < nC) { const q = pred(s.tables[k], d); return v * pdf(x, q.mu, q.sd); } return v * pdf(x, v0(d), p.sigma * Math.sqrt(1 + 1 / p.trust)); }));
    settle(s, post, room);
    s.tables.forEach((t, k) => { const r = s.w[k], e = cell(t, d), keep = 1 - p.forget * r; t.set(d, { n: e.n * keep + r, sum: e.sum * keep + r * x }); });
    for (const c of s.ch) {
      if (c.pendLabel && --c.pendLabel.left <= 0) { label(s, c, c.pendLabel.idx); c.pendLabel = undefined; }
      if (c.check && c.check.left <= 0) { const L = c.check.L, order = L.map((_, k) => k).sort((x, y) => L[y] - L[x]); if (L[order[0]] - L[order[1]] > 1) { if (order[0] === c.check.claim) c.a++; else c.b++; } c.check = undefined; }
    }
  };
  const controller = ((q: Request, seed: number): Proposal => {
    const id = q.identity.agentId, tick = q.identity.tick, frac = q.observation.energy / q.observation.capacity;
    if (sensor && q.observation.season) onSeason(st(id), q.observation.season);
    const proposal = ruleProposal(filterRequest(q, d => d === undefined || value(id, d, frac) >= p.tau || (p.retry > 0 && draw(id, d, tick) < p.retry)), seed);
    const here = q.observation.local.find(c => Math.hypot(c.dx, c.dy) < .5 && !c.blocked);
    pending.set(id, { desc: proposal.action === 'eat' ? here?.desc : undefined, metabolism: q.observation.costs.metabolismPerTick * q.observation.costs.decisionTicks });
    return { ...proposal, provider: 'structured-benv3-v1' };
  }) as Benv3Cohort;
  controller.contexts = id => st(id).tables.length; controller.posterior = id => st(id).w.slice(); controller.active = id => map(st(id)); controller.reliability = (id, ci) => rel(st(id).ch[ci]);
  controller.feedback = outcomes => { for (const o of outcomes) { const s = pending.get(o.agentId); pending.delete(o.agentId); if (!s) continue; const gain = o.energyAfter - o.energyBefore + s.metabolism; if (!Number.isFinite(gain)) continue; if (s.desc && o.action === 'eat') learn(o.agentId, s.desc, gain / 3); } };
  return controller;
}
