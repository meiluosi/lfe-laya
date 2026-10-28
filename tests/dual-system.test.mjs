// G11 双系统 harness：无需联网（桩 LLM）。系统 1 退化时与 plain 逐窗口一致；触发器与动作执行器；记录 / 回放；提示里不含隐藏真值。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDualWorld, recorded, parseDecision, buildPrompt } from '../packages/evo/dual-system.ts';
import { runSemanticWorld } from '../packages/evo/semantic-run.ts';
import { structuredCohort } from '../packages/evo/structured.ts';
import { registerPools, loadLayaPriors } from '../packages/evo/pools.ts';

registerPools(); const priors = loadLayaPriors('test'), genes = JSON.parse(readFileSync('experiments/evo/dev-aba-laya-plain-201/final.json', 'utf8')).innate;
const base = { seed: 600003, pool: 'test', K: 6, pattern: 'aba', cue: 'off', genes, priors };
const stub = text => async r => ({ text: typeof text === 'function' ? text(r) : text, model: 'stub', promptTokens: 100, completionTokens: 20, ms: 1 });

test('P equals the plain cohort window by window; managed with an unreachable trigger also equals plain (no hidden switching)', async () => {
  const ref = runSemanticWorld({ seed: base.seed, options: { split: 'test', pool: 'test', sensible: 6, harmCap: 1, inversion: 0, horizon: 3600, drift: { everyTicks: 1200, fraction: 1, pattern: 'aba', cue: 'off' } } }, () => structuredCohort(genes, 'laya', priors), 200);
  const p = await runDualWorld({ ...base, mode: 'P' }), t = await runDualWorld({ ...base, mode: 'T', thr: 1e9 });
  assert.deepEqual(p.windows, ref.windows); assert.deepEqual(t.windows, ref.windows); assert.equal(t.triggers, 0);
});
test('T (rule action) triggers after the reversal, applies table operations, and is deterministic', async () => {
  const a = await runDualWorld({ ...base, mode: 'T' }), b = await runDualWorld({ ...base, mode: 'T' });
  assert.ok(a.triggers > 0 && a.applied > 0, JSON.stringify(a)); assert.deepEqual(a.windows, b.windows); assert.equal(a.calls, 0);
});
test('S2 with a stub LLM: calls happen, decisions are applied, garbage output counts as a parse failure and changes nothing', async () => {
  const good = await runDualWorld({ ...base, mode: 'S2', llm: stub('{"decision":"new","note":"the foods flipped"}') });
  assert.ok(good.calls > 0 && good.applied > 0 && good.decisions.new > 0 && good.parseFails === 0);
  const bad = await runDualWorld({ ...base, mode: 'S2', llm: stub('not json') });
  assert.ok(bad.calls > 0 && bad.parseFails === bad.calls && bad.applied === 0);
  const keep = await runDualWorld({ ...base, mode: 'S2', llm: stub('{"decision":"keep"}') }), p = await runDualWorld({ ...base, mode: 'P' });
  assert.deepEqual(keep.windows, p.windows);   // 一律“保持”等于没有系统 2
});
test('per-individual call cap is enforced', async () => {
  const r = await runDualWorld({ ...base, mode: 'S2', maxCalls: 1, llm: stub('{"decision":"keep"}') }); assert.ok(r.calls <= 8);
});
test('record / replay: the second run needs no model; a missing prompt fails loudly in replay mode', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'llm-')), 'log.jsonl'); let live = 0;
  const inner = async r => { live++; return { text: '{"decision":"new"}', model: 'stub', promptTokens: 1, completionTokens: 1, ms: 1 }; };
  const a = await runDualWorld({ ...base, mode: 'S2', llm: recorded(inner, path, 'stub') }), n1 = live;
  const b = await runDualWorld({ ...base, mode: 'S2', llm: recorded(null, path, 'stub', 'replay') });
  assert.equal(live, n1); assert.deepEqual(a.windows, b.windows); assert.equal(b.cached, b.calls);
  await assert.rejects(runDualWorld({ ...base, seed: base.seed + 1, mode: 'S2', llm: recorded(null, path, 'stub', 'replay') }), /replay_miss/);
});
test('prompts contain only the individual\'s own experience: no hidden factors or phase names; S2c adds the visible cue, S2 does not; S2x scrambles outcomes', async () => {
  const seen = { S2: [], S2c: [], S2x: [] };
  for (const mode of ['S2', 'S2c', 'S2x']) await runDualWorld({ ...base, cue: 'true', mode, llm: stub(r => { seen[mode].push(r); return '{"decision":"keep"}'; }) });
  const all = [...seen.S2, ...seen.S2c, ...seen.S2x].map(r => r.system + r.user).join('\n');
  assert.ok(!/factor|phase|reversal|state [AB]|hidden/i.test(all.replace(/foods that used to restore energy start to cost energy \(or the reverse\)/g, '').replace(/Sometimes the world changes[^.]*\./g, '')), 'no hidden truth words');
  assert.ok(seen.S2c.some(r => r.user.includes('[sky:')) && !seen.S2.some(r => r.user.includes('[sky:')) && !seen.S2x.some(r => r.user.includes('[sky:')));
  assert.notEqual(seen.S2.map(r => r.user).join(), seen.S2x.map(r => r.user).join());
});
test('parseDecision accepts fenced JSON and rejects invalid decisions', () => {
  assert.deepEqual(parseDecision('```json\n{"decision":"switch","table":1,"note":"back to the old one"}\n```'), { decision: 'switch', table: 1, note: 'back to the old one' });
  assert.equal(parseDecision('{"decision":"explode"}'), null); assert.equal(parseDecision('{"decision":'), null);
});
