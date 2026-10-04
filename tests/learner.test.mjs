// 终身学习层：只改后天参数；隔离、冻结、拒绝非有限输入、参数截断、可复现；并在受控赌博机上确实学到更好的动作。
import test from 'node:test';
import assert from 'node:assert/strict';
import { N_FEATURES } from '../packages/evo/features.ts';
import { Policy, INNATE_SIZE, ACQUIRED_SIZE, uniform } from '../packages/evo/policy.ts';
import { DEFAULT_LEARNER, LifetimeState, learn } from '../packages/evo/learner.ts';
import { learningController, runWorld } from '../packages/evo/evaluate.ts';

const zeroGenome = () => new Float64Array(INNATE_SIZE);
const x0 = () => { const x = new Float64Array(N_FEATURES); x[0] = 1; x[2] = .5; return x; };
/** 两个合法动作（下标 0 与 1）的 softmax 概率，其余为 0。 */
const probs2 = (p, x) => { const z = p.logits(x), m = Math.max(z[0], z[1]), a = Math.exp(z[0] - m), b = Math.exp(z[1] - m); const pr = new Float64Array(7); pr[0] = a / (a + b); pr[1] = b / (a + b); return pr; };
function bandit(policy, state, cfg, steps, seed = 1) {
  const x = x0();
  for (let t = 0; t < steps; t++) {
    const pr = probs2(policy, x), action = uniform(seed, 'life-0', t) < pr[0] ? 0 : 1;
    learn(policy, state, cfg, { x, probs: pr, action }, action === 0 ? 0.5 : -0.5, x);
  }
  return probs2(policy, x)[0];
}

test('learning raises the probability of the rewarded action and never touches the innate genome', () => {
  const g = zeroGenome(), p = new Policy(g), s = new LifetimeState(), innateBefore = Array.from(p.innate);
  const before = probs2(p, x0())[0]; assert.ok(Math.abs(before - .5) < 1e-9);
  const after = bandit(p, s, DEFAULT_LEARNER, 400);
  assert.ok(after > .85, `P(rewarded) ${after.toFixed(3)} 应明显提高`); assert.ok(s.updates === 400);
  assert.deepEqual(Array.from(p.innate), innateBefore, '先天参数必须逐位不变'); assert.ok(p.acquired.some(v => v !== 0));
});
test('two individuals learn independently from their own experience', () => {
  const a = new Policy(zeroGenome()), b = new Policy(zeroGenome()), sa = new LifetimeState(), sb = new LifetimeState();
  bandit(a, sa, DEFAULT_LEARNER, 300); assert.ok(b.acquired.every(v => v === 0) && sb.critic.every(v => v === 0) && sb.updates === 0);
});
test('frozen learning changes nothing; non-finite feedback is rejected atomically', () => {
  const p = new Policy(zeroGenome()), s = new LifetimeState(), x = x0(), pr = probs2(p, x);
  assert.equal(learn(p, s, { ...DEFAULT_LEARNER, frozen: true }, { x, probs: pr, action: 0 }, 1, x), null); assert.ok(p.acquired.every(v => v === 0) && s.updates === 0);
  for (const bad of [NaN, Infinity]) assert.equal(learn(p, s, DEFAULT_LEARNER, { x, probs: pr, action: 0 }, bad, x), null);
  const badNext = x0(); badNext[1] = NaN; assert.equal(learn(p, s, DEFAULT_LEARNER, { x, probs: pr, action: 0 }, 1, badNext), null);
  assert.ok(p.acquired.every(v => v === 0) && s.critic.every(v => v === 0) && s.updates === 0 && s.rejected === 3);
});
test('parameters are clipped and eligibility traces are cleared when a life ends', () => {
  const p = new Policy(zeroGenome()), s = new LifetimeState(), cfg = { ...DEFAULT_LEARNER, alphaActor: 50, clipParam: 1.5 }, x = x0(), pr = probs2(p, x);
  for (let i = 0; i < 20; i++) learn(p, s, cfg, { x, probs: pr, action: 0 }, 5, x);
  assert.ok(p.acquired.every(v => Math.abs(v) <= 1.5 + 1e-12)); assert.ok(s.traceActor.some(v => v !== 0));
  learn(p, s, cfg, { x, probs: pr, action: 0 }, -1, null); assert.ok(s.traceActor.every(v => v === 0) && s.traceCritic.every(v => v === 0));
  assert.equal(ACQUIRED_SIZE, 7 * N_FEATURES);
});
test('in a real world: reproducible, learning happens per agent, innate genomes stay unchanged', () => {
  const g = Float64Array.from({ length: INNATE_SIZE }, (_, i) => i === INNATE_SIZE - 1 ? 0 : Math.sin(i * 1.3) * .3), spec = { scenario: 'scarce', seed: 223 };
  const c1 = learningController(g), r1 = runWorld(spec, c1), c2 = learningController(g), r2 = runWorld(spec, c2);
  assert.deepEqual(r1, r2); assert.ok(c1.policies.size === 8);
  for (const [id, p] of c1.policies) { assert.deepEqual(Array.from(p.innate), Array.from(g)); assert.ok(c1.states.get(id).updates > 0, `${id} 应有更新`); }
  const arrays = new Set([...c1.policies.values()].map(p => p.acquired)); assert.equal(arrays.size, 8, '每个个体各自的后天参数');
});
