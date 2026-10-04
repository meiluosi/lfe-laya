// 路线 D 的进化沙盒：特征不越权、先天/后天隔离、合法性、确定性、评估纯净。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Ecology } from '../packages/sim/ecology.ts';
import { validateProposal } from '../packages/protocol/ecology.ts';
import { extractFeatures, N_FEATURES, PERCEPT_LABELS } from '../packages/evo/features.ts';
import { Policy, INNATE_SIZE, ACQUIRED_SIZE, uniform } from '../packages/evo/policy.ts';
import { evaluate, policyController, ruleController, randomController, runWorld, BASE, SCENARIOS } from '../packages/evo/evaluate.ts';

const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const genome = (seed = 3) => { let x = seed; return Float64Array.from({ length: INNATE_SIZE }, (_, i) => i === INNATE_SIZE - 1 ? 0 : (Math.sin(x += 1.7) * 0.5)); };
function sampleRequests(n = 120) {
  const w = new Ecology({ ...BASE, ...SCENARIOS.moderate, seed: 77, runId: 'evo-test' }), out = [];
  while (out.length < n && !w.done()) { const rs = w.requests(); out.push(...rs); w.step(rs.map(r => ruleController(r, 77))); }
  return out.slice(0, n);
}

test('features are finite, fixed-length, depend only on the request, and never mutate it', () => {
  for (const r of sampleRequests()) {
    const copy = structuredClone(r), f = extractFeatures(deepFreeze(r)); // 冻结后若写入会抛错
    assert.equal(f.length, N_FEATURES); assert.ok(f.every(Number.isFinite)); assert.deepEqual(extractFeatures(copy), f);
  }
});
test('percept slots are zero without Laya and filled with a presence flag when given', () => {
  const r = sampleRequests(1)[0], none = extractFeatures(r), p = [.1, .2, .3, .1, .2, .1], some = extractFeatures(r, p);
  const base = N_FEATURES - (PERCEPT_LABELS.length + 1);
  assert.ok(none.slice(base).every(x => x === 0)); assert.deepEqual([...some.slice(base, base + 6)], p); assert.equal(some[N_FEATURES - 1], 1);
  assert.throws(() => extractFeatures(r, [1, 2]), /percept_length/);
});
test('innate and acquired parameters are isolated; acquired starts at zero and changes behaviour only when set', () => {
  const g = genome(), a = new Policy(g), b = new Policy(g);
  assert.equal(a.acquired.length, ACQUIRED_SIZE); assert.ok(a.acquired.every(x => x === 0));
  g[0] += 100; assert.notEqual(a.innate[0], g[0], '策略必须复制基因组，外部改动不影响已出生个体');
  const x = extractFeatures(sampleRequests(1)[0]), before = [...a.logits(x)];
  a.acquired[0] = 5; assert.notDeepEqual([...a.logits(x)], before); assert.deepEqual([...b.logits(x)], before, '一个个体的后天参数不影响另一个');
  assert.throws(() => new Policy(new Float64Array(3)), /innate_size/);
});
test('proposals are always legal, normalised, reproducible, and independent across agents', () => {
  const policy = new Policy(genome(5));
  for (const r of sampleRequests()) {
    const p1 = policy.propose(r, 77), p2 = policy.propose(r, 77);
    assert.equal(validateProposal(r, p1), null); assert.deepEqual(p1, p2);
    const sum = Object.values(p1.distribution).reduce((a, b) => a + b, 0); assert.ok(Math.abs(sum - 1) < 1e-9);
    assert.equal(validateProposal(r, policy.propose(r, 77, null, true)), null);
  }
  const us = ['life-0', 'life-1', 'life-2', 'life-3'].map(id => uniform(1, id, 10)); assert.equal(new Set(us).size, 4);
});
test('cohort controller gives every agent its own acquired parameters', () => {
  const c = policyController(genome()), rs = sampleRequests(8); for (const r of rs) c(r, 77);
  const ids = new Set(rs.map(r => r.identity.agentId)); assert.equal(c.policies.size, ids.size);
  const [p0, p1] = [...c.policies.values()]; assert.notEqual(p0.acquired, p1.acquired); assert.notEqual(p0.innate, p1.innate);
  p0.acquired[3] = 9; assert.equal(p1.acquired[3], 0, '后天参数互不影响');
  assert.deepEqual(c(rs[0], 77), c(rs[0], 77));
});
test('evaluation is deterministic and bounded; rule beats random on development worlds', () => {
  const specs = [{ scenario: 'scarce', seed: 223 }];
  const a = evaluate(policyController(genome()), specs), b = evaluate(policyController(genome()), specs);
  assert.deepEqual(a, b); for (const k of ['survival', 'lowEnergy', 'energyFraction', 'fitness']) assert.ok(a[k] >= 0 && a[k] <= 1.0001, k);
  assert.ok(evaluate(ruleController, specs).fitness > evaluate(randomController, specs).fitness);
});
test('golden: zero-genome policy on a fixed world is unchanged', () => {
  const r = runWorld({ scenario: 'moderate', seed: 211 }, policyController(new Float64Array(INNATE_SIZE)));
  const expected = { survival: 0.766493, deaths: 5, living: 3 };
  assert.deepEqual({ survival: +r.survival.toFixed(6), deaths: r.deaths, living: r.living }, expected);
});
