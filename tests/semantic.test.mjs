// 语义食物（可选）：校验、能量账本、进食结算、观测不泄露隐藏真值、可复现与回放。默认关闭时世界与历史版本一致（黄金测试覆盖）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Ecology, stateHash } from '../packages/sim/ecology.ts';
import { ruleProposal, randomProposal } from '../packages/sim/controllers.ts';
import { Session, Replay } from '../packages/sim/session.ts';

const KINDS = [{ description: 'ripe and sweet berry', factor: 1 }, { description: 'rotten and foul-smelling berry', factor: -1 }, { description: 'dull grey lump', factor: .5 }];
const BASE = { width: 12, height: 10, initialAgents: 4, reproduction: false, mutation: false, maxAge: 100000, horizon: 1200, phaseTicks: 400, initialEnergy: 20, metabolism: .012, initialFood: 60, supplyAmount: 4, foodDecay: .003, diffusion: 0, deathReturn: 0 };
const make = (extra = {}) => new Ecology({ ...BASE, seed: 5, runId: 'semantic-test', semantic: { kinds: structuredClone(KINDS) }, ...extra });
const residual = s => { const { initial, supplied, ...losses } = s.ledger; return s.food.reduce((a, b) => a + b, 0) + s.agents.reduce((a, b) => a + b.energy, 0) + Object.values(losses).reduce((a, b) => a + b, 0) - initial - supplied; };
function edit(world, fn) {
  const s = world.snapshot(); fn(s);
  const { initial, supplied, ...losses } = s.ledger;
  s.ledger.initial = s.food.reduce((a, b) => a + b, 0) + s.agents.reduce((a, b) => a + b.energy, 0) + Object.values(losses).reduce((a, b) => a + b, 0) - supplied; world.restore(s);
}
const eatAt = (kind, energy = 20) => {
  const w = make({ initialAgents: 1, initialFood: 0 });
  edit(w, s => { const a = s.agents[0], cell = Math.floor(a.y) * s.config.width + Math.floor(a.x); s.food[cell] = 5; s.kinds[cell] = kind; a.energy = energy; });
  const before = w.snapshot().agents[0].energy, tickEnergy = () => w.snapshot().agents[0]?.energy ?? 0;
  const q = w.requests()[0]; assert.ok(q.candidates.some(c => c.id === 'eat'));
  const r = w.step([{ identity: q.identity, action: 'eat', provider: 'test-only' }]); assert.ok(r.accepted);
  return { before, after: tickEnergy(), snapshot: w.snapshot(), events: r.events };
};

test('semantic configuration is validated strictly', () => {
  for (const bad of [{ semantic: { kinds: [] } }, { semantic: { kinds: [{ description: 'a', factor: 2 }] } }, { semantic: { kinds: [{ description: 'a', factor: 1 }, { description: 'a', factor: 0 }] } },
    { semantic: { kinds: [{ description: 'ré', factor: 1 }] } }, { semantic: { kinds: [{ description: 'x'.repeat(81), factor: 1 }] } }, { semantic: { kinds: KINDS, extra: 1 } },
    { diffusion: .01 }, { deathReturn: .5 }]) assert.throws(() => make(bad), /invalid_semantic|semantic_requires|config_schema|invalid_config/, JSON.stringify(bad).slice(0, 60));
});
test('disabled by default: no kinds, no semantic ledger, config has no semantic key', () => {
  const w = new Ecology({ seed: 5, runId: 'plain' }), s = w.snapshot(); assert.equal(s.kinds, undefined); assert.equal(s.ledger.semanticLoss, undefined); assert.ok(!('semantic' in s.config));
});
test('energy ledger stays closed over a long semantic run, including toxic and partial-nutrition food', () => {
  const w = make({ horizon: 2400 });
  while (!w.done()) { const r = w.step(w.requests().map(q => randomProposal(q, 5))); assert.ok(r.accepted); assert.ok(Math.abs(residual(w.snapshot())) < 1e-6, 'ledger'); }
  const s = w.snapshot(); assert.ok(s.ledger.semanticLoss > 0, '应发生过语义损耗'); assert.ok(s.kinds.every(k => k >= -1 && k < 3));
});
test('eating applies the hidden factor: nutritious gains, toxic harms, partial food gains half', () => {
  const good = eatAt(0), bad = eatAt(1), half = eatAt(2);
  assert.ok(good.after > good.before - 1, `营养 ${good.before} → ${good.after}`); assert.ok(bad.after < bad.before - 1, `有毒 ${bad.before} → ${bad.after}`);
  assert.ok(good.after - half.after > 0.5, '半营养应少于全营养'); assert.ok(bad.events.some(e => e.kind === 'ate' && e.reason === 'toxic'));
  for (const r of [good, bad, half]) assert.ok(Math.abs(residual(r.snapshot)) < 1e-6);
});
test('observations carry descriptions for visible food and memory but never the hidden factor', () => {
  const w = make(); for (let i = 0; i < 20 && !w.done(); i++) w.step(w.requests().map(q => ruleProposal(q, 5)));
  const reqs = w.requests(), text = JSON.stringify(reqs); assert.ok(!/factor/.test(text), '隐藏真值不能进入观测');
  const descs = new Set(KINDS.map(k => k.description)); let seen = 0, mem = 0;
  for (const q of reqs) { for (const c of q.observation.local) { if (c.desc !== undefined) { assert.ok(descs.has(c.desc)); assert.ok(c.food > .05 && !c.blocked); seen++; } else assert.ok(c.food <= .05 || c.blocked); }
    for (const m of q.observation.memory) if (m.desc !== undefined) { assert.ok(descs.has(m.desc)); mem++; } }
  assert.ok(seen > 0 && mem > 0, `local ${seen}, memory ${mem}`);
});
test('kind persists while food remains and clears when the cell is empty; interventions assign or clear kinds', () => {
  const w = make({ initialAgents: 1, initialFood: 0, supplyAmount: .01, supplyEvery: 1000 });
  w.intervene({ kind: 'nutrient', x: 3, y: 3, amount: 4 }); let s = w.snapshot(), i = 3 * s.config.width + 3; assert.ok(s.kinds[i] >= 0 && s.food[i] > 0);
  const kind = s.kinds[i]; w.intervene({ kind: 'nutrient', x: 3, y: 3, amount: 1 }); assert.equal(w.snapshot().kinds[i], kind, '已有种类不变');
  w.intervene({ kind: 'obstacle', x: 3, y: 3, blocked: true }); s = w.snapshot(); assert.equal(s.kinds[i], -1); assert.equal(s.food[i], 0); assert.ok(Math.abs(residual(s)) < 1e-6);
});
test('semantic worlds are reproducible and replayable', async () => {
  const run = () => { const w = make(); while (!w.done()) w.step(w.requests().map(q => randomProposal(q, 9))); return stateHash(w.snapshot()); };
  assert.equal(run(), run());
  const s = new Session({ ...BASE, seed: 8, runId: 'semantic-replay', semantic: { kinds: structuredClone(KINDS) } }, async () => { throw Error('none'); });
  s.changeMode('rule'); s.resume(); for (let i = 0; i < 40; i++) await s.advance(true); s.intervene({ kind: 'nutrient', x: 2, y: 2, amount: 3 });
  const rec = s.export(), r = new Replay(rec); r.seek(r.total); assert.equal(stateHash(r.world.snapshot()), stateHash(s.world.snapshot()));
  r.seek(7); const mid = stateHash(r.world.snapshot()); r.seek(r.total); r.seek(7); assert.equal(stateHash(r.world.snapshot()), mid);
});

test('drift flips the real effect of chosen kinds in odd phases only (A/B/A), keeps the ledger closed, validates strictly', () => {
  const drift = { everyTicks: 200, flip: [0] };
  assert.throws(() => make({ semantic: { kinds: structuredClone(KINDS), drift: { everyTicks: 50, flip: [0] } } }), /invalid_semantic_drift/);
  assert.throws(() => make({ semantic: { kinds: structuredClone(KINDS), drift: { everyTicks: 200, flip: [7] } } }), /invalid_semantic_drift/);
  assert.throws(() => make({ semantic: { kinds: structuredClone(KINDS), drift: { everyTicks: 200, flip: [0, 0] } } }), /invalid_semantic_drift/);
  const gain = (tick) => {
    const w = make({ initialAgents: 1, initialFood: 0, semantic: { kinds: structuredClone(KINDS), drift } });
    edit(w, s => { s.tick = tick; const a = s.agents[0], cell = Math.floor(a.y) * s.config.width + Math.floor(a.x); s.food[cell] = 5; s.kinds[cell] = 0; a.energy = 20; });
    const q = w.requests()[0], before = w.snapshot().agents[0].energy; w.step([{ identity: q.identity, action: 'eat', provider: 'test-only' }]);
    assert.ok(Math.abs(residual(w.snapshot())) < 1e-6); return w.snapshot().agents[0].energy - before;
  };
  assert.ok(gain(0) > 1, '阶段 0：有益'); assert.ok(gain(200) < -1, '阶段 1：反转为有毒'); assert.ok(gain(400) > 1, '阶段 2：恢复（A/B/A）');
});
