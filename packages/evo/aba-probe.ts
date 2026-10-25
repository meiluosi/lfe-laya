// 开发期探针（非确认性）：A/B/A 漂移世界里，各类个体在每个时间窗口里的“吃到有害食物的次数”和“净摄入”，
// 用来看现有个体在环境翻转后是否适应、返回旧环境时是否保留。漂移 = 每 PHASE 个 tick 翻转一半种类的影响；0–PHASE 为 A，PHASE–2PHASE 为 B，2PHASE–3PHASE 又是 A。
// 用法：node packages/evo/aba-probe.ts [--worlds 16] [--prior laya|none] [--harmCap 1] [--K 32] [--inversion .25] [--fraction .5]
import { Ecology } from '../sim/ecology.ts';
import { semanticWorldConfig, loadPriors, blindRule, type SemanticFactory } from './semantic-run.ts';
import { registerPools } from './pools.ts';
import { structuredCohort } from './structured.ts';
import { structuredDualCohort, structuredRegimeCohort } from './structured-ctx.ts';

const arg = (n: string, d: string) => process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d;
const WORLDS = Number(arg('worlds', '16')), HARM = Number(arg('harmCap', '1')), K = Number(arg('K', '32')), INV = Number(arg('inversion', '.25')), FRAC = Number(arg('fraction', '.5')), PHASE = 1200, WIN = 200, NW = 3 * PHASE / WIN;
registerPools(); const priors = loadPriors();
const base = [Math.log(3), .3, -.3, .05, .02, 1, 0, .3, 0];
const withForget = (f: number) => base.map((v, i) => i === 3 ? f : v);
const conds: Record<string, SemanticFactory> = {
  blind: blindRule,
  'none f=.00': () => structuredCohort(withForget(0), 'none', new Map()),
  'none f=.05': () => structuredCohort(withForget(.05), 'none', new Map()),
  'none f=.20': () => structuredCohort(withForget(.2), 'none', new Map()),
  'laya f=.00': () => structuredCohort(withForget(0), 'laya', priors),
  'laya f=.05': () => structuredCohort(withForget(.05), 'laya', priors),
  'laya f=.20': () => structuredCohort(withForget(.2), 'laya', priors),
  'none dual': () => structuredDualCohort([...base, .2, .005, .2, 4], 'none', new Map()),
  'laya dual': () => structuredDualCohort([...base, .2, .005, .2, 4], 'laya', priors),
  'none regime': () => structuredRegimeCohort([...base, .5, .25, .03], 'none', new Map()),
  'laya regime': () => structuredRegimeCohort([...base, .5, .25, .03], 'laya', priors),
};
const row = (c: SemanticFactory) => {
  const bad = new Array(NW).fill(0), net = new Array(NW).fill(0), good = new Array(NW).fill(0);
  for (let i = 0; i < WORLDS; i++) {
    const cfg = semanticWorldConfig({ seed: 880000 + i, options: { split: 'test', pool: 'test', sensible: K, harmCap: HARM, inversion: INV, drift: { everyTicks: PHASE, fraction: FRAC } } });
    const w = new Ecology(cfg), ctl = c(cfg.semantic.kinds, cfg.semantic); w.lean = true;
    while (!w.done()) {
      const t0 = w.snapshot().tick, r = w.step(w.requests().map(q => ctl(q, 880000 + i))); if (!r.accepted) throw Error(r.reason);
      const k = Math.min(NW - 1, Math.floor(t0 / WIN));
      for (const e of r.events!) if (e.kind === 'ate') { if (e.reason === 'toxic') { bad[k]++; net[k] -= e.amount; } else { net[k] += e.amount; good[k]++; } }
      if (ctl.feedback) ctl.feedback(r.outcomes!.map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action })), new Map());
    }
  }
  return { bad: bad.map(x => x / WORLDS / 8), net: net.map(x => x / WORLDS / 8), prec: good.map((g, k) => g / Math.max(1, g + bad[k])) };
};
console.log(`windows of ${WIN} ticks; phases A=0–${PHASE}, B=${PHASE}–${2 * PHASE}, A=${2 * PHASE}–${3 * PHASE}; harmCap ${HARM}; ${WORLDS} worlds, 8 individuals`);
console.log('per-individual bad bites per window / net intake per window');
for (const [name, f] of Object.entries(conds)) { const r = row(f); const m = (a: number, b: number) => r.prec.slice(a, b).reduce((x, y) => x + y, 0) / (b - a), per = PHASE / WIN, e = 2;
  console.log(name.padEnd(12), r.prec.map(x => x.toFixed(2)).join(' '), `| A1 early ${m(0, e).toFixed(2)} late ${m(per - e, per).toFixed(2)} | B early ${m(per, per + e).toFixed(2)} late ${m(2 * per - e, 2 * per).toFixed(2)} | A2 early ${m(2 * per, 2 * per + e).toFixed(2)} late ${m(3 * per - e, 3 * per).toFixed(2)} | savings ${(m(2 * per, 2 * per + e) - m(0, e)).toFixed(2)}`); }
