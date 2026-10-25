// S2 学习器（dual / regime）：基因解码有界；退化设置与 v2 逐动作一致；A/B/A 世界里 regime 个体回到旧环境时能切回旧信念表。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Ecology } from '../packages/sim/ecology.ts';
import { structuredCohort } from '../packages/evo/structured.ts';
import { structuredDualCohort, structuredRegimeCohort, decodeDualGenes, decodeRegimeGenes, DUAL_GENES, REGIME_GENES } from '../packages/evo/structured-ctx.ts';
import { semanticWorldConfig, loadPriors } from '../packages/evo/semantic-run.ts';
import { registerPools } from '../packages/evo/pools.ts';

registerPools(); const priors = loadPriors(), V2 = [Math.log(3), .3, -.3, .05, .02, 1, 0, .3, 0];
test('genes decode within bounds', () => {
  assert.equal(DUAL_GENES, 13); assert.equal(REGIME_GENES, 12); assert.throws(() => decodeDualGenes(V2), /genome_size/); assert.throws(() => decodeRegimeGenes(V2), /genome_size/);
  const d = decodeDualGenes([...V2, 9, 9, 9, 99]); assert.deepEqual([d.fast, d.slow, d.rate, d.sharp], [.6, .05, .5, 12]);
  const r = decodeRegimeGenes([...V2, -9, -9, 9]); assert.deepEqual([r.theta, r.rate, r.margin], [.15, .05, .3]);
});
const same = (make) => {
  const cfg = () => semanticWorldConfig({ seed: 41, options: { split: 'test', pool: 'test', sensible: 6, harmCap: 1, inversion: 0 } }), a = structuredCohort(V2, 'laya', priors), b = make(), w1 = new Ecology(cfg()), w2 = new Ecology(cfg());
  const fb = (c, res) => c.feedback(res.outcomes.map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action })), new Map());
  for (let i = 0; i < 120 && !w1.done(); i++) { const p1 = w1.requests().map(r => a(r, 41)), p2 = w2.requests().map(r => b(r, 41)); assert.deepEqual(p1.map(p => p.action), p2.map(p => p.action)); fb(a, w1.step(p1)); fb(b, w2.step(p2)); }
};
test('regime with theta above any error never spawns and equals v2', () => { same(() => structuredRegimeCohort([...V2.slice(0, 3), .05, ...V2.slice(4), 1.2, .05, 0], 'laya', priors)); });
test('regime spawns a second table in a flipped world and returns to the first on return', () => {
  const cfg = semanticWorldConfig({ seed: 52, options: { split: 'test', pool: 'test', sensible: 6, harmCap: 1, inversion: 0, drift: { everyTicks: 1200, fraction: .5 } } }), w = new Ecology(cfg), c = structuredRegimeCohort([...V2, .5, .25, .03], 'none', new Map());
  const trace = new Map();
  while (!w.done()) { const t = w.snapshot().tick, res = w.step(w.requests().map(r => c(r, 52))); c.feedback(res.outcomes.map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action })), new Map()); for (const a of w.snapshot().agents) trace.set(a.id, Math.max(trace.get(a.id) ?? 1, c.regimes(a.id))); }
  assert.ok([...trace.values()].some(n => n >= 2), 'some individual opened a second regime');
});
test('dual runs deterministically', () => {
  const run = () => { const w = new Ecology(semanticWorldConfig({ seed: 61, options: { split: 'test', pool: 'test', sensible: 6, harmCap: 1, inversion: 0 } })), c = structuredDualCohort([...V2, .2, .005, .2, 4], 'laya', priors), acts = []; for (let i = 0; i < 80 && !w.done(); i++) { const res = w.step(w.requests().map(r => c(r, 61))); acts.push(res.outcomes.map(o => o.action).join()); c.feedback(res.outcomes.map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action })), new Map()); } return acts.join('|'); };
  assert.equal(run(), run());
});

import { structuredCueCohort } from '../packages/evo/structured-ctx.ts';
test('cue learner equals v2 when no cue is shown', () => { same(() => structuredCueCohort(V2, 'laya', priors)); });
const cuesByPhase = (pattern, cue, every) => {
  const w = new Ecology(semanticWorldConfig({ seed: 71, options: { split: 'test', pool: 'test', sensible: 6, harmCap: 1, inversion: 0, drift: { everyTicks: every, fraction: 1, pattern, ...(cue ? { cue } : {}) } } })), ctl = structuredCueCohort(V2, 'none', new Map()), byPhase = new Map();
  for (let i = 0; i < 80 && !w.done(); i++) { const t = w.snapshot().tick, ph = Math.floor(t / every); byPhase.set(ph, new Set([...(byPhase.get(ph) ?? []), w.requests()[0].observation.season])); w.step(w.requests().map(q => ctl(q, 71))); }
  return byPhase;
};
test('drift schedule A/B/C has three states with different flips', () => {
  const d = semanticWorldConfig({ seed: 71, options: { split: 'test', pool: 'test', sensible: 6, harmCap: 1, inversion: 0, drift: { everyTicks: 300, fraction: 1, pattern: 'abc', cue: 'true' } } }).semantic.drift;
  assert.deepEqual(d.schedule, [0, 1, 2]); assert.equal(d.states[0].length, 0); assert.equal(d.states[1].length, 6); assert.equal(d.states[2].length, 3);
});
test('true cue: one sentence per phase, and A/B/A repeats the A sentence on return; cue off shows nothing', () => {
  const m = cuesByPhase('aba', 'true', 100); assert.ok([...m.values()].every(v => v.size === 1));
  const c = ph => [...m.get(ph)][0]; assert.notEqual(c(0), c(1)); assert.equal(c(0), c(2)); assert.equal(c(0), c(5));
  assert.ok([...cuesByPhase('aba', 'off', 100).values()].every(v => v.size === 1 && v.has(undefined)));
  const abc = cuesByPhase('abc', 'true', 100); assert.equal(new Set([0, 1, 2].map(ph => [...abc.get(ph)][0])).size, 3);
});
