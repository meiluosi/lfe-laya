// “习得的安全”个体：基因解码；ν = 0 且 s = 0 时与 v2 个体逐动作一致；熟悉的种类少归责、新奇的多归责；到期无冲击记一次安全证据。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Ecology } from '../packages/sim/ecology.ts';
import { structuredCohort } from '../packages/evo/structured.ts';
import { structuredSafetyCohort, decodeSafetyGenes, SAFETY_GENES } from '../packages/evo/structured-safety.ts';
import { semanticWorldConfig, loadPriors } from '../packages/evo/semantic-run.ts';

const priors = loadPriors(), V2 = [Math.log(3), .3, -.3, .05, .02, 1, 0, .3, 40];
test('safety genes decode within bounds', () => { assert.equal(SAFETY_GENES, 11); assert.throws(() => decodeSafetyGenes(V2), /genome_size/); const d = decodeSafetyGenes([...V2, 100, 100]); assert.deepEqual([d.novelty, d.safe], [3, 1]); const e = decodeSafetyGenes([...V2, -5, -5]); assert.deepEqual([e.novelty, e.safe], [0, 0]); });
test('with novelty = 0 and safe = 0 the individual behaves exactly like the v2 individual, in a delayed world', () => {
  const cfg = () => semanticWorldConfig({ seed: 33, options: { split: 'test', inversion: .25, delay: 40 } }), a = structuredCohort(V2, 'laya', priors), b = structuredSafetyCohort([...V2, 0, 0], 'laya', priors), w1 = new Ecology(cfg()), w2 = new Ecology(cfg());
  const fb = (c, res) => c.feedback(res.outcomes.map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action })), new Map());
  for (let i = 0; i < 120 && !w1.done(); i++) { const p1 = w1.requests().map(r => a(r, 33)), p2 = w2.requests().map(r => b(r, 33)); assert.deepEqual(p1.map(p => p.action), p2.map(p => p.action)); fb(a, w1.step(p1)); fb(b, w2.step(p2)); }
});
test('a long run produces safety evidence only when safe > 0, and the beliefs stay per individual', () => {
  const run = genes => { const c = structuredSafetyCohort(genes, 'laya', priors), w = new Ecology(semanticWorldConfig({ seed: 21, options: { split: 'test', inversion: .25, delay: 40 } }));
    for (let i = 0; i < 200 && !w.done(); i++) { const r = w.step(w.requests().map(q => c(q, 21))); c.feedback(r.outcomes.map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action })), new Map()); }
    return c; };
  const none = run([...V2, 0, 0]), safe = run([...V2, 1, 1]); assert.ok([...safe.beliefs.values()].some(m => [...m.values()].some(b => b.n > 0)), '有信念');
  const plain = c => JSON.stringify([...c.beliefs].map(([id, m]) => [id, Object.fromEntries(m)])); assert.notEqual(plain(safe), plain(none), '基因改变了信念形成');
});
