// 延迟抖动（delay.spread/mode）：缺省关闭且不改变既有行为；抖动的延迟落在 [ticks−spread, ticks+spread]；按种类固定的延迟只有两档；同配置可复现；能量账本平衡。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Ecology } from '../packages/sim/ecology.ts';
import { semanticWorldConfig, runSemanticWorld, blindRule } from '../packages/evo/semantic-run.ts';
import { registerPools } from '../packages/evo/pools.ts';

registerPools();
const opts = extra => ({ split: 'test', pool: 'test', sensible: 32, harmCap: 4, inversion: .25, delay: 60, ...extra });
const dues = (extra, seed = 77) => {
  const w = new Ecology(semanticWorldConfig({ seed, options: opts(extra) })), seen = [], ctl = blindRule();
  for (let i = 0; i < 150 && !w.done(); i++) { const before = w.state.tick; w.step(w.requests().map(r => ctl(r, seed))); for (const a of w.state.agents) for (const p of a.pending ?? []) seen.push(p.due - before); }
  return seen;
};
test('spread and mode must come together and stay within bounds', () => {
  assert.throws(() => new Ecology(semanticWorldConfig({ seed: 1, options: opts({ delaySpread: 80, delayMode: 'jitter' }) })), /invalid_semantic_delay/);
  assert.doesNotThrow(() => new Ecology(semanticWorldConfig({ seed: 1, options: opts({ delaySpread: 30, delayMode: 'jitter' }) })));
});
test('default delay is unchanged (fixed) and jitter stays within the interval', () => {
  const fixed = dues({}), jit = dues({ delaySpread: 30, delayMode: 'jitter' });
  assert.ok(fixed.length > 0 && jit.length > 0);
  assert.ok(new Set(jit).size > new Set(fixed).size, 'jitter spreads the due times');
  const lo = Math.min(...jit), hi = Math.max(...jit); assert.ok(lo >= 1 && hi <= 90 + 10, `${lo}..${hi}`);
});
test('per-kind delay takes only two values per kind and is reproducible', () => {
  const a = runSemanticWorld({ seed: 78, options: opts({ delaySpread: 30, delayMode: 'kind' }) }, blindRule), b = runSemanticWorld({ seed: 78, options: opts({ delaySpread: 30, delayMode: 'kind' }) }, blindRule);
  assert.deepEqual(a, b);
  const j1 = runSemanticWorld({ seed: 78, options: opts({ delaySpread: 30, delayMode: 'jitter' }) }, blindRule), j2 = runSemanticWorld({ seed: 78, options: opts({ delaySpread: 30, delayMode: 'jitter' }) }, blindRule);
  assert.deepEqual(j1, j2);
  assert.notDeepEqual(a, runSemanticWorld({ seed: 78, options: opts({}) }, blindRule));
});
