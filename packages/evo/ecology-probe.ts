// G8 探针（开发期，非确认性）：语义 A/B/A/B/A 世界里开启繁殖与寿命，混合种群（plain 与 regime 先天基因组各占一半），孩子继承父母的类型（先天），一生内信念从头开始（后天不遗传）。
// 问题：现有个体能否在这个世界里稳定生存并繁殖？是否灭绝或撞上人口上限？各类型的数量随反转怎么变化？
// 繁殖本能：当“繁殖”出现在合法动作里（能量够、冷却完）就繁殖——这是固定的、与学习器无关的本能（基因组里没有繁殖决策）。
// 用法：node packages/evo/ecology-probe.ts <新输出目录> [--worlds 8] [--maxAge 2400] [--pattern abab] [--threshold 32] [--cooldown 150] [--supply 14] [--init 8]
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { Ecology } from '../sim/ecology.ts';
import { semanticWorldConfig } from './semantic-run.ts';
import { registerPools, loadLayaPriors } from './pools.ts';
import { structuredCohort } from './structured.ts';
import { structuredRegimeCohort } from './structured-ctx.ts';
import type { Proposal, Request } from '../protocol/ecology.ts';

const args = process.argv.slice(2), out = args[0]; if (!out) throw Error('Usage: node packages/evo/ecology-probe.ts <new-output-directory> [options]');
const opt = (n: string, d: string) => args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d;
const N = Number(opt('worlds', '8')), MAXAGE = Number(opt('maxAge', '2400')), PATTERN = opt('pattern', 'abab') as 'aba' | 'abab' | 'long', THR = Number(opt('threshold', '32')), COOL = Number(opt('cooldown', '150')), SUPPLY = Number(opt('supply', '14')), INIT = Number(opt('init', '8'));
const PHASE = 1200, NP = PATTERN === 'aba' ? 3 : 5, WIN = 600;
mkdirSync(out, { recursive: false }); registerPools();
const priors = loadLayaPriors('heldout'), genome = (n: string): number[] => JSON.parse(readFileSync(`experiments/evo/${n}/final.json`, 'utf8')).innate;
const rows: Record<string, number | number[]>[] = [];
for (let wi = 0; wi < N; wi++) {
  const seed = 700000 + wi, cfg = { ...semanticWorldConfig({ seed, options: { split: 'test', pool: 'heldout', sensible: 6, harmCap: 1, inversion: 0, horizon: NP * PHASE, drift: { everyTicks: PHASE, fraction: 1, pattern: PATTERN, cue: 'off' } } }), reproduction: true, maxAge: MAXAGE, birthThreshold: THR, birthCooldown: COOL, supplyAmount: SUPPLY, initialAgents: INIT };
  const w = new Ecology(cfg), cohorts = { plain: structuredCohort(genome('f17-laya-plain-211'), 'laya', priors), regime: structuredRegimeCohort(genome('f17-laya-regime-211'), 'laya', priors) } as const;
  type T = keyof typeof cohorts; const type = new Map<string, T>(); let initIndex = 0;
  const typeOf = (id: string): T => { let t = type.get(id); if (t) return t; const par = w.snapshot().lineage.find(l => l.id === id)?.parentId; t = par ? type.get(par) ?? 'plain' : (initIndex++ % 2 === 0 ? 'plain' : 'regime'); type.set(id, t); return t; };
  const nWin = Math.ceil(cfg.horizon / WIN), count = { plain: new Array(nWin).fill(0), regime: new Array(nWin).fill(0) }, births = { plain: 0, regime: 0 }; let extinctAt = -1, capHits = 0;
  const decide = (q: Request): Proposal => { const t = typeOf(q.identity.agentId); if (q.candidates.some(c => c.id === 'reproduce')) { const legal = q.candidates.map(c => c.id), d: Proposal['distribution'] = Object.fromEntries(legal.map(a => [a, a === 'reproduce' ? 1 : 0])); return { identity: q.identity, action: 'reproduce', provider: 'instinct', distribution: d }; } return cohorts[t](q, seed); };
  while (!w.done()) {
    const reqs = w.requests(); for (const q of reqs) typeOf(q.identity.agentId);
    const k = Math.min(nWin - 1, Math.floor(w.tick / WIN)); for (const q of reqs) count[typeOf(q.identity.agentId)][k] = Math.max(count[typeOf(q.identity.agentId)][k], 0);
    const r = w.step(reqs.map(decide)); if (!r.accepted) throw Error(r.reason);
    for (const e of r.events!) if (e.kind === 'born') { const id = (e as unknown as { agentId: string }).agentId, par = w.snapshot().lineage.find(l => l.id === id)?.parentId; births[par ? type.get(par) ?? 'plain' : 'plain']++; }
    const next = new Map((w.done() ? [] : w.requests()).map(q => [q.identity.agentId, q] as const));
    for (const t of ['plain', 'regime'] as T[]) cohorts[t].feedback(r.outcomes!.filter(o => type.get(o.agentId) === t).map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action })), next);
    // 每个窗口末取一次在世个体数（按类型）
    const tk = w.tick; if (tk % WIN < 10 || w.done()) { const kk = Math.min(nWin - 1, Math.floor((tk - 1) / WIN)); const s = w.snapshot(); count.plain[kk] = s.agents.filter(a => type.get(a.id) === 'plain').length; count.regime[kk] = s.agents.filter(a => type.get(a.id) === 'regime').length; }
    if (extinctAt < 0 && !w.snapshot().agents.length) extinctAt = w.tick;
  }
  const s = w.snapshot(); capHits = s.metrics.populationCapHits;
  rows.push({ seed, births: s.metrics.births, deaths: s.metrics.deaths, bornPlain: births.plain, bornRegime: births.regime, extinctAt, capHits, finalLiving: s.agents.length, maxGeneration: Math.max(...s.lineage.map(l => l.generation)), plain: count.plain, regime: count.regime });
  console.log(`seed ${seed} births ${s.metrics.births} deaths ${s.metrics.deaths} extinct@${extinctAt} cap ${capHits} gen≤${Math.max(...s.lineage.map(l => l.generation))} plain ${count.plain.join(',')} | regime ${count.regime.join(',')}`);
}
writeFileSync(`${out}/results.json`, JSON.stringify({ protocol: 'dev probe (G8)', worlds: N, maxAge: MAXAGE, pattern: PATTERN, threshold: THR, cooldown: COOL, supply: SUPPLY, init: INIT, windowTicks: WIN, rows }, null, 1));
