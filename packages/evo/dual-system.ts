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
/** DeepSeek（OpenAI 兼容）：key 来自环境变量 LLM_API_KEY；LLM_BASE_URL 缺省 https://api.deepseek.com；LLM_MODEL 缺省 deepseek-flash。 */
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
          body: JSON.stringify({ model, messages: [{ role: 'system', content: r.system }, { role: 'user', content: r.user }], temperature: 0, max_tokens: 400, response_format: { type: 'json_object' } }) });
        if (!res.ok) { lastErr = `http_${res.status}`; if (res.status === 401 || res.status === 402 || res.status === 403) throw Error(lastErr); await new Promise(x => setTimeout(x, 1000 * 2 ** attempt)); continue; }
        const j = await res.json() as { choices: { message: { content: string } }[]; model: string; usage?: { prompt_tokens: number; completion_tokens: number } };
        return { text: j.choices?.[0]?.message?.content ?? '', model: j.model ?? model, promptTokens: j.usage?.prompt_tokens ?? 0, completionTokens: j.usage?.completion_tokens ?? 0, ms: Math.round(performance.now() - t0) };
      } catch (e) { lastErr = String(e); if (/http_40[123]/.test(lastErr)) throw e; await new Promise(x => setTimeout(x, 1000 * 2 ** attempt)); }
    }
    throw Error(`llm_failed:${lastErr}`);
  };
}

type Exp = { tick: number; desc: string; x: number; cue?: string };
type Mind = { log: Exp[]; notes: string[]; lastCall: number; calls: number };
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

export type DualSpec = { seed: number; pool: string; K: number; pattern: 'aba' | 'abab' | 'half'; cue: 'off' | 'true'; genes: number[]; priors: Priors; mode: Mode; llm?: LlmClient;
  /** 触发阈值（当前表预测误差滑动平均）、冷却（tick）、每个体一生的调用上限、日志长度、笔记上限 */
  thr?: number; cooldown?: number; maxCalls?: number; logLen?: number; maxNotes?: number; windowTicks?: number; split?: 'test' | 'train' };
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
  const mind = (id: string) => { let m = minds.get(id); if (!m) { m = { log: [], notes: [], lastCall: -1e9, calls: 0 }; minds.set(id, m); } return m; };
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
    if (managed && !w.done()) {
      const calls: Promise<void>[] = [];
      for (const q of w.requests()) {
        const id = q.identity.agentId, m = mind(id);
        if (m.log.length < 3 || m.calls >= MAXC || w.tick - m.lastCall < COOL || managed.surprise!(id) <= THR) continue;
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
