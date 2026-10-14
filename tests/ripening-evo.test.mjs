// W7 在进化沙盒中的接入：成熟周期配置的生成是确定性的、与种类一致；阶段化描述来自预先约定的短语；预言机知道阶段、盲规则不知道；先验表载入阶段化文本。
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerPools, loadLayaPriors } from '../packages/evo/pools.ts';
import { semanticConfig, STAGE_PHRASES, RIPENING_MULTIPLIERS } from '../packages/evo/semantic.ts';
import { runSemanticWorld, oracleRule, blindRule } from '../packages/evo/semantic-run.ts';

registerPools();
const opts = (extra = {}) => ({ split: 'test', pool: 'test', sensible: 16, harmCap: 4, inversion: 0, ripening: { seasonTicks: 200, cues: 'language', phrases: 'B', poolLimit: 1000, ...extra } });
test('ripening configuration is deterministic and consistent with the kinds', () => {
  const a = semanticConfig(7, opts()), b = semanticConfig(7, opts()), c = semanticConfig(8, opts());
  assert.deepEqual(a, b); assert.notDeepEqual(a.semantic.ripening.offsets, c.semantic.ripening.offsets);
  const r = a.semantic.ripening; assert.deepEqual(r.multipliers, RIPENING_MULTIPLIERS); assert.deepEqual(r.stageText, STAGE_PHRASES.B);
  assert.deepEqual(r.perishable, a.semantic.kinds.map(k => k.factor > 0)); assert.ok(r.offsets.every(o => o >= 0 && o <= 3));
  assert.ok(a.semantic.kinds.every(k => k.description.length + 1 + 40 <= 240), '基础描述 + 阶段短语仍在 240 个字符内');
  assert.equal(semanticConfig(7, { ...opts(), ripening: undefined }).semantic.ripening, undefined, '不设置则完全关闭');
});
test('poolLimit restricts the pool so that every shown text can have a cached prior', () => {
  const kinds = semanticConfig(11, opts({ poolLimit: 50 })).semantic.kinds.map(k => k.description), allowed = new Set(JSON.parse(JSON.stringify(registerPools().test.slice(0, 50).map(e => e.text))));
  assert.ok(kinds.every(d => allowed.has(d)));
});
test('the oracle knows the stage and beats the blind rule in a ripening world; cue modes do not change the oracle', () => {
  const run = (f, extra = {}, seed = 31) => runSemanticWorld({ seed, options: opts(extra) }, f);
  let o = 0, b = 0; for (const seed of [31, 32, 33]) { o += run(oracleRule, {}, seed).fitness; b += run(blindRule, {}, seed).fitness; }
  assert.ok(o > b + 0.05, `oracle ${o / 3} 应明显高于 blind ${b / 3}`);
  for (const cues of ['off', 'shuffled']) { const f = run(oracleRule, { cues }, 31).fitness, g = run(oracleRule, {}, 31).fitness; assert.ok(Math.abs(f - g) < 1e-9, `${cues}：预言机的结算不依赖线索模式`); }
});
test('shown descriptions are base + the agreed stage phrase, and never reveal the stage multiplier', () => {
  const cfg = semanticConfig(5, opts()), phrases = new Set(STAGE_PHRASES.B);
  const spec = { seed: 5, options: opts() }; let seen = 0;
  runSemanticWorld(spec, () => q => { for (const c of q.observation.local) if (c.desc) { const k = cfg.semantic.kinds.find(k => c.desc.startsWith(k.description + ' ')); assert.ok(k && phrases.has(c.desc.slice(k.description.length + 1)), c.desc); seen++; } assert.ok(!/multiplier|perishable/.test(JSON.stringify(q))); return { identity: q.identity, action: 'rest', provider: 'test-only' }; });
  assert.ok(seen > 0);
});
