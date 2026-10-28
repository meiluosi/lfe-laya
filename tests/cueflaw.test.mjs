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

test('G13 world: dense alternation (300-tick phases) and a second cue channel; channel 1 is unchanged by adding channel 2; flaws are independent per channel', () => {
  const mk2 = drift => new Ecology(semanticWorldConfig({ seed: 91, options: { split: 'test', pool: 'test', sensible: 6, harmCap: 1, inversion: 0, horizon: 6000, drift: { everyTicks: 300, fraction: 1, pattern: 'alt', cue: 'paraphrase', ...drift } } }));
  const at = (w, ticks) => { const out = []; for (const t of ticks) { while (w.tick < t) w.step(w.requests().map(q => ({ identity: q.identity, action: 'rest', provider: 't', distribution: { rest: 1 } }))); out.push(w.requests()[0]?.observation.season); } return out; };
  const ticks = Array.from({ length: 20 }, (_, i) => i * 300 + 5), single = at(mk2({}), ticks), double = at(mk2({ cue2: { bank: 'llm' } }), ticks);
  assert.equal(single.length, 20); assert.deepEqual(double.map(x => x.split('||')[0]), single);
  const llmAll = new Set(['A', 'B', 'C'].flatMap(k => llm[k])); double.forEach(x => assert.ok(llmAll.has(x.split('||')[1])));
  const states = Array.from({ length: 20 }, (_, i) => i % 2); double.forEach((x, i) => assert.ok(setOf(llm, ['A', 'B'][states[i]], false).has(x.split('||')[1])));
  const miss = at(mk2({ cue2: { bank: 'llm', flaw: { missing: 1, wrong: 0 } } }), ticks); miss.forEach((x, i) => { assert.equal(x.split('||')[1], ''); assert.equal(x.split('||')[0], single[i]); });
  const both = at(mk2({ cueFlaw: { missing: 1, wrong: 0 }, cue2: { bank: 'llm', flaw: { missing: 1, wrong: 0 } } }), ticks); assert.ok(both.every(x => x === undefined));
  const ind = at(mk2({ cue2: { bank: 'llm', flaw: { missing: 0, wrong: 1 } } }), ticks); ind.forEach((x, i) => { assert.equal(x.split('||')[0], single[i]); assert.ok(!setOf(llm, ['A', 'B'][states[i]], false).has(x.split('||')[1])); });
});
