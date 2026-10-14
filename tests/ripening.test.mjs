// W7 成熟周期与季节（可选）：配置校验、默认关闭、阶段随 tick 循环、阶段化结算、线索三种模式、账本闭合、可复现、不泄露隐藏真值。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Ecology, stateHash } from '../packages/sim/ecology.ts';
import { randomProposal } from '../packages/sim/controllers.ts';

const STAGES = ['still green and hard', 'at its peak', 'going soft and sour', 'rotting where it lies'];
const SEASONS = [['buds are opening on the hedges'], ['the days are long and warm'], ['the days are growing short and the leaves turn red'], ['frost lies on the ground each morning']];
const KINDS = [{ description: 'round pale tuber', factor: 1 }, { description: 'deadly black bulb', factor: -1 }];
const ripening = (extra = {}) => ({ seasonTicks: 100, offsets: [0, 0], perishable: [true, false], multipliers: [.2, 1, -.4, -1], cues: 'language', stageText: STAGES, seasonText: SEASONS, ...extra });
const BASE = { width: 12, height: 10, initialAgents: 1, reproduction: false, mutation: false, maxAge: 100000, horizon: 2400, phaseTicks: 400, initialEnergy: 20, metabolism: .0001, initialFood: 0, supplyAmount: 0, foodDecay: 0, diffusion: 0, deathReturn: 0 };
const make = (rip = ripening(), extra = {}) => new Ecology({ ...BASE, seed: 5, runId: 'ripening-test', semantic: { kinds: structuredClone(KINDS), ...(rip ? { ripening: rip } : {}) }, ...extra });
const residual = s => { const { initial, supplied, ...losses } = s.ledger; return s.food.reduce((a, b) => a + b, 0) + s.agents.reduce((a, b) => a + b.energy, 0) + Object.values(losses).reduce((a, b) => a + b, 0) - initial - supplied; };
function placeFood(w, kind, amount = 5, energy = 10) {
  const s = w.snapshot(), a = s.agents[0], cell = Math.floor(a.y) * s.config.width + Math.floor(a.x); s.food[cell] = amount; s.kinds[cell] = kind; a.energy = energy;
  const { initial, supplied, ...losses } = s.ledger; s.ledger.initial = s.food.reduce((x, y) => x + y, 0) + a.energy + Object.values(losses).reduce((x, y) => x + y, 0) - supplied; w.restore(s);
}
const act = (w, action) => { const q = w.requests()[0]; const r = w.step([{ identity: q.identity, action, provider: 'test-only' }]); assert.ok(r.accepted); return r; };
const eatGain = (stage, kind = 0) => { const w = make(ripening({ offsets: [stage, stage] })); placeFood(w, kind); const before = w.snapshot().agents[0].energy; act(w, 'eat'); return w.snapshot().agents[0].energy - before; };

test('ripening configuration is validated strictly', () => {
  for (const bad of [ripening({ seasonTicks: 10 }), ripening({ seasonTicks: 1.5 }), ripening({ offsets: [0] }), ripening({ offsets: [0, 4] }), ripening({ perishable: [true] }), ripening({ multipliers: [1, 1, 1] }),
    ripening({ multipliers: [1, 1, 1, 2] }), ripening({ stageText: STAGES.slice(0, 3) }), ripening({ stageText: ['a', 'b', 'c', 'x'.repeat(41)] }), ripening({ stageText: ['a', 'b', 'c', 'café'] }), ripening({ seasonText: [[], ['a'], ['b'], ['c']] }),
    ripening({ cues: 'maybe' }), ripening({ extra: 1 })]) assert.throws(() => make(bad), /invalid_semantic/, JSON.stringify(bad).slice(0, 60));
  assert.throws(() => new Ecology({ ...BASE, seed: 5, runId: 'x', semantic: { kinds: [{ description: 'y'.repeat(200), factor: 1 }], ripening: ripening({ offsets: [0], perishable: [true] }) } }), /invalid_semantic/, '描述 + 阶段短语超过 240');
});
test('disabled by default: no season field, descriptions are the plain kind descriptions', () => {
  const w = make(null); placeFood(w, 0); const q = w.requests()[0];
  assert.equal(q.observation.season, undefined); assert.equal(q.observation.local.find(c => c.desc)?.desc, 'round pale tuber');
});
test('the stage cycles with the tick and the description follows it', () => {
  const w = make(); placeFood(w, 0, 5); const seen = [];
  for (let i = 0; i < 70 && !w.done(); i++) { const q = w.requests()[0], d = q.observation.local.find(c => c.desc && Math.hypot(c.dx, c.dy) < .5)?.desc; if (d && !seen.includes(d)) seen.push(d); act(w, 'rest'); }
  assert.deepEqual(seen, STAGES.map(s => `round pale tuber ${s}`), '一个完整周期内依次出现四个阶段');
});
test('settlement follows the hidden stage multiplier for perishable kinds, and ignores it for the others', () => {
  const gains = [0, 1, 2, 3].map(st => eatGain(st));   // 营养类（因子 1）：青涩 ×0.2、成熟 ×1、过熟 ×−0.4、腐败 ×−1
  assert.ok(gains[1] > gains[0] && gains[0] > 0, `${gains}`); assert.ok(gains[2] < 0 && gains[3] < gains[2], `${gains}`);
  assert.ok(Math.abs(gains[1] / gains[0] - 5) < 0.5, `成熟与青涩的收益比约 5：${gains}`);
  const toxic = [0, 1, 2, 3].map(st => eatGain(st, 1)); assert.ok(toxic.every(g => g < 0) && Math.max(...toxic) - Math.min(...toxic) < 1e-9, `不会腐败的种类与阶段无关：${toxic}`);
});
test('cue modes: language shows the true stage, shuffled shows a mismatched one, off shows nothing (value still follows the stage)', () => {
  const seenIn = cues => { const w = make(ripening({ cues, offsets: [1, 1] })); placeFood(w, 0); const q = w.requests()[0]; return { desc: q.observation.local.find(c => c.desc).desc, season: q.observation.season }; };
  const lang = seenIn('language'), shuf = seenIn('shuffled'), off = seenIn('off');
  assert.equal(lang.desc, `round pale tuber ${STAGES[1]}`); assert.equal(lang.season, SEASONS[0][0]);           // tick 0：季节 0，种类 0 的阶段 = 1（成熟）
  assert.equal(shuf.desc, `round pale tuber ${STAGES[3]}`); assert.equal(shuf.season, SEASONS[2][0]);          // 错配：+2
  assert.equal(off.desc, 'round pale tuber'); assert.equal(off.season, undefined);
  const gain = cues => { const w = make(ripening({ cues, offsets: [1, 1] })); placeFood(w, 0); const e = w.snapshot().agents[0].energy; act(w, 'eat'); return w.snapshot().agents[0].energy - e; };
  assert.ok(Math.abs(gain('language') - gain('off')) < 1e-9 && Math.abs(gain('language') - gain('shuffled')) < 1e-9, '线索模式不改变真实结算');
});
test('observations never carry the hidden truth (factors, multipliers, perishable flags, offsets)', () => {
  const w = make(); placeFood(w, 0); const text = JSON.stringify(w.requests());
  assert.ok(!/multiplier|perishable|offsets|factor|seasonTicks/.test(text), text.slice(0, 200));
});
test('the energy ledger stays closed over a long ripening run, and replays are bit-identical', () => {
  const run = () => { const w = make(ripening({ offsets: [0, 2] }), { initialAgents: 4, initialFood: 60, supplyAmount: 4, foodDecay: .003, metabolism: .012, horizon: 1800 });
    while (!w.done()) { const r = w.step(w.requests().map(q => randomProposal(q, 5))); assert.ok(r.accepted); assert.ok(Math.abs(residual(w.snapshot())) < 1e-6, 'ledger'); } return stateHash(w.snapshot()); };
  assert.equal(run(), run());
});
