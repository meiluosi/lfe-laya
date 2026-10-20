// 后验采样个体：基因解码；temp = 0 时等价于 curiosity = 0、retry = 0 的 v2 个体；采样确定且随不确定度缩小；信念只属于个体。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Ecology } from '../packages/sim/ecology.ts';
import { structuredCohort } from '../packages/evo/structured.ts';
import { structuredBayesCohort, decodeBayesGenes, BAYES_GENES } from '../packages/evo/structured-bayes.ts';
import { semanticWorldConfig, loadPriors } from '../packages/evo/semantic-run.ts';

const priors = loadPriors(), V2 = [Math.log(3), 0, -.3, .05, 0, 1, 0, .3, 0];   // curiosity = 0，retry = 0
test('bayes genes decode within bounds', () => { assert.equal(BAYES_GENES, 10); assert.throws(() => decodeBayesGenes(V2), /genome_size/); assert.equal(decodeBayesGenes([...V2, 100]).temp, 3); assert.equal(decodeBayesGenes([...V2, -1]).temp, 0); });
test('with temp = 0 the individual behaves exactly like the v2 individual without curiosity and retry', () => {
  const cfg = () => semanticWorldConfig({ seed: 33, options: { split: 'test', inversion: .25 } }), a = structuredCohort(V2, 'laya', priors), b = structuredBayesCohort([...V2, 0], 'laya', priors), w1 = new Ecology(cfg()), w2 = new Ecology(cfg());
  const fb = (c, res) => c.feedback(res.outcomes.map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action })), new Map());
  for (let i = 0; i < 120 && !w1.done(); i++) { const p1 = w1.requests().map(r => a(r, 33)), p2 = w2.requests().map(r => b(r, 33)); assert.deepEqual(p1.map(p => p.action), p2.map(p => p.action)); fb(a, w1.step(p1)); fb(b, w2.step(p2)); }
});
test('with temp > 0 decisions are reproducible and differ from the deterministic ones', () => {
  const run = temp => { const c = structuredBayesCohort([...V2, temp], 'laya', priors), w = new Ecology(semanticWorldConfig({ seed: 7, options: { split: 'test', inversion: .25 } })), acts = [];
    for (let i = 0; i < 80 && !w.done(); i++) { const ps = w.requests().map(q => c(q, 7)); acts.push(...ps.map(p => p.action)); const r = w.step(ps); c.feedback(r.outcomes.map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action })), new Map()); }
    return acts.join(','); };
  assert.equal(run(1.5), run(1.5)); assert.notEqual(run(1.5), run(0));
});
