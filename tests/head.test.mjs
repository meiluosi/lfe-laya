// 先天线性头：基因解码、读出只依赖文本嵌入、none 与 laya 的组合方式、权重为 0 时与 v2 个体一致、信念仍只来自经历。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Ecology } from '../packages/sim/ecology.ts';
import { structuredCohort } from '../packages/evo/structured.ts';
import { structuredHeadCohort, decodeHeadGenes, HEAD_GENES, HEAD_DIM } from '../packages/evo/structured-head.ts';
import { semanticWorldConfig, loadPriors } from '../packages/evo/semantic-run.ts';

const priors = loadPriors(), V2 = [Math.log(3), .3, -.3, .05, .02, 1, 0, .3, 0];
test('head genes decode and the size is checked', () => {
  assert.equal(HEAD_GENES, 9 + HEAD_DIM + 1); assert.throws(() => decodeHeadGenes(V2), /genome_size/);
  const d = decodeHeadGenes([...V2, ...new Array(HEAD_DIM).fill(.5), .25]); assert.equal(d.w.length, HEAD_DIM); assert.equal(d.b, .25);
});
test('with an all-zero head the individual behaves exactly like the v2 individual', () => {
  const emb = new Map(), a = structuredCohort(V2, 'laya', priors), b = structuredHeadCohort([...V2, ...new Array(HEAD_DIM).fill(0), 0], 'laya', priors, emb);
  const w1 = new Ecology(semanticWorldConfig({ seed: 33, options: { split: 'test', inversion: .25 } })), w2 = new Ecology(semanticWorldConfig({ seed: 33, options: { split: 'test', inversion: .25 } }));
  const fb = (c, res) => c.feedback(res.outcomes.map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action })), new Map());
  for (let i = 0; i < 100 && !w1.done(); i++) { const p1 = w1.requests().map(r => a(r, 33)), p2 = w2.requests().map(r => b(r, 33)); assert.deepEqual(p1.map(p => p.action), p2.map(p => p.action)); fb(a, w1.step(p1)); fb(b, w2.step(p2)); }
});
test('the readout depends only on the cached text embedding, and combines with (or replaces) the Laya judgement', () => {
  const e = new Float32Array(HEAD_DIM); e[0] = 1; const emb = new Map([['tasty thing', e], ['other thing', new Float32Array(HEAD_DIM)]]), w = new Array(HEAD_DIM).fill(0); w[0] = 3;
  const none = structuredHeadCohort([...V2, ...w, 0], 'none', new Map(), emb), laya = structuredHeadCohort([...V2, ...w, 0], 'laya', new Map([['tasty thing', .9], ['other thing', .5]]), emb);
  assert.ok(Math.abs(none.innate('tasty thing') - Math.tanh(3)) < 1e-6); assert.equal(none.innate('other thing'), 0);
  assert.ok(laya.innate('tasty thing') >= none.innate('tasty thing') - 1e-9, 'Laya 看好时不低于单独的头'); assert.equal(none.innate('unknown text'), 0, '没有嵌入的文本：头的输出为 0（再加偏置）');
});
