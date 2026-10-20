// 延迟感知（滞后对齐）个体：基因解码；lag = 0 时与 v2 的即时记录（credit = 0）逐动作一致；延迟世界里 lag = 延迟 的个体明显优于盲规则与原信用窗口（手工基因，无先验）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Ecology } from '../packages/sim/ecology.ts';
import { structuredCohort } from '../packages/evo/structured.ts';
import { structuredLagCohort, decodeLagGenes, LAG_GENES } from '../packages/evo/structured-lag.ts';
import { semanticWorldConfig, loadPriors, runSemanticWorld, blindRule } from '../packages/evo/semantic-run.ts';
import { registerPools } from '../packages/evo/pools.ts';

const priors = loadPriors(), V2 = [Math.log(3), .3, -.3, .05, .02, 1, 0, .3, 0];
test('lag genes decode within bounds', () => { assert.equal(LAG_GENES, 11); assert.throws(() => decodeLagGenes(V2), /genome_size/); const d = decodeLagGenes([...V2, 1000, 1000]); assert.deepEqual([d.lag, d.width], [150, 60]); const e = decodeLagGenes([...V2, -3, -3]); assert.deepEqual([e.lag, e.width], [0, 5]); });
test('with lag = 0 the individual behaves exactly like the v2 individual with credit = 0 (immediate world)', () => {
  const cfg = () => semanticWorldConfig({ seed: 33, options: { split: 'test', inversion: .25 } }), a = structuredCohort(V2, 'laya', priors), b = structuredLagCohort([...V2, 0, 15], 'laya', priors), w1 = new Ecology(cfg()), w2 = new Ecology(cfg());
  const fb = (c, res) => c.feedback(res.outcomes.map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action })), new Map());
  for (let i = 0; i < 100 && !w1.done(); i++) { const p1 = w1.requests().map(r => a(r, 33)), p2 = w2.requests().map(r => b(r, 33)); assert.deepEqual(p1.map(p => p.action), p2.map(p => p.action)); fb(a, w1.step(p1)); fb(b, w2.step(p2)); }
});
test('aligning the credit lag with the true delay lets an individual without any prior beat the blind rule by a wide margin', () => {
  registerPools(); const base = [Math.log(1.5), .3, 0, .05, 0, 1, 0, .3, 150], delay = 40;
  const run = f => [0, 1, 2].reduce((a, i) => a + runSemanticWorld({ seed: 910000 + i, options: { split: 'test', pool: 'test', sensible: 32, harmCap: 4, inversion: .25, delay } }, f).fitness, 0) / 3;
  const blind = run(blindRule), lag = run(() => structuredLagCohort([...base, delay, 15], 'none', new Map())), plain = run(() => structuredCohort(base, 'none', new Map()));
  assert.ok(lag > blind + 0.1, `lag ${lag} 对 blind ${blind}`); assert.ok(lag > plain + 0.05, `lag ${lag} 对 plain ${plain}`);
});
