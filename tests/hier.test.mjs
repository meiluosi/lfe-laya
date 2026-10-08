// W5b 层次信念：基因解码、share=0 时与 v2 完全一致、邻居证据只来自该个体自己的经历且按相似度加权。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Ecology } from '../packages/sim/ecology.ts';
import { structuredCohort } from '../packages/evo/structured.ts';
import { structuredHierCohort, decodeHierGenes, HIER_GENES } from '../packages/evo/structured-hier.ts';
import { semanticWorldConfig, loadPriors } from '../packages/evo/semantic-run.ts';

const priors = loadPriors(), V2 = [Math.log(3), .3, -.3, .05, .02, 1, 0, .3, 0];

test('hier genes decode within bounds and the size is checked', () => {
  assert.equal(HIER_GENES, 11);
  const hi = decodeHierGenes([...V2, 100, 100]), lo = decodeHierGenes([...V2, -100, -100]);
  assert.deepEqual([hi.share, hi.thr, lo.share, lo.thr], [3, .95, 0, .2]);
  assert.throws(() => decodeHierGenes(V2), /genome_size/);
});
test('with share = 0 the hierarchical individual behaves exactly like the v2 individual', () => {
  const emb = new Map(); const a = structuredCohort(V2, 'laya', priors), b = structuredHierCohort([...V2, 0, .5], 'laya', priors, emb);
  const w1 = new Ecology(semanticWorldConfig({ seed: 33, options: { split: 'test', inversion: .25 } })), w2 = new Ecology(semanticWorldConfig({ seed: 33, options: { split: 'test', inversion: .25 } }));
  const fb = (c, res) => c.feedback(res.outcomes.map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action })), new Map());
  for (let i = 0; i < 120 && !w1.done(); i++) {
    const r1 = w1.requests(), r2 = w2.requests(), p1 = r1.map(r => a(r, 33)), p2 = r2.map(r => b(r, 33));
    assert.deepEqual(p1.map(p => p.action), p2.map(p => p.action));
    fb(a, w1.step(p1)); fb(b, w2.step(p2));
  }
});
test('neighbour evidence is weighted by similarity and belongs to the individual', () => {
  const A = 'alpha', B = 'beta', C = 'gamma', emb = new Map([[A, [1, 0]], [B, [Math.SQRT1_2, Math.SQRT1_2]], [C, [0, 1]]]);
  const c = structuredHierCohort([...V2, 2, .5], 'none', new Map(), emb);
  c.beliefs.set('x', new Map([[A, { n: 3, sum: -3 }]]));
  const w = (Math.SQRT1_2 - .5) / .5, nb = c.neighbors('x', B);
  assert.ok(Math.abs(nb.n - 2 * w * 3) < 1e-9 && Math.abs(nb.sum + 2 * w * 3) < 1e-9);
  assert.deepEqual(c.neighbors('x', C), { n: 0, sum: 0 }, '正交的描述不共享');
  assert.deepEqual(c.neighbors('y', B), { n: 0, sum: 0 }, '别的个体的经历不会泄露给 y');
  assert.deepEqual(c.neighbors('x', A), { n: 0, sum: 0 }, '自己的证据不重复计入邻居');
});
