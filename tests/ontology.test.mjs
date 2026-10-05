// 生成式本体：确定性、唯一性、线索可靠度、方言分离、描述合法（ASCII、长度），以及词典基线的行为。
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateEntry, generatePool, genericLexiconScore, vaderLexiconScore, trainLexicon, TIER_FACTOR } from '../packages/evo/ontology.ts';

const tokens = s => new Set(s.toLowerCase().match(/[a-z']+/g));
test('pools are deterministic, unique, valid protocol descriptions and cover all tiers', () => {
  const a = generatePool('train', 400, 1), b = generatePool('train', 400, 1), c = generatePool('train', 400, 2);
  assert.deepEqual(a, b); assert.notDeepEqual(a.map(e => e.text), c.map(e => e.text)); assert.equal(new Set(a.map(e => e.text)).size, 400);
  for (const e of [...a, ...generatePool('test', 400, 1)]) { assert.match(e.text, /^[ -~]{1,240}$/); assert.ok(e.factor === TIER_FACTOR[e.tier]); }
  const tiers = new Set(a.map(e => e.tier)); for (const t of ['nutritive', 'mild', 'strong', 'lethal']) assert.ok(tiers.has(t), `缺 ${t}`);
  const toxic = a.filter(e => e.factor < 0).length / a.length; assert.ok(toxic > .4 && toxic < .6, `毒性占比 ${toxic}`);
});
test('cue reliability matches rho0: the cues point to the true class about as often as requested', () => {
  for (const rho0 of [1, .9, .6]) {
    const pool = generatePool('train', 3000, 5, { rho0, uninformative: 0 }); let agree = 0, total = 0;
    for (const e of pool) { const truePos = e.factor > 0; if (e.cuePolarity !== 0) { total++; if ((e.cuePolarity > 0) === truePos) agree++; } }
    const rate = agree / total;
    if (rho0 === 1) assert.equal(rate, 1); else assert.ok(rate > .5 && rate < 1, `rho0=${rho0} 实测一致率 ${rate}`);
  }
  const noisy = generatePool('train', 3000, 5, { rho0: .6, uninformative: 0 }), clean = generatePool('train', 3000, 5, { rho0: 1, uninformative: 0 });
  const rate = p => p.filter(e => (e.cuePolarity > 0) === (e.factor > 0) && e.cuePolarity !== 0).length / p.filter(e => e.cuePolarity !== 0).length; assert.ok(rate(noisy) < rate(clean) - .1);
});
test('train and test dialects are lexically distinct (the test dialect is novel language)', () => {
  const tr = new Set(), te = new Set(); generatePool('train', 1500, 1).forEach(e => tokens(e.text).forEach(w => tr.add(w))); generatePool('test', 1500, 1).forEach(e => tokens(e.text).forEach(w => te.add(w)));
  const shared = [...te].filter(w => tr.has(w)).length / te.size; assert.ok(shared < .3, `测试方言词汇与训练共享 ${shared.toFixed(2)}`);
  const trainTexts = new Set(generatePool('train', 1500, 1).map(e => e.text)); assert.ok(generatePool('test', 300, 1).every(e => !trainTexts.has(e.text)));
});
test('lexicon baselines: trained lexicon is good in-dialect and near chance on the new dialect; generic lexicon is a fair partial reader', () => {
  const train = generatePool('train', 4000, 1, { rho0: 1 }), test = generatePool('test', 1500, 9, { rho0: 1 }), trainTest = generatePool('train', 1500, 9, { rho0: 1 });
  const lex = trainLexicon(train), acc = (pool, f) => { const informative = pool.filter(e => e.cuePolarity !== 0); return informative.filter(e => (f(e.text) > 0) === (e.factor > 0)).length / informative.length; };
  const inDialect = acc(trainTest, lex), novel = acc(test, lex), generic = acc(test, genericLexiconScore);
  assert.ok(inDialect > .9, `词典在训练方言内 ${inDialect}`); assert.ok(novel < inDialect - .15, `新方言上应明显变差：${novel}`);
  assert.ok(generic > .55 && generic < .95, `通用词典在新方言 ${generic}`);
  assert.ok(genericLexiconScore('rotten and putrid') < 0 && genericLexiconScore('fresh and sweet') > 0);
  assert.ok(genericLexiconScore('not the least bit spoiled') <= 0, '简单词典读不懂隔了几个词的否定——这是它与语言模型的差别所在');
});
test('a single entry is reproducible from the random stream', () => {
  const mk = () => { let s = 7; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; return generateEntry(r, 'test'); }; assert.deepEqual(mk(), mk());
});

import { registerPools, loadLayaPriors, shuffledPrior, noisyPrior, FnPriors, genericLexiconPrior } from '../packages/evo/pools.ts';
import { makeKinds, semanticConfig } from '../packages/evo/semantic.ts';
import { Ecology } from '../packages/sim/ecology.ts';

test('worlds built from a pool: K kinds, balanced classes, deterministic, deception flips truth, harm is capped, config validates', () => {
  const pools = registerPools(), truth = new Map(pools.test.map(e => [e.text, e.factor]));
  const kinds = makeKinds(5, { split: 'test', pool: 'test', sensible: 24 }), again = makeKinds(5, { split: 'test', pool: 'test', sensible: 24 });
  assert.deepEqual(kinds, again); assert.equal(kinds.length, 24); assert.equal(new Set(kinds.map(k => k.description)).size, 24);
  const good = kinds.filter(k => k.factor > 0).length; assert.equal(good, 12); assert.ok(kinds.every(k => k.factor >= -1), '默认危害上限 1');
  const deadly = makeKinds(6, { split: 'test', pool: 'test', sensible: 60, harmCap: 4 }); assert.ok(deadly.some(k => k.factor < -1), '放开上限后出现更强的毒');
  const flipped = makeKinds(5, { split: 'test', pool: 'test', sensible: 24, inversion: 1 }), none = makeKinds(5, { split: 'test', pool: 'test', sensible: 24, inversion: 0 });
  assert.ok(flipped.every(k => Math.sign(k.factor) === -Math.sign(truth.get(k.description))), '全反转：每种食物的真实影响都与描述的类别相反');
  assert.ok(none.every(k => Math.sign(k.factor) === Math.sign(truth.get(k.description))), '不反转：与描述类别一致');
  const w = new Ecology({ width: 16, height: 12, diffusion: 0, deathReturn: 0, seed: 5, runId: 'pool-world', ...semanticConfig(5, { split: 'test', pool: 'test', sensible: 24 }) }); assert.equal(w.snapshot().config.semantic.kinds.length, 24);
  assert.throws(() => makeKinds(5, { split: 'test', pool: 'nope', sensible: 4 }), /pool_not_registered/);
});
test('prior controls: shuffled keeps the marginal but breaks the match; noisy flips a fraction; lexicon priors answer for any text', () => {
  const base = new Map([...Array(200)].map((_, i) => [`t${i}`, i / 199])), sh = shuffledPrior(base, 3), no = noisyPrior(base, .25, 3);
  assert.deepEqual([...sh.values()].sort(), [...base.values()].sort()); assert.ok([...base].filter(([t, v]) => sh.get(t) === v).length < 20);
  const changed = [...base].filter(([t, v]) => Math.abs(no.get(t) - v) > 1e-9 && Math.abs(no.get(t) - (1 - v)) < 1e-9).length; assert.ok(changed > 20 && changed < 90, `被翻转 ${changed}/200`);
  const lex = genericLexiconPrior(); assert.ok(lex instanceof FnPriors && lex.get('fresh and sweet') > .5 && lex.get('rotten and putrid') < .5 && lex.get('unknown words') === .5);
  void loadLayaPriors;
});

test('independent VADER lexicon: loads, scores sentiment words, handles close negation, and knows fewer of the dialect words than the authored one', () => {
  assert.ok(vaderLexiconScore('fresh and healthy') > 0 && vaderLexiconScore('rotten and foul') < 0);
  assert.ok(vaderLexiconScore('not healthy') < vaderLexiconScore('healthy'), '近距离否定会降低分数');
  const pool = generatePool('test', 2000, 3, { rho0: 1 }).filter(e => e.cuePolarity !== 0);
  const acc = f => pool.filter(e => (f(e.text) > 0) === (e.factor > 0)).length / pool.length;
  const vader = acc(vaderLexiconScore), own = acc(genericLexiconScore);
  assert.ok(vader > .5 && vader < .95, `VADER 在新方言 ${vader}`); assert.ok(own >= vader - .02, `作者自写词典应不弱于独立词典（可能有词重合）：${own} vs ${vader}`);
});
