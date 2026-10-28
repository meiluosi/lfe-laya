// G12 世界：线索缺陷（缺失 / 误导，默认关闭）与 LLM 措辞库。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Ecology } from '../packages/sim/ecology.ts';
import { semanticWorldConfig } from '../packages/evo/semantic-run.ts';
import { registerPools } from '../packages/evo/pools.ts';

registerPools();
const mk = (extra, cue = 'paraphrase') => new Ecology(semanticWorldConfig({ seed: 71, options: { split: 'test', pool: 'test', sensible: 6, harmCap: 1, inversion: 0, horizon: 6000, drift: { everyTicks: 1200, fraction: 1, pattern: 'abab', cue, ...extra } } }));
const seen = w => { const out = []; for (let p = 0; p < 5; p++) { while (w.tick < p * 1200 + 5) w.step(w.requests().map(q => ({ identity: q.identity, action: 'rest', provider: 't', distribution: { rest: 1 } }))); out.push(w.requests()[0]?.observation.season); } return out; };
const author = JSON.parse(readFileSync('packages/evo/cues.json', 'utf8')), llm = JSON.parse(readFileSync('packages/evo/cues-llm.json', 'utf8'));
const setOf = (src, k, both) => new Set(both ? [...src[k].train, ...src[k].eval] : src[k]);
test('no flaw: identical to the plain paraphrase world; missing = 1 hides every cue; wrong = 1 always shows another state\'s sentence; deterministic', () => {
  assert.deepEqual(seen(mk({})), seen(mk({ cueFlaw: undefined })));
  assert.ok(seen(mk({ cueFlaw: { missing: 1, wrong: 0 } })).every(x => x === undefined));
  const w = seen(mk({ cueFlaw: { missing: 0, wrong: 1 } })), again = seen(mk({ cueFlaw: { missing: 0, wrong: 1 } })); assert.deepEqual(w, again);
  const truth = [0, 1, 0, 1, 0], keys = ['A', 'B', 'C'];
  w.forEach((t, p) => { const own = setOf(author, keys[truth[p]], true); assert.ok(!own.has(t) && ['A', 'B', 'C'].some(k => setOf(author, k, true).has(t)), `phase ${p}`); });
  const none = seen(mk({})); none.forEach((t, p) => assert.ok(setOf(author, keys[truth[p]], true).has(t)));
});
test('true cue with wrong = 1 shows a different state\'s fixed sentence; partial rates are between the extremes', () => {
  const plain = seen(mk({}, 'true')), wrong = seen(mk({ cueFlaw: { missing: 0, wrong: 1 } }, 'true')); plain.forEach((t, p) => assert.notEqual(wrong[p], t));
  let hidden = 0, total = 0; for (let k = 0; k < 6; k++) { const w = new Ecology(semanticWorldConfig({ seed: 80 + k, options: { split: 'test', pool: 'test', sensible: 6, harmCap: 1, inversion: 0, horizon: 6000, drift: { everyTicks: 1200, fraction: 1, pattern: 'abab', cue: 'paraphrase', cueFlaw: { missing: .5, wrong: 0 } } } })); for (const t of seen(w)) { total++; if (t === undefined) hidden++; } }
  assert.ok(hidden > 3 && hidden < total - 3, `${hidden}/${total}`);
});
test('LLM wording bank: 12 distinct sentences per state, no overlap with the author sentences; paraphrase from it draws only from that bank', () => {
  for (const k of ['A', 'B', 'C']) { assert.equal(new Set(llm[k]).size, 12); for (const t of llm[k]) assert.ok(!setOf(author, k, true).has(t)); }
  const s = seen(mk({ cueBank: 'llm' })), truth = [0, 1, 0, 1, 0], keys = ['A', 'B', 'C']; s.forEach((t, p) => assert.ok(setOf(llm, keys[truth[p]], false).has(t)));
});
