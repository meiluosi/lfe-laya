// 语义世界的评估与基线控制器。预言机（oracle）读取模拟器的隐藏真值，只用于度量“上限/余量”，不是个体可用的信息。
import { readFileSync } from 'node:fs';
import { Ecology } from '../sim/ecology.ts';
import type { SemanticKind, SemanticConfig } from '../sim/ecology.ts';
import { ruleProposal, randomProposal } from '../sim/controllers.ts';
import type { Request } from '../protocol/ecology.ts';
import { BASE, SCENARIOS, FITNESS_WEIGHTS, type Controller, type EvalResult } from './evaluate.ts';
import { semanticConfig, NONSENSE_POOL, type SemanticOptions } from './semantic.ts';

export type SemanticSpec = { seed: number; options: SemanticOptions; scenario?: keyof typeof SCENARIOS };
export type SemanticFactory = (kinds: SemanticKind[], semantic?: SemanticConfig) => Controller;
export type Priors = Map<string, number>;

export function loadPriors(path = new URL('../../experiments/evo/laya-prior-v1.json', import.meta.url)): Priors {
  const doc = JSON.parse(readFileSync(path, 'utf8')); return new Map(Object.entries(doc.priors as Record<string, { pEat: number }>).map(([k, v]) => [k, v.pEat]));
}
export function semanticWorldConfig(spec: SemanticSpec) {
  return { ...BASE, ...SCENARIOS[spec.scenario ?? 'semantic'], ...semanticConfig(spec.seed, spec.options), seed: spec.seed, runId: `sem-${spec.options.split}-${spec.seed}` };
}
export function runSemanticWorld(spec: SemanticSpec, factory: SemanticFactory, windowTicks = 0): EvalResult & { toxicBites: number; lifetimes: { t: number; died: boolean }[]; windows?: { good: number[]; bad: number[] } } {
  const config = semanticWorldConfig(spec), w = new Ecology(config), controller = factory(config.semantic.kinds, config.semantic);
  w.lean = process.env.LFE_LEAN !== '0';   // 精简模式：只读 accepted / outcomes / events；LFE_LEAN=0 回到完整模式（结果逐世界一致，见 tests/lean.test.mjs）
  let toxic = 0;
  const windows = windowTicks > 0 ? { good: new Array(Math.ceil(config.horizon / windowTicks)).fill(0), bad: new Array(Math.ceil(config.horizon / windowTicks)).fill(0) } : undefined;   // 可选：按时间窗口统计吃到营养 / 有害食物的次数（A/B/A 度量用，不改变任何运行结果）
  while (!w.done()) {
    const t0 = windows ? w.tick : 0;
    const r = w.step(w.requests().map(q => controller(q, spec.seed))); if (!r.accepted) throw Error(r.reason);
    toxic += r.events!.filter(e => e.kind === 'ate' && e.reason === 'toxic').length;
    if (windows) { const k = Math.min(windows.good.length - 1, Math.floor(t0 / windowTicks)); for (const e of r.events!) if (e.kind === 'ate') (e.reason === 'toxic' ? windows.bad : windows.good)[k]++; }
    if (controller.feedback) controller.feedback(r.outcomes!.map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action })), new Map((w.done() ? [] : w.requests()).map(q => [q.identity.agentId, q])));
  }
  const s = w.snapshot(), n = config.initialAgents, cap = s.config.capacity;
  const survival = s.metrics.agentTicks / (n * config.horizon), lowEnergy = s.metrics.lowEnergyTicks / s.metrics.agentTicks;
  const energyFraction = s.agents.reduce((a, x) => a + x.energy / (cap * x.traits.size), 0) / n;
  const lifetimes = s.lineage.map(l => ({ t: (l.died ?? s.tick) - l.born, died: l.died !== null && l.died !== undefined }));   // 生存分析：每个个体的寿命，存活者在地平线处删失
  return { survival, lowEnergy, energyFraction, living: s.agents.length, deaths: s.metrics.deaths, toxicBites: toxic, lifetimes, ...(windows ? { windows } : {}), fitness: FITNESS_WEIGHTS.survival * survival + FITNESS_WEIGHTS.energy * energyFraction };
}
/** 把不想要的食物从个体的观测里“抹掉”，再交给无语义的规则控制器。 */
export { filterRequest } from './filter.ts';
import { filterRequest } from './filter.ts';
export const blindRule: SemanticFactory = () => (q, seed) => ruleProposal(q, seed);
export const randomPolicy: SemanticFactory = () => (q, seed) => randomProposal(q, seed);
/** 用 Laya 先验的规则：只追逐 Laya 判断“可以吃”的食物（P(吃) ≥ 阈值）；未知描述按 0 处理。 */
export const layaRule = (priors: Priors, threshold = .5): SemanticFactory => () => (q, seed) => ruleProposal(filterRequest(q, d => d === undefined || (priors.get(d) ?? 0) >= threshold), seed);
/** 预言机：知道每种食物的真实影响（上限，不可用于个体）。 */
export const oracleRule: SemanticFactory = (kinds, semantic) => {
  const drift = semantic?.drift, rip = semantic?.ripening;
  if (rip) {   // W7：显示的描述随阶段变化；预言机知道每个描述对应的种类与当前阶段（上限，不可用于个体）
    const shown = new Map<string, number>();
    kinds.forEach((k, i) => { for (let st = 0; st < 4; st++) shown.set(rip.cues === 'off' ? k.description : `${k.description} ${rip.stageText[(st + (rip.cues === 'shuffled' ? 2 : 0)) % 4]}`, i); });
    return (q, seed) => {
      const tick = q.identity.tick, flipped = !!drift && Math.floor(tick / drift.everyTicks) % 2 === 1, season = Math.floor(tick / rip.seasonTicks) % 4;
      const good = (d: string) => { const i = shown.get(d); if (i === undefined) return true; const f = kinds[i].factor * (rip.perishable[i] ? rip.multipliers[(season + rip.offsets[i]) % 4] : 1) * (flipped && drift!.flip.includes(i) ? -1 : 1); return f > 0; };
      return ruleProposal(filterRequest(q, d => d === undefined || good(d)), seed);
    };
  }
  return (q, seed) => {
    const flipped = !!drift && Math.floor(q.identity.tick / drift.everyTicks) % 2 === 1;
    const good = new Set(kinds.filter((k, i) => (flipped && drift!.flip.includes(i) ? -k.factor : k.factor) > 0).map(k => k.description));
    return ruleProposal(filterRequest(q, d => d === undefined || good.has(d)), seed);
  };
};

export type ExplorerOptions = {
  /** veto：Laya 明确坏的不去碰（默认）；none：完全不用先验，全部先试、凭自己的经验否决；soft：全部先试，但追逐目标时优先 Laya 判断更好的（只排序，不否决）。 */
  mode?: 'veto' | 'none' | 'soft' | 'adaptive';
  goodAt?: number; badAt?: number;
  /** 先验来源：laya = 缓存的 Laya；oracleNonsense = 无语义词用真值、其余用 Laya；oracleSensible = 有语义词用真值、无语义词留给探索；oracleAll = 全部真值（应等于预言机）。仅用于差距拆解。 */
  prior?: 'laya' | 'oracleNonsense' | 'oracleSensible' | 'oracleAll';
  /** 诊断：队列内共享经验（社会学习上限）。这是另一种机制（传承），不是个体学习，必须单独标注。 */
  share?: boolean;
  /** 经验的遗忘（0=不遗忘；0.1=每次新经验把旧经验权重乘 0.9）：用于环境漂移。 */
  forget?: number;
  /** 每个决策里，已被经验否决的食物以此概率被放行再试一次（让个体有机会发现环境变了）。0 = 永不重试。 */
  retry?: number;
  /** 延迟信用分配：吃的当下不记经验；之后出现明显的能量冲击时，归因到窗口（模拟步）内吃过的种类。0/缺省 = 即时记录。 */
  creditWindow?: number;
};
export const explorerRule = (priors: Priors, opt: ExplorerOptions = {}): SemanticFactory => kinds => {
  const goodAt = opt.goodAt ?? .5, badAt = opt.badAt ?? .3, truth = new Map(kinds.map(k => [k.description, (k.factor + 1) / 2]));
  const nonsense = (d: string) => (priors.get(d) ?? .36) > .3 && (priors.get(d) ?? .36) < .45 && NONSENSE_SET.has(d);
  const priorOf = (d: string): number => {
    const mode = opt.prior ?? 'laya';
    if (mode === 'oracleAll' || (mode === 'oracleNonsense' && NONSENSE_SET.has(d)) || (mode === 'oracleSensible' && !NONSENSE_SET.has(d))) return truth.get(d) ?? .5;
    return priors.get(d) ?? .36;
  };
  void nonsense;
  const exp = new Map<string, Map<string, { n: number; sum: number }>>(), shared = new Map<string, { n: number; sum: number }>(), pending = new Map<string, { desc?: string; metabolism: number; tick: number }>(), meals = new Map<string, { desc: string; tick: number }[]>();
  const stat = (id: string, d: string) => opt.share ? shared.get(d) : exp.get(id)?.get(d);
  let nowTick = 0, nowId = '';
  const retryDraw = (id: string, d: string) => { let x = 2166136261; for (const ch of `${id}:${d}:${nowTick}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619); x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; return (x >>> 0) / 4294967296; };
  /** 自适应信任：个体统计“先验的判断与自己亲历的后果一致”的比例（Beta(2,1) 起点，略偏信任）。只用该个体自己的经历。 */
  const agree = new Map<string, { ok: number; n: number }>();
  const reliability = (id: string) => { const a = agree.get(id); return ((a?.ok ?? 0) + 2) / ((a?.n ?? 0) + 3); };
  const keepFor = (id: string) => (d: string | undefined) => {
    if (d === undefined) return true;
    const e = stat(id, d); if (e && e.n > 0) return e.sum / e.n > 0 || (opt.retry ? retryDraw(id, d) < opt.retry : false);
    if (opt.mode === 'none' || opt.mode === 'soft') return true;
    const p = priorOf(d);
    if (opt.mode === 'adaptive') return p >= badAt || reliability(id) < .7;   // 先验被自己的经验证明靠不住时，退回全试
    return p >= goodAt || p >= badAt;
  };
  const boost = (q: Request): Request => opt.mode !== 'soft' ? q : { ...q, observation: { ...q.observation, local: q.observation.local.map(c => c.desc && c.food > .05 ? { ...c, food: c.food * (1 + 2 * Math.max(0, priorOf(c.desc) - .45)) } : c) } };
  const controller = ((q: Request, seed: number) => {
    nowTick = q.identity.tick; nowId = q.identity.agentId; void nowId;
    const id = q.identity.agentId, proposal = ruleProposal(boost(filterRequest(q, keepFor(id))), seed);
    const here = q.observation.local.find(c => Math.hypot(c.dx, c.dy) < .5 && !c.blocked);
    pending.set(id, { desc: proposal.action === 'eat' ? here?.desc : undefined, metabolism: q.observation.costs.metabolismPerTick * q.observation.costs.decisionTicks, tick: q.identity.tick });
    return proposal;
  }) as Controller;
  const recordBelief = (agentId: string, desc: string, x: number) => {
    if (opt.mode === 'adaptive' && Math.abs(x) > .25) { const pr = priorOf(desc), a = agree.get(agentId) ?? { ok: 0, n: 0 }; a.n++; if ((pr >= .5) === (x > 0)) a.ok++; agree.set(agentId, a); }
    const target = (opt.share ? shared : (exp.get(agentId) ?? (exp.set(agentId, new Map()), exp.get(agentId)!))) as Map<string, { n: number; sum: number }>;
    const e = target.get(desc) ?? { n: 0, sum: 0 }, keep = 1 - (opt.forget ?? 0); e.n = e.n * keep + 1; e.sum = e.sum * keep + x; target.set(desc, e);
  };
  controller.feedback = outcomes => {
    for (const o of outcomes) {
      const p = pending.get(o.agentId); pending.delete(o.agentId);
      if (opt.creditWindow && p) {
        const gain = o.energyAfter - o.energyBefore + p.metabolism, list = (meals.get(o.agentId) ?? []).filter(m => p.tick - m.tick <= opt.creditWindow!);
        if (o.action === 'eat' && p.desc) list.push({ desc: p.desc, tick: p.tick });      // 先登记这顿饭；如果这一步本身就有明显冲击（延迟为 0 或很短），下面一并归因
        if (Math.abs(gain) > 1.2 && list.length) { const x = Math.max(-1, Math.min(1, gain / 3)) / Math.sqrt(list.length); for (const m of list) recordBelief(o.agentId, m.desc, Math.max(-1, Math.min(1, x * Math.sqrt(list.length)))); list.length = 0; }   // 冲击出现：归因到窗口内吃过的种类
        meals.set(o.agentId, list); continue;
      }
      if (!p?.desc || o.action !== 'eat') continue;
      const gain = o.energyAfter - o.energyBefore + p.metabolism, x = Math.max(-1, Math.min(1, gain / 3));
      recordBelief(o.agentId, p.desc, x);
    }
  };
  return controller;
};
const NONSENSE_SET = new Set(NONSENSE_POOL);
