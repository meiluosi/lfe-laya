// W8b 社会观察（可选）：配置校验、默认关闭、邻居的外观与最近进食随后果出现和消退、线索三种模式、不泄露隐藏真值、账本闭合与可复现。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Ecology, stateHash } from '../packages/sim/ecology.ts';
import { randomProposal } from '../packages/sim/controllers.ts';

const HARM = ['doubled over, clutching its belly', 'pale and shaking'], BOOST = ['lively and full of energy', 'bright-eyed and strong'], CALM = ['going about its business', 'wandering slowly'];
const social = (extra = {}) => ({ cues: 'language', window: 300, lookTicks: 60, harmText: HARM, boostText: BOOST, calmText: CALM, ...extra });
const KINDS = [{ description: 'round pale tuber', factor: 1 }, { description: 'deadly black bulb', factor: -1 }];
const BASE = { width: 12, height: 10, initialAgents: 2, reproduction: false, mutation: false, maxAge: 100000, horizon: 2400, phaseTicks: 400, initialEnergy: 20, metabolism: .0001, initialFood: 0, supplyAmount: 0, foodDecay: 0, diffusion: 0, deathReturn: 0 };
const make = (soc = social(), extra = {}, semantic = {}) => new Ecology({ ...BASE, seed: 5, runId: 'social-test', semantic: { kinds: structuredClone(KINDS), ...(soc ? { social: soc } : {}), ...semantic }, ...extra });
const residual = s => { const { initial, supplied, ...losses } = s.ledger; return s.food.reduce((a, b) => a + b, 0) + s.agents.reduce((a, b) => a + b.energy, 0) + Object.values(losses).reduce((a, b) => a + b, 0) - initial - supplied; };
function setup(w, kind, amount = 6) {   // 两个个体相邻；第一个站在食物上
  const s = w.snapshot(), [a, b] = s.agents; b.x = a.x + .6; b.y = a.y; const cell = Math.floor(a.y) * s.config.width + Math.floor(a.x); s.food[cell] = amount; s.kinds[cell] = kind;
  const { initial, supplied, ...losses } = s.ledger; s.ledger.initial = s.food.reduce((x, y) => x + y, 0) + s.agents.reduce((x, y) => x + y.energy, 0) + Object.values(losses).reduce((x, y) => x + y, 0) - supplied; w.restore(s); return { a: a.id, b: b.id };
}
const round = (w, actions) => { const rs = w.requests(), r = w.step(rs.map(q => ({ identity: q.identity, action: actions[q.identity.agentId] ?? 'rest', provider: 'test-only' }))); assert.ok(r.accepted); assert.ok(Math.abs(residual(w.snapshot())) < 1e-6, 'ledger'); };
const neighborView = (w, observer) => w.requests().find(q => q.identity.agentId === observer).observation.neighbors[0];

test('social configuration is validated strictly', () => {
  for (const bad of [social({ cues: 'maybe' }), social({ window: 5 }), social({ lookTicks: 1000 }), social({ harmText: [] }), social({ harmText: ['x'.repeat(81)] }), social({ boostText: ['café'] }), social({ extra: 1 }), social({ calmText: undefined })])
    assert.throws(() => make(bad), /invalid_semantic/, JSON.stringify(bad).slice(0, 60));
});
test('disabled by default and with cues off: neighbours carry only position and shape', () => {
  for (const soc of [null, social({ cues: 'off' })]) { const w = make(soc), { a, b } = setup(w, 1); round(w, { [a]: 'eat' }); assert.deepEqual(Object.keys(neighborView(w, b)).sort(), ['dx', 'dy', 'shape']); }
});
test('a neighbour who ate something harmful looks harmed and its recent meal is visible; the look fades, the meal record expires', () => {
  const w = make(), { a, b } = setup(w, 1), before = neighborView(w, b); assert.ok(CALM.includes(before.look) && before.ate === undefined);
  round(w, { [a]: 'eat' }); const after = neighborView(w, b);
  assert.ok(HARM.includes(after.look), after.look); assert.deepEqual(after.ate, ['deadly black bulb']);
  for (let i = 0; i < 8; i++) round(w, {}); const later = neighborView(w, b);
  assert.ok(CALM.includes(later.look), `外观会消退：${later.look}`); assert.deepEqual(later.ate, ['deadly black bulb'], '进食记录仍在窗口内');
  for (let i = 0; i < 40; i++) round(w, {}); assert.equal(neighborView(w, b).ate, undefined, '进食记录过期');
});
test('a neighbour who ate something nourishing looks well; shuffled swaps the two looks', () => {
  const view = cues => { const w = make(social({ cues })), { a, b } = setup(w, 0); round(w, { [a]: 'eat' }); return neighborView(w, b).look; };
  assert.ok(BOOST.includes(view('language')), view('language')); assert.ok(HARM.includes(view('shuffled')), view('shuffled'));
});
test('with delay, the look appears when the effect lands, not when the food is eaten', () => {
  const w = make(social(), {}, { delay: { ticks: 20 } }), { a, b } = setup(w, 1);
  round(w, { [a]: 'eat' }); assert.ok(CALM.includes(neighborView(w, b).look), '刚吃下时外观没有变化'); assert.ok(neighborView(w, b).ate, '但吃了什么是可见的');
  round(w, {}); round(w, {}); round(w, {}); assert.ok(HARM.includes(neighborView(w, b).look), '效果生效后外观变化');
});
test('observations never carry the hidden truth; the ledger stays closed and replays are bit-identical', () => {
  const w = make(), { a, b } = setup(w, 1); round(w, { [a]: 'eat' }); assert.ok(!/factor|multiplier|perishable|toxic|harmText|boostText/.test(JSON.stringify(w.requests())));
  const run = () => { const x = make(social(), { initialAgents: 6, initialFood: 60, supplyAmount: 4, foodDecay: .003, metabolism: .012, horizon: 1500 });
    while (!x.done()) { const r = x.step(x.requests().map(q => randomProposal(q, 5))); assert.ok(r.accepted); assert.ok(Math.abs(residual(x.snapshot())) < 1e-6); } return stateHash(x.snapshot()); };
  assert.equal(run(), run());
});
