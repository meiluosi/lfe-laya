// G8 S1 校准（协议 docs/G8_CALIBRATION.md，运行前已冻结）：一个候选参数 × 三种纯种群（plain / regime / eatall）× 若干世界，输出建立率等。
// 用法：node packages/evo/ecology-calibrate.ts <新输出文件.json> --supply 14 --threshold 32 --init 8 [--worlds 10]
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { Ecology } from '../sim/ecology.ts';
import { semanticWorldConfig } from './semantic-run.ts';
import { registerPools, loadLayaPriors } from './pools.ts';
import { structuredCohort } from './structured.ts';
import { structuredRegimeCohort } from './structured-ctx.ts';
import { ruleProposal } from '../sim/controllers.ts';
import type { Proposal, Request } from '../protocol/ecology.ts';

const args = process.argv.slice(2), out = args[0]; if (!out || existsSync(out)) throw Error('Usage: node packages/evo/ecology-calibrate.ts <new-output-file.json> --supply S --threshold T --init I [--worlds N]');
const opt = (n: string) => { const i = args.indexOf(`--${n}`); if (i < 0) throw Error(`missing --${n}`); return args[i + 1]; };
const SUPPLY = Number(opt('supply')), THR = Number(opt('threshold')), INIT = Number(opt('init')), N = args.includes('--worlds') ? Number(opt('worlds')) : 10;
const PHASE = 1200, NP = 5; registerPools();
const priors = loadLayaPriors('train'), genome = (n: string): number[] => JSON.parse(readFileSync(`experiments/evo/${n}/final.json`, 'utf8')).innate;
const result: Record<string, { established: number; capHits: number; births: number[]; finalLiving: number[]; extinctAt: number[] }> = {};
for (const type of ['plain', 'regime', 'eatall'] as const) {
  const r = { established: 0, capHits: 0, births: [] as number[], finalLiving: [] as number[], extinctAt: [] as number[] };
  for (let wi = 0; wi < N; wi++) {
    const seed = 800000 + wi, cfg = { ...semanticWorldConfig({ seed, options: { split: 'train', pool: 'train', sensible: 6, harmCap: 1, inversion: 0, horizon: NP * PHASE, drift: { everyTicks: PHASE, fraction: 1, pattern: 'abab', cue: 'off' } } }), reproduction: true, maxAge: 2400, birthThreshold: THR, birthCooldown: 150, supplyAmount: SUPPLY, initialAgents: INIT };
    const w = new Ecology(cfg), cohort = type === 'plain' ? structuredCohort(genome('dev-aba-laya-plain-201'), 'laya', priors) : type === 'regime' ? structuredRegimeCohort(genome('dev-aba-laya-regime-201'), 'laya', priors) : null;
    const decide = (q: Request): Proposal => { if (q.candidates.some(c => c.id === 'reproduce')) return { identity: q.identity, action: 'reproduce', provider: 'instinct', distribution: Object.fromEntries(q.candidates.map(c => [c.id, c.id === 'reproduce' ? 1 : 0])) }; return cohort ? cohort(q, seed) : ruleProposal(q, seed); };
    let extinctAt = -1;
    while (!w.done()) {
      const res = w.step(w.requests().map(decide)); if (!res.accepted) throw Error(res.reason);
      cohort?.feedback(res.outcomes!.map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action })), new Map((w.done() ? [] : w.requests()).map(q => [q.identity.agentId, q] as const)));
      if (extinctAt < 0 && !w.snapshot().agents.length) extinctAt = w.tick;
    }
    const s = w.snapshot(); if (s.agents.length > 0 && s.metrics.births >= 20) r.established++; if (s.metrics.populationCapHits > 0) r.capHits++;
    r.births.push(s.metrics.births); r.finalLiving.push(s.agents.length); r.extinctAt.push(extinctAt);
  }
  result[type] = r; console.log(`S${SUPPLY} T${THR} I${INIT} ${type.padEnd(7)} established ${r.established}/${N} capHits ${r.capHits} births ${r.births.join(',')}`);
}
writeFileSync(out, JSON.stringify({ supply: SUPPLY, threshold: THR, init: INIT, worlds: N, protocol: 'docs/G8_CALIBRATION.md', result }, null, 1));
