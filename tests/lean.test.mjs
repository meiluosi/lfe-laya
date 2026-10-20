// 精简模式（Ecology.lean）：只读 outcomes / events 的调用方可以跳过整状态哈希与深拷贝。动力学必须与完整模式逐位一致：
// 对多种世界配置（普通池世界、延迟、漂移、成熟周期、社会观察）比较 runSemanticWorld 的完整返回值，以及两种模式下逐轮的 outcomes / events。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Ecology } from '../packages/sim/ecology.ts';
import { registerPools, loadLayaPriors } from '../packages/evo/pools.ts';
import { runSemanticWorld, semanticWorldConfig, blindRule, oracleRule } from '../packages/evo/semantic-run.ts';
import { structuredCohort } from '../packages/evo/structured.ts';

registerPools(); const priors = loadLayaPriors('test'), G = [1.1, .3, -.3, .05, .02, 1, 0, .3, 40];
const common = { split: 'test', pool: 'test', sensible: 12, harmCap: 4, inversion: .25 };
const CONFIGS = {
  plain: common, delay: { ...common, delay: 40 }, drift: { ...common, drift: { everyTicks: 600, fraction: .5 } },
  ripening: { ...common, sensible: 8, ripening: { seasonTicks: 200, cues: 'language', phrases: 'B', poolLimit: 1000 } },
  social: { ...common, delay: 20, social: { cues: 'language', phrases: 'B' } },
};
const run = (lean, options, factory, seed) => { process.env.LFE_LEAN = lean ? '1' : '0'; try { return runSemanticWorld({ seed, options }, factory); } finally { delete process.env.LFE_LEAN; } };

for (const [name, options] of Object.entries(CONFIGS)) {
  test(`lean and full modes give identical results: ${name}`, () => {
    for (const [fname, factory] of [['blind', blindRule], ['oracle', oracleRule], ['structured', () => structuredCohort(G, 'laya', priors)]])
      for (const seed of name === 'drift' ? [11] : [11, 12]) assert.deepEqual(run(true, options, factory, seed), run(false, options, factory, seed), `${name}/${fname}/${seed}`);
  });
}
test('round by round, lean outcomes and events equal the full mode, and the full mode is unchanged when lean is off', () => {
  const cfg = semanticWorldConfig({ seed: 5, options: CONFIGS.delay }), a = new Ecology(cfg), b = new Ecology(cfg); b.lean = true;
  const ctl = structuredCohort(G, 'laya', priors), ctl2 = structuredCohort(G, 'laya', priors);
  for (let i = 0; i < 60 && !a.done(); i++) {
    const ra = a.step(a.requests().map(q => ctl(q, 5))), rb = b.step(b.requests().map(q => ctl2(q, 5)));
    assert.deepEqual(ra.outcomes, rb.outcomes, `round ${i} outcomes`); assert.deepEqual(ra.events, rb.events, `round ${i} events`);
    assert.ok(ra.afterHash && ra.snapshot && ra.requests, '完整模式仍返回哈希、快照与请求'); assert.equal(rb.afterHash, undefined, '精简模式不返回哈希');
  }
  assert.deepEqual(a.snapshot().agents.map(x => x.energy), b.snapshot().agents.map(x => x.energy));
});
test('in lean mode each round still gets a unique snapshot id, so stale proposals are rejected', () => {
  const w = new Ecology(semanticWorldConfig({ seed: 5, options: CONFIGS.plain })); w.lean = true;
  const q0 = w.requests(), ids = [q0[0].identity.snapshotId]; const stale = q0.map(q => ({ identity: structuredClone(q.identity), action: 'rest', provider: 'test' }));
  assert.ok(w.step(stale).accepted); const q1 = w.requests(); ids.push(q1[0].identity.snapshotId); assert.notEqual(ids[0], ids[1]);
  assert.equal(w.step(stale).accepted, false, '上一轮的提案不能用于新一轮');
});
