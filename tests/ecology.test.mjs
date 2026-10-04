import test from 'node:test';
import assert from 'node:assert/strict';
import { Ecology, stateHash } from '../packages/sim/ecology.ts';
import { ruleProposal, randomProposal } from '../packages/sim/controllers.ts';

const choose = (world, action = 'rest') => world.requests().map(r => ({ identity: r.identity, action: typeof action === 'function' ? action(r) : action, provider: 'test-only' }));
function place(world, edit) {
  const s = world.snapshot(); edit(s);
  const { initial, supplied, ...losses } = s.ledger;
  s.ledger.initial = s.food.reduce((a, b) => a + b, 0) + s.agents.reduce((a, b) => a + b.energy, 0) + Object.values(losses).reduce((a, b) => a + b, 0) - supplied;
  world.restore(s);
}
test('configuration rejects nonfinite, invalid bounds, unsafe budgets', () => {
  for (const config of [{ seed: 0 }, { width: 100 }, { initialEnergy: NaN }, { birthEnergy: 100 }, { foodDecay: 1.1 }, { diffusion: .3 }, { obstacles: [1, 1] }, { maxAgents: 257 }, { decisionTicks: 0 }]) assert.throws(() => new Ecology(config));
});
test('barrier is atomic; duplicate, illegal, stale retries and restore cannot execute', () => {
  const w = new Ecology(); const ps = choose(w), before = w.snapshot();
  assert.equal(w.step(ps.slice(1)).accepted, false);
  assert.equal(w.step([ps[0], ps[0], ...ps.slice(2)]).accepted, false);
  assert.equal(w.step(ps.map((p, i) => i ? p : { ...p, action: 'teleport' })).accepted, false);
  assert.deepEqual(w.snapshot(), before);
  w.retry(ps[0].identity.agentId); assert.equal(w.step(ps).accepted, false);
  const now = choose(w); assert.equal(w.step(now.toReversed()).accepted, true);
  assert.equal(w.step(now).accepted, false); assert.equal(w.snapshot().tick, 10);
  const old = choose(w), saved = w.snapshot(); w.restore(saved);
  w.requests(); assert.equal(w.step(old).accepted, false); assert.deepEqual(w.snapshot(), saved);
});
test('food competition consumes only the available energy; ordering independent', () => {
  const config = { width: 5, height: 5, initialAgents: 2, initialFood: 0, supplyAmount: 0, foodDecay: 0, diffusion: 0, metabolism: 0 };
  const a = new Ecology(config); place(a, s => { s.agents.forEach(x => { x.x = 2.5; x.y = 2.5; }); s.food[12] = 1; });
  const b = new Ecology(config); b.restore(a.snapshot());
  const result = a.step(choose(a, 'eat')); b.step(choose(b, 'eat').toReversed());
  assert.equal(result.accepted, true); assert.equal(a.snapshot().metrics.eaten, 1);
  assert.deepEqual(a.snapshot(), b.snapshot()); a.assertValid();
  assert.equal(result.outcomes.length, 2); assert(result.outcomes.every(o => o.rejected));
});
test('movement is continuous, bounded and cannot cross obstacles', () => {
  const w = new Ecology({ width: 5, height: 5, initialAgents: 1, initialFood: 0, supplyAmount: 0, obstacles: [13] });
  place(w, s => { s.agents[0].x = 2.5; s.agents[0].y = 2.5; });
  assert(!w.requests()[0].candidates.some(c => c.id === 'east'));
  assert.equal(w.step(choose(w, 'east')).accepted, false);
  assert.equal(w.step(choose(w, 'north')).accepted, true);
  assert(Math.abs(w.snapshot().agents[0].y - 1.5) < 1e-8);
  assert(Math.abs(w.snapshot().metrics.distance - 1) < 1e-8); w.assertValid();
});
test('line of sight and local perception exclude hidden food, global identities and states', () => {
  const w = new Ecology({ width: 7, height: 7, initialAgents: 2, initialFood: 0, obstacles: [24] });
  place(w, s => { s.agents[0].x = 2.5; s.agents[0].y = 3.5; s.agents[1].x = 4.5; s.agents[1].y = 3.5; s.food[25] = 10; s.food[0] = 8; });
  const o = w.requests()[0].observation;
  assert(!o.local.some(c => c.food === 10 || c.food === 8)); assert.equal(o.neighbors.length, 0);
  assert(o.local.some(c => c.dx === 1 && c.dy === 0 && c.blocked));
  const text = JSON.stringify(o); for (const key of ['runId', 'agentId', 'parentId', 'phaseTicks', 'rng', 'snapshotId']) assert(!text.includes(key));
});
test('reproduction transfers energy once; child starts fresh and birth costs close ledger', () => {
  const w = new Ecology({ width: 5, height: 5, initialAgents: 1, initialEnergy: 40, initialFood: 0, supplyAmount: 0, birthCooldown: 10 });
  w.step(choose(w)); const before = w.snapshot(), ps = choose(w, 'reproduce');
  assert(w.step(ps).accepted); assert(!w.step(ps).accepted);
  const s = w.snapshot(), child = s.agents.find(a => a.parentId);
  assert.equal(s.metrics.births, 1); assert.equal(s.agents.length, 2); assert.equal(child.parentId, 'life-0');
  assert.equal(child.generation, 1); assert.equal(child.born, 11); assert.deepEqual(child.memory, []);
  assert.equal(s.ledger.reproduction - before.ledger.reproduction, 2); w.assertValid();
});
test('simultaneous reproduction at capacity rejects once without creating energy', () => {
  const w = new Ecology({ initialAgents: 2, maxAgents: 3, initialEnergy: 40, initialFood: 0, supplyAmount: 0, birthCooldown: 10 });
  w.step(choose(w)); const r = w.step(choose(w, 'reproduce'));
  assert(r.accepted); assert.equal(w.snapshot().metrics.births, 1);
  assert.equal(r.outcomes.filter(o => o.rejected).length, 1); assert.equal(w.snapshot().metrics.populationCapHits, 1); w.assertValid();
});
test('death returns only stored energy and does not act again; truncated differs from terminal', () => {
  const old = new Ecology({ initialAgents: 1, maxAge: 1, initialFood: 0, supplyAmount: 0, foodDecay: 0, diffusion: 0 });
  const r = old.step(choose(old)); assert(r.accepted); assert(r.outcomes[0].terminated); assert(!r.outcomes[0].truncated);
  assert.equal(r.outcomes[0].rewards.length, 1); assert.equal(old.snapshot().agents.length, 0); old.assertValid();
  assert.throws(() => old.requests(), /world_done/);
  const short = new Ecology({ initialAgents: 1, horizon: 3 }); const end = short.step(choose(short));
  assert(end.outcomes[0].truncated); assert(!end.outcomes[0].terminated); assert.equal(end.outcomes[0].rewards.length, 3);
});
test('interventions are accounted, invalidate requests and reject occupied obstacles atomically', () => {
  const w = new Ecology(); const ps = choose(w), before = w.snapshot(), a = before.agents[0];
  assert.throws(() => w.intervene({ kind: 'obstacle', x: a.x, y: a.y, blocked: true }), /occupied/);
  assert.deepEqual(w.snapshot(), before);
  w.intervene({ kind: 'nutrient', x: a.x, y: a.y, amount: 100 }); w.requests(); assert(!w.step(ps).accepted);
  assert.equal(w.snapshot().ledger.supplied - before.ledger.supplied, 100); w.assertValid();
});
test('seeded actions replay the exact shared world; no renderer clock is used', () => {
  const w = new Ecology({ seed: 47, horizon: 1000 }), start = w.snapshot(), rows = [];
  while (!w.done()) {
    const requests = w.requests(), r = w.step(requests.map(q => ruleProposal(q, 47))); assert(r.accepted);
    rows.push({ actions: r.proposals.map(p => p.action), snapshot: r.snapshot });
  }
  const replay = new Ecology(); replay.restore(start);
  for (const row of rows) {
    const ps = replay.requests().map((r, i) => ({ identity: r.identity, action: row.actions[i], provider: 'replay' }));
    assert(replay.step(ps).accepted); assert.deepEqual(replay.snapshot(), row.snapshot);
  }
  assert.equal(stateHash(w.snapshot()), stateHash(replay.snapshot()));
});
test('bad restore is atomic, snapshots and branch references are independent', () => {
  const a = new Ecology(), original = a.snapshot();
  for (const edit of [s => { s.food[0] = NaN; }, s => { s.agents[0].x = -1; }, s => { s.ledger.supplied++; }, s => { s.agents[0].traits.speed = 4; }, s => { s.lineage[0].id = 'wrong'; }]) {
    const bad = structuredClone(original); edit(bad); assert.throws(() => a.restore(bad)); assert.deepEqual(a.snapshot(), original);
  }
  const b = new Ecology(); b.restore(original); b.step(choose(b)); assert.deepEqual(a.snapshot(), original);
});
test('bounded long-run fields, population, memory and lineage; at least one multi-generation ecology', () => {
  const w = new Ecology({ seed: 3, horizon: 6000, maxAge: 1200, supplyAmount: 12, initialFood: 240, maxEvents: 64 });
  while (!w.done()) assert(w.step(w.requests().map(r => ruleProposal(r, 3))).accepted);
  const s = w.snapshot(); w.assertValid(); assert(s.events.length <= 64); assert(s.agents.length <= s.config.maxAgents);
  assert(s.lineage.some(l => l.generation >= 2), `max generation=${Math.max(...s.lineage.map(l => l.generation))}; births=${s.metrics.births}`);
});
test('random control uses same candidates and leaves environmental RNG untouched until execution', () => {
  const w = new Ecology(), before = w.snapshot(), requests = w.requests();
  const a = requests.map(r => randomProposal(r, 1)), b = requests.map(r => randomProposal(r, 1));
  assert.deepEqual(a, b); assert.deepEqual(w.snapshot(), before);
  for (let i = 0; i < a.length; i++) assert(requests[i].candidates.some(c => c.id === a[i].action));
});

test('frequent render snapshot reads do not change simulation RNG or outcomes', () => {
  const a=new Ecology({runId:'render-independent',seed:71,initialAgents:4,horizon:500});
  const b=new Ecology({runId:'render-independent',seed:71,initialAgents:4,horizon:500});
  for(let round=0;round<50;round++) {
    for(let frame=0;frame<60;frame++) a.snapshot();
    if(round%4===0)b.snapshot();
    const ar=a.requests(),br=b.requests();
    const pa=ar.map(r=>ruleProposal(r,71)),pb=br.map(r=>ruleProposal(r,71));
    assert.deepEqual(a.step(pa),b.step(pb));
  }
});

test('preview execution retains the committed world and produces exactly the later accepted result', () => {
  const w=new Ecology({runId:'preview',seed:23,initialAgents:4});
  const before=w.snapshot(),proposals=w.requests().map(r=>ruleProposal(r,23));
  const staged=w.previewStep(proposals);assert(staged.accepted);assert.deepEqual(w.snapshot(),before);
  assert.deepEqual(w.previewStep(proposals),staged);assert.deepEqual(w.step(proposals),staged);
  assert.notDeepEqual(w.snapshot(),before);
});
