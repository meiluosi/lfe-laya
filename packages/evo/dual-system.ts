// G11 双系统：系统 1（固定 Laya 先验 + 个体信念表，每 tick）+ harness（经历日志、笔记、意外触发器、动作执行器）+ 系统 2（LLM，只在意外时介入）。
// 设计与不变量：docs/DESIGN_G11_DUAL_SYSTEM.md。系统 2 只提交“信念表管理”的建议（保持 / 新开 / 切到第 i 张），不能改世界；
// 提示里只有该个体自己的经历（描述 + 结果档位 + 各表的预期 + 自己写过的笔记 +（S2c）可见的线索句子），隐藏真值与环境阶段名不进入提示。
// 第一版：系统 2 的思考不占模拟时间（世界在等待时暂停）——这是被披露的简化，会高估系统 2 的价值。
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { Ecology } from '../sim/ecology.ts';
import { ruleProposal } from '../sim/controllers.ts';
import { semanticWorldConfig, type Priors } from './semantic-run.ts';
import { FITNESS_WEIGHTS } from './evaluate.ts';
import { structuredCohort } from './structured.ts';
import { structuredManagedCohort, type CtxCohort } from './structured-ctx.ts';
import type { Proposal, Request } from '../protocol/ecology.ts';

export type LlmRequest = { system: string; user: string; tag: string };
export type LlmResponse = { text: string; model: string; promptTokens: number; completionTokens: number; ms: number; cached?: boolean };
export type LlmClient = (r: LlmRequest) => Promise<LlmResponse>;
export type Mode = 'P' | 'T' | 'S2' | 'S2c' | 'S2x';

/** 读取 .env（不回显、不覆盖已有环境变量）。key 只在内存里，从不写日志或结果。 */
export function loadEnv(path = '.env') {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); }
}
const keyOf = (r: LlmRequest, model: string) => createHash('sha256').update(JSON.stringify([model, r.system, r.user])).digest('hex');
/** 记录 / 回放包装：同一（模型，提示）只调用一次；回放模式遇到没有记录的提示直接报错（严格回放基于记录，不基于随机种子）。 */
export function recorded(inner: LlmClient | null, path: string, model: string, mode: 'live' | 'replay' = 'live'): LlmClient {
  const cache = new Map<string, LlmResponse>();
  if (existsSync(path)) for (const l of readFileSync(path, 'utf8').split('\n')) if (l) { const j = JSON.parse(l); cache.set(j.key, { text: j.text, model: j.model, promptTokens: j.promptTokens, completionTokens: j.completionTokens, ms: j.ms }); }
  return async r => {
    const k = keyOf(r, model), hit = cache.get(k); if (hit) return { ...hit, cached: true };
    if (mode === 'replay' || !inner) throw Error('replay_miss');
    const res = await inner(r); cache.set(k, res);
    appendFileSync(path, JSON.stringify({ key: k, tag: r.tag, system: r.system, user: r.user, text: res.text, model: res.model, promptTokens: res.promptTokens, completionTokens: res.completionTokens, ms: res.ms }) + '\n'); return res;
  };
}
/** DeepSeek（OpenAI 兼容）：key 来自环境变量 LLM_API_KEY；LLM_BASE_URL 缺省 https://api.deepseek.com；LLM_MODEL 缺省 deepseek-flash；LLM_THINKING = enabled | disabled（本项目缺省 disabled；官方缺省是 enabled，推理 token 会占用 max_tokens，冒烟时 400 的上限导致 17/54 次返回空内容）；LLM_MAX_TOKENS 缺省 300。 */
export function deepseekClient(maxCalls = Number(process.env.LLM_MAX_CALLS ?? 200000)): LlmClient {
  const key = process.env.LLM_API_KEY, base = process.env.LLM_BASE_URL ?? 'https://api.deepseek.com', model = process.env.LLM_MODEL ?? 'deepseek-flash'; let n = 0;
  if (!key) throw Error('LLM_API_KEY_missing');
  return async r => {
    if (++n > maxCalls) throw Error('llm_call_guard');   // 防失控的保护，不是预算
    let lastErr = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      const t0 = performance.now();
      try {
        const res = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(90000),
          body: JSON.stringify({ model, messages: [{ role: 'system', content: r.system }, { role: 'user', content: r.user }], temperature: 0, max_tokens: Number(process.env.LLM_MAX_TOKENS ?? 300), response_format: { type: 'json_object' }, thinking: { type: process.env.LLM_THINKING ?? 'disabled' } }) });
        if (!res.ok) { lastErr = `http_${res.status}`; if (res.status === 401 || res.status === 402 || res.status === 403) throw Error(lastErr); await new Promise(x => setTimeout(x, 1000 * 2 ** attempt)); continue; }
        const j = await res.json() as { choices: { message: { content: string } }[]; model: string; usage?: { prompt_tokens: number; completion_tokens: number } };
        return { text: j.choices?.[0]?.message?.content ?? '', model: j.model ?? model, promptTokens: j.usage?.prompt_tokens ?? 0, completionTokens: j.usage?.completion_tokens ?? 0, ms: Math.round(performance.now() - t0) };
      } catch (e) { lastErr = String(e); if (/http_40[123]/.test(lastErr)) throw e; await new Promise(x => setTimeout(x, 1000 * 2 ** attempt)); }
    }
    throw Error(`llm_failed:${lastErr}`);
  };
}

type Exp = { tick: number; desc: string; x: number; cue?: string };
type Mind = { log: Exp[]; notes: string[]; lastCall: number; calls: number; base: number };
const word = (v: number) => v > .25 ? 'gain' : v < -.25 ? 'loss' : 'little effect';
const SYSTEM = `You are the slow, reflective mind of a small foraging creature. Its fast instincts keep a few "memory tables" that say which foods tend to be good or bad to eat; one table is in use at a time. Sometimes the world changes: foods that used to restore energy start to cost energy (or the reverse), and sometimes an earlier situation returns. You are shown the creature's latest meals, what happened, and what each memory table expected. Decide whether the table in use still fits, whether another existing table fits the recent meals better, or whether this looks like a new situation that needs a fresh table. Reply with JSON only: {"decision":"keep"|"new"|"switch","table":<integer, only when decision is switch>,"note":"<one short sentence the creature should remember>"}.`;
export function buildPrompt(c: CtxCohort, id: string, mind: Mind, mode: Mode, nTables: number, cur: number): LlmRequest {
  const log = mode === 'S2x' ? mind.log.map((e, i) => ({ ...e, x: mind.log[(i + 3) % mind.log.length].x })) : mind.log;   // 负控制：把结果错配给别的餐
  const lines = log.map(e => `- "${e.desc}": ${word(e.x)}${mode === 'S2c' && e.cue ? ` [sky: "${e.cue}"]` : ''}; ` + Array.from({ length: nTables }, (_, k) => `table ${k} expected ${word(c.predict!(id, k, e.desc))}`).join(', '));
  const tables = Array.from({ length: nTables }, (_, k) => `table ${k}${k === cur ? ' (in use)' : ''}: ${c.seen!(id, k)} meals remembered`).join('; ');
  return { tag: mode, system: SYSTEM, user: `Memory tables: ${tables}. At most 4 tables can exist.\n${mind.notes.length ? `Your earlier notes: ${mind.notes.join(' | ')}\n` : ''}Latest meals (oldest first):\n${lines.join('\n')}` };
}
export function parseDecision(text: string): { decision: 'keep' | 'new' | 'switch'; table?: number; note?: string } | null {
  try { const j = JSON.parse(text.replace(/^```(?:json)?|```$/g, '').trim()); if (!['keep', 'new', 'switch'].includes(j.decision)) return null; return { decision: j.decision, ...(Number.isInteger(j.table) ? { table: j.table } : {}), ...(typeof j.note === 'string' ? { note: j.note.slice(0, 160) } : {}) }; } catch { return null; }
}
/** 条件 T 的规则动作：用同样的经历日志，改用启发式——有别的表明显更合适就切过去，否则新开一张（有空位时）。 */
export function ruleDecision(c: CtxCohort, id: string, mind: Mind, nTables: number, cur: number): { decision: 'keep' | 'new' | 'switch'; table?: number } {
  const err = (k: number) => mind.log.reduce((a, e) => a + Math.abs(e.x - c.predict!(id, k, e.desc)), 0) / mind.log.length;
  let best = cur, be = err(cur); for (let k = 0; k < nTables; k++) if (k !== cur) { const e = err(k); if (e < be - .15) { be = e; best = k; } }
  if (best !== cur) return { decision: 'switch', table: best }; return nTables < 4 ? { decision: 'new' } : { decision: 'keep' };
}

export type DualSpec = { seed: number; pool: string; K: number; pattern: 'aba' | 'abab' | 'half'; cue: 'off' | 'true' | 'paraphrase'; genes: number[]; priors: Priors; mode: Mode; llm?: LlmClient;
  /** 触发阈值（当前表预测误差滑动平均）、冷却（tick）、每个体一生的调用上限、日志长度、笔记上限 */
  thr?: number; /** 触发器：abs = 当前表误差滑动平均 > thr（v1）；jump = 误差比自己的慢基线高出 jump 且 > thr（v2，只在意外“上升”时触发） */ trigger?: 'abs' | 'jump'; jump?: number; cooldown?: number; maxCalls?: number; logLen?: number; maxNotes?: number; windowTicks?: number; split?: 'test' | 'train' };
export type DualResult = { fitness: number; windows: { good: number[]; bad: number[] }; calls: number; promptTokens: number; completionTokens: number; parseFails: number; decisions: Record<string, number>; applied: number; cached: number; triggers: number };
const PHASES = { aba: 3, abab: 5, half: 3 };
export async function runDualWorld(spec: DualSpec): Promise<DualResult> {
  const THR = spec.thr ?? .5, COOL = spec.cooldown ?? 100, MAXC = spec.maxCalls ?? 12, LOG = spec.logLen ?? 8, NOTES = spec.maxNotes ?? 5, WIN = spec.windowTicks ?? 200, np = PHASES[spec.pattern];
  if ((spec.mode === 'S2' || spec.mode === 'S2c' || spec.mode === 'S2x') && !spec.llm) throw Error('llm_required');
  const cfg = semanticWorldConfig({ seed: spec.seed, options: { split: spec.split ?? 'test', pool: spec.pool, sensible: spec.K, harmCap: 1, inversion: 0, horizon: np * 1200, drift: { everyTicks: 1200, fraction: 1, pattern: spec.pattern, cue: spec.cue } } });
  const w = new Ecology(cfg); w.lean = true;
  const managed = spec.mode === 'P' ? null : structuredManagedCohort(spec.genes, 'laya', spec.priors), plain = spec.mode === 'P' ? structuredCohort(spec.genes, 'laya', spec.priors) : null;
  const minds = new Map<string, Mind>(), pend = new Map<string, { desc?: string; cue?: string; metabolism: number }>(), windows = { good: new Array(Math.ceil(cfg.horizon / WIN)).fill(0), bad: new Array(Math.ceil(cfg.horizon / WIN)).fill(0) };
  const res: DualResult = { fitness: 0, windows, calls: 0, promptTokens: 0, completionTokens: 0, parseFails: 0, decisions: {}, applied: 0, cached: 0, triggers: 0 };
  const mind = (id: string) => { let m = minds.get(id); if (!m) { m = { log: [], notes: [], lastCall: -1e9, calls: 0, base: .3 }; minds.set(id, m); } return m; };
  while (!w.done()) {
    const t0 = w.tick, reqs = w.requests();
    const proposals: Proposal[] = reqs.map((q: Request) => {
      const p = (managed ?? plain!)(q, spec.seed), here = q.observation.local.find(c => Math.hypot(c.dx, c.dy) < .5 && !c.blocked);
      pend.set(q.identity.agentId, { desc: p.action === 'eat' ? here?.desc : undefined, cue: q.observation.season, metabolism: q.observation.costs.metabolismPerTick * q.observation.costs.decisionTicks }); return p;
    });
    const r = w.step(proposals); if (!r.accepted) throw Error(r.reason);
    const k = Math.min(windows.good.length - 1, Math.floor(t0 / WIN)); for (const e of r.events!) if (e.kind === 'ate') (e.reason === 'toxic' ? windows.bad : windows.good)[k]++;
    const outcomes = r.outcomes!.map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action }));
    for (const o of outcomes) { const s = pend.get(o.agentId); if (s?.desc && o.action === 'eat') { const gain = o.energyAfter - o.energyBefore + s.metabolism; if (Number.isFinite(gain)) { const m = mind(o.agentId); m.log.push({ tick: t0, desc: s.desc, x: Math.max(-1, Math.min(1, gain / 3)), ...(s.cue ? { cue: s.cue } : {}) }); if (m.log.length > LOG) m.log.shift(); } } }
    (managed ?? plain!).feedback(outcomes, new Map());
    if (managed && spec.trigger === 'jump') for (const q of reqs) { const m = mind(q.identity.agentId); m.base += .02 * (managed.surprise!(q.identity.agentId) - m.base); }   // 慢基线：个体自己平时的误差水平
    if (managed && !w.done()) {
      const calls: Promise<void>[] = [];
      for (const q of w.requests()) {
        const id = q.identity.agentId, m = mind(id);
        const sur = managed.surprise!(id), fire = spec.trigger === 'jump' ? sur > THR && sur - m.base > (spec.jump ?? .2) : sur > THR;
        if (m.log.length < 3 || m.calls >= MAXC || w.tick - m.lastCall < COOL || !fire) continue;
        m.lastCall = w.tick; m.calls++; res.triggers++;
        const nT = managed.regimes(id), cur = managed.active(id);
        const apply = (d: { decision: 'keep' | 'new' | 'switch'; table?: number; note?: string } | null) => {
          if (!d) { res.parseFails++; return; } res.decisions[d.decision] = (res.decisions[d.decision] ?? 0) + 1;
          if (d.note) { m.notes.push(d.note); if (m.notes.length > NOTES) m.notes.shift(); }
          if (d.decision === 'new' && managed.control!(id, { op: 'new' })) res.applied++; else if (d.decision === 'switch' && d.table !== undefined && managed.control!(id, { op: 'switch', to: d.table })) res.applied++;
        };
        if (spec.mode === 'T') apply(ruleDecision(managed, id, m, nT, cur));
        else calls.push(spec.llm!(buildPrompt(managed, id, m, spec.mode, nT, cur)).then(x => { res.calls++; res.promptTokens += x.promptTokens; res.completionTokens += x.completionTokens; if (x.cached) res.cached++; apply(parseDecision(x.text)); }));
      }
      if (calls.length) await Promise.all(calls);
    }
  }
  const s = w.snapshot(), n = cfg.initialAgents, cap = s.config.capacity, survival = s.metrics.agentTicks / (n * cfg.horizon), energy = s.agents.reduce((a, x) => a + x.energy / (cap * x.traits.size), 0) / n;
  res.fitness = FITNESS_WEIGHTS.survival * survival + FITNESS_WEIGHTS.energy * energy; return res;
}
export { ruleProposal };

// ---------------------------------------------------------------------------------------------------------------------------------
// G11b：贝叶斯引擎 + LLM 传感器（docs/DESIGN_G11_DUAL_SYSTEM.md §13）。
// 数值证据：harness 对每个个体维护“当前处于哪个环境表”的后验（隐马尔可夫：每次经历以 h 的概率换环境；高斯似然，各表预测为均值；新环境的预测很宽）。
// 语言证据：线索句子变化时，LLM 判断“新句子与此前见过的每句是否同一类条件”，概率经可靠度 r 折算成各环境表的似然因子并入后验——LLM 是带噪声的传感器，不是指令。
// 条件：B（只有贝叶斯）、BL（+LLM 传感器）、BLw（传感器 30% 的查询被故意取反：检验可靠度折算下读错的代价）、BLo（预言机传感器：用隐藏的真实状态，只作上限度量，不是个体可用的）。
export type BMode = 'B' | 'BL' | 'BLw' | 'BLo';
export type BayesSpec = Omit<DualSpec, 'mode' | 'cue'> & { mode: BMode; cue: 'off' | 'true' | 'paraphrase'; sigma?: number; hazard?: number; reliability?: number; decide?: number; boundaryHazard?: number };
const SAME_SYSTEM = 'You compare two short descriptions of the conditions a creature senses around it. Decide whether they describe the same kind of conditions (temperature, wetness, wind and visibility), even if the wording is very different. Reply with JSON only: {"same": <a probability between 0 and 1>}.';
const pdf = (x: number, mu: number, sd: number) => Math.exp(-((x - mu) ** 2) / (2 * sd * sd)) / sd;
export async function runBayesWorld(spec: BayesSpec): Promise<DualResult & { switches: number; boundaries: number }> {
  const SIG = spec.sigma ?? .35, H = spec.hazard ?? .02, R = spec.reliability ?? .8, DEC = spec.decide ?? .6, HB = spec.boundaryHazard ?? .5, WIN = spec.windowTicks ?? 200, np = PHASES[spec.pattern];
  if ((spec.mode === 'BL' || spec.mode === 'BLw') && !spec.llm) throw Error('llm_required');
  const cfg = semanticWorldConfig({ seed: spec.seed, options: { split: spec.split ?? 'test', pool: spec.pool, sensible: spec.K, harmCap: 1, inversion: 0, horizon: np * 1200, drift: { everyTicks: 1200, fraction: 1, pattern: spec.pattern, cue: spec.cue } } });
  const w = new Ecology(cfg); w.lean = true; const managed = structuredManagedCohort(spec.genes, 'laya', spec.priors), truth = cfg.semantic.drift!.schedule!;
  type St = { post: number[]; curCue?: string; cues: { text: string; ctx: number; state: number }[]; preds?: { desc: string; p: number[] } };
  const st = new Map<string, St>(), pend = new Map<string, { desc?: string; preds?: number[]; metabolism: number }>(), memo = new Map<string, Promise<number>>();
  const windows = { good: new Array(Math.ceil(cfg.horizon / WIN)).fill(0), bad: new Array(Math.ceil(cfg.horizon / WIN)).fill(0) };
  const res = { fitness: 0, windows, calls: 0, promptTokens: 0, completionTokens: 0, parseFails: 0, decisions: {} as Record<string, number>, applied: 0, cached: 0, triggers: 0, switches: 0, boundaries: 0 };
  const S = (id: string): St => { let s = st.get(id); if (!s) { s = { post: [1, 0], cues: [] }; st.set(id, s); } return s; };   // 后验长度 = 环境表数 + 1（最后一项 = “新环境”）
  const norm = (a: number[]) => { const t = a.reduce((x, y) => x + y, 0) || 1; return a.map(x => x / t); };
  const decide = (id: string, s: St) => {   // 后验最大且超过 DEC、不是当前表 → 切换 / 新开
    const nT = managed.regimes(id), cur = managed.active(id); let best = 0; s.post.forEach((p, i) => { if (p > s.post[best]) best = i; });
    if (best === cur || s.post[best] < DEC) return;
    if (best === nT) { if (managed.control!(id, { op: 'new' })) { res.switches++; const n2 = nT + 1, post = new Array(n2 + (n2 < 4 ? 1 : 0)).fill(0); post[n2 - 1] = 1; if (n2 < 4) post[n2] = .02; s.post = norm(post); } }
    else if (managed.control!(id, { op: 'switch', to: best })) res.switches++;
  };
  const same = (a: string, b: string, mode: BMode, stA: number, stB: number): Promise<number> => {
    if (mode === 'BLo') return Promise.resolve(stA === stB ? 1 : 0);
    const k = a < b ? `${a}|${b}` : `${b}|${a}`; let p = memo.get(k);
    if (!p) {
      const ask = async (x: string, y: string) => { const r = await spec.llm!({ system: SAME_SYSTEM, user: `A: "${x}"\nB: "${y}"`, tag: 'sensor' }); res.calls++; res.promptTokens += r.promptTokens; res.completionTokens += r.completionTokens; if (r.cached) res.cached++; try { const v = Number(JSON.parse(r.text).same); return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : .5; } catch { res.parseFails++; return .5; } };
      p = Promise.all([ask(a, b), ask(b, a)]).then(([x, y]) => (x + y) / 2); memo.set(k, p);
    }
    return p.then(v => { if (mode !== 'BLw') return v; let h = 2166136261 ^ spec.seed; for (const ch of `${a}|${b}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return ((h >>> 0) % 100) < 30 ? 1 - v : v; });
  };
  while (!w.done()) {
    const t0 = w.tick, reqs = w.requests();
    const proposals: Proposal[] = reqs.map((q: Request) => {
      const id = q.identity.agentId, p = managed(q, spec.seed), here = q.observation.local.find(c => Math.hypot(c.dx, c.dy) < .5 && !c.blocked), nT = managed.regimes(id);
      pend.set(id, { desc: p.action === 'eat' ? here?.desc : undefined, preds: p.action === 'eat' && here?.desc ? Array.from({ length: nT }, (_, k) => managed.predict!(id, k, here.desc!)) : undefined, metabolism: q.observation.costs.metabolismPerTick * q.observation.costs.decisionTicks }); return p;
    });
    const r = w.step(proposals); if (!r.accepted) throw Error(r.reason);
    const k = Math.min(windows.good.length - 1, Math.floor(t0 / WIN)); for (const e of r.events!) if (e.kind === 'ate') (e.reason === 'toxic' ? windows.bad : windows.good)[k]++;
    const outcomes = r.outcomes!.map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action }));
    managed.feedback(outcomes, new Map());
    for (const o of outcomes) {   // 数值证据：这次经历的结果 x 在各环境表预测下的似然
      const p = pend.get(o.agentId); if (!p?.desc || o.action !== 'eat' || !p.preds) continue; const gain = o.energyAfter - o.energyBefore + p.metabolism; if (!Number.isFinite(gain)) continue;
      const x = Math.max(-1, Math.min(1, gain / 3)), s = S(o.agentId), nT = p.preds.length, avail = s.post.length > nT;
      const prior = s.post.map((v, i) => (1 - H) * v + H / (nT + (avail ? 1 : 0)) * (i < nT || avail ? 1 : 0));
      s.post = norm(prior.map((v, i) => v * (i < nT ? pdf(x, p.preds![i], SIG) : pdf(x, 0, 1)))); decide(o.agentId, s);
    }
    if (!w.done()) {   // 语言证据：线索句子变化的时刻
      const sensors: Promise<void>[] = [];
      for (const q of w.requests()) {
        const id = q.identity.agentId, s = S(id), cue = q.observation.season; if (!cue || cue === s.curCue) continue;
        res.boundaries++; const nT = managed.regimes(id), phase = Math.floor(w.tick / 1200), state = truth[Math.min(phase, truth.length - 1)];
        if (s.curCue) { const e = s.cues.find(c => c.text === s.curCue); if (e) e.ctx = managed.active(id); else s.cues.push({ text: s.curCue, ctx: managed.active(id), state: truth[Math.min(Math.max(0, Math.floor((w.tick - 1) / 1200)), truth.length - 1)] }); }
        const prev = s.cues.filter(c => c.text !== cue); s.curCue = cue; if (spec.mode !== 'B' && prev.length > 0) s.post = norm(s.post.map(v => (1 - HB) * v + HB / s.post.length));   // 线索句子变了：环境很可能换了（先验），具体是哪个交给传感器
        if (spec.mode === 'B' || prev.length === 0) continue;   // B 不读线索；第一次见到线索没有可比较的句子
        sensors.push(Promise.all(prev.map(c => same(cue, c.text, spec.mode, state, c.state))).then(sims => {
          const smax = Array.from({ length: nT }, (_, kk) => Math.max(0, ...prev.filter(c => c.ctx === kk).map(c => sims[prev.indexOf(c)]))), top = Math.max(0, ...smax);
          s.post = norm(s.post.map((v, i) => v * (i < nT ? (prev.some(c => c.ctx === i) ? R * smax[i] + (1 - R) * (1 - smax[i]) : 1) : R * (1 - top) + (1 - R) * top)));
          decide(id, s);
        }));
      }
      if (sensors.length) await Promise.all(sensors);
    }
  }
  const s = w.snapshot(), n = cfg.initialAgents, cap = s.config.capacity, survival = s.metrics.agentTicks / (n * cfg.horizon), energy = s.agents.reduce((a, x) => a + x.energy / (cap * x.traits.size), 0) / n;
  res.fitness = FITNESS_WEIGHTS.survival * survival + FITNESS_WEIGHTS.energy * energy; return res;
}
