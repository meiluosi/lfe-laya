// 语义世界决策层：信念更新、先天/后天隔离、特征只看自己的观测、合法性、可复现。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Ecology } from '../packages/sim/ecology.ts';
import { validateProposal } from '../packages/protocol/ecology.ts';
import { FoodBeliefs, semanticFeatures, semanticCohort, SEM_INNATE_SIZE, SEM_INNATE_SIZE_V1, N_SEM_FEATURES, NONSENSE_DEFAULT_V0 } from '../packages/evo/sempolicy.ts';
import { runSemanticWorld, semanticWorldConfig, loadPriors } from '../packages/evo/semantic-run.ts';
import { ruleProposal } from '../packages/sim/controllers.ts';

const priors = loadPriors(), genome = (seed = 1) => { let x = seed; return Float64Array.from({ length: SEM_INNATE_SIZE }, (_, i) => i >= SEM_INNATE_SIZE - 2 ? 0 : Math.sin(x += 1.3) * .4); };
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const GOOD = 'ripe and sweet berry', BAD = 'rotten and foul-smelling berry';

test('Laya prior table: edible > harmful on both vocabularies; nonsense is uninformative', () => {
  assert.ok(priors.get(GOOD) > .5 && priors.get(BAD) < .5);
  assert.equal(priors.size, 256);
});
test('beliefs combine the prior with the individual\'s own experience; trust sets how fast they move', () => {
  const lay = new FoodBeliefs({ prior: 'laya', learning: true }, priors, 2), v0 = 2 * priors.get(GOOD) - 1;
  assert.ok(Math.abs(lay.value(GOOD) - v0) < 1e-12);
  lay.record(GOOD, -1); lay.record(GOOD, -1); assert.ok(Math.abs(lay.value(GOOD) - (2 * v0 - 2) / 4) < 1e-12);
  const stubborn = new FoodBeliefs({ prior: 'laya', learning: true }, priors, 1000); stubborn.record(GOOD, -1); assert.ok(Math.abs(stubborn.value(GOOD) - v0) < .01);
  const blind = new FoodBeliefs({ prior: 'none', learning: true }, priors, 2); assert.equal(blind.value(GOOD), 0); blind.record(GOOD, 1); assert.ok(blind.value(GOOD) > 0);
  const off = new FoodBeliefs({ prior: 'laya', learning: false }, priors, 2); off.record(GOOD, -1); assert.ok(Math.abs(off.value(GOOD) - v0) < 1e-12, '关闭终身学习时经验不起作用');
  assert.equal(new FoodBeliefs({ prior: 'laya', learning: true }, priors, 2).value('zzz unknown thing'), NONSENSE_DEFAULT_V0);
  assert.equal(lay.value(undefined), .5);
});
test('features are finite, fixed-length, read-only on the request, and honour the belief about each description', () => {
  const w = new Ecology(semanticWorldConfig({ seed: 11, options: { split: 'train' } })); let sawGood = false;
  for (let i = 0; i < 60 && !w.done(); i++) {
    const rs = w.requests(), b = new FoodBeliefs({ prior: 'laya', learning: false }, priors, 3);
    for (const r of rs) { const f = semanticFeatures(deepFreeze(structuredClone(r)), b); assert.equal(f.length, N_SEM_FEATURES); assert.ok(f.every(Number.isFinite)); }
    w.step(rs.map(r => ruleProposal(r, 11)));
  }
  // 同一观测下，改变对某描述词的信念会改变特征
  const rs = w.requests(), r = rs.find(q => q.observation.local.some(c => c.desc && Math.hypot(c.dx, c.dy) > .5));
  if (r) { const a = new FoodBeliefs({ prior: 'none', learning: true }, priors, 1), c = new FoodBeliefs({ prior: 'none', learning: true }, priors, 1); const d = r.observation.local.find(x => x.desc && Math.hypot(x.dx, x.dy) > .5).desc; c.record(d, 1); c.record(d, 1);
    assert.notDeepEqual([...semanticFeatures(r, a)], [...semanticFeatures(r, c)]); sawGood = true; }
  assert.ok(sawGood);
});
test('cohort: legal reproducible proposals; beliefs are per individual; innate genome never changes; hidden truth never reaches the policy', () => {
  const g = genome(), copy = Array.from(g), cohort = semanticCohort(g, { prior: 'laya', learning: true }, priors);
  const w = new Ecology(semanticWorldConfig({ seed: 21, options: { split: 'test', inversion: .25 } }));
  for (let i = 0; i < 80 && !w.done(); i++) {
    const rs = w.requests(); assert.ok(!/factor/.test(JSON.stringify(rs)));
    const ps = rs.map(r => cohort(r, 21)); ps.forEach((p, k) => assert.equal(validateProposal(rs[k], p), null));
    const res = w.step(ps); cohort.feedback(res.outcomes.map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action })), new Map());
  }
  assert.deepEqual(Array.from(g), copy); assert.ok(cohort.beliefs.size >= 2);
  const all = [...cohort.beliefs.values()]; assert.ok(all.some(b => b.experience.size > 0), '应有个体吃过东西并形成经验'); assert.equal(new Set(all.map(b => b.experience)).size, all.length);
});
test('evaluation is reproducible; same seed and genome give identical results', () => {
  const run = () => runSemanticWorld({ seed: 31, options: { split: 'test', inversion: 0 } }, () => semanticCohort(genome(3), { prior: 'laya', learning: true }, priors));
  assert.deepEqual(run(), run());
});

test('curiosity (an innate gene) adds an exploration bonus that fades with the individual\'s own experience, only when learning is on', () => {
  const ambiguous = 'blimzor zordro-textured lump';
  const curious = new FoodBeliefs({ prior: 'laya', learning: true }, priors, 3, .5), plain = new FoodBeliefs({ prior: 'laya', learning: true }, priors, 3, 0);
  assert.ok(Math.abs(curious.value(ambiguous) - plain.value(ambiguous) - .5) < 1e-12, '没试过：加成 = 好奇心');
  curious.record(ambiguous, -1); plain.record(ambiguous, -1);
  assert.ok(Math.abs(curious.value(ambiguous) - plain.value(ambiguous) - .25) < 1e-12, '试过一次：加成减半');
  const off = new FoodBeliefs({ prior: 'laya', learning: false }, priors, 3, .5); assert.equal(off.value(ambiguous), new FoodBeliefs({ prior: 'laya', learning: false }, priors, 3, 0).value(ambiguous), '学习关闭时没有好奇心加成');
});
test('older genomes (without the curiosity gene) still load and behave as curiosity = 0', () => {
  assert.equal(SEM_INNATE_SIZE, SEM_INNATE_SIZE_V1 + 1);
  const old = Float64Array.from({ length: SEM_INNATE_SIZE_V1 }, (_, i) => Math.sin(i) * .2), cohort = semanticCohort(old, { prior: 'laya', learning: true }, priors);
  const w = new Ecology(semanticWorldConfig({ seed: 5, options: { split: 'test' } })), rs = w.requests(); assert.equal(validateProposal(rs[0], cohort(rs[0], 5)), null);
  assert.throws(() => semanticCohort(new Float64Array(10), { prior: 'laya', learning: true }, priors), /innate_size/);
});
