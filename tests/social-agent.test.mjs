// W8b 社会学习个体：基因解码、读懂外观后更新对邻居所吃食物的信念（权重由基因决定）、无先验读不懂、同一证据不重复计数、信念只属于个体。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Ecology } from '../packages/sim/ecology.ts';
import { structuredSocialCohort, decodeSocialGenes, SOCIAL_GENES } from '../packages/evo/structured-social.ts';
import { lookText, LOOK_PHRASES } from '../packages/evo/semantic.ts';

const KINDS = [{ description: 'round pale tuber', factor: 1 }, { description: 'deadly black bulb', factor: -1 }];
const social = { cues: 'language', window: 300, lookTicks: 60, harmText: LOOK_PHRASES.A.harm, boostText: LOOK_PHRASES.A.boost, calmText: LOOK_PHRASES.A.calm };
const BASE = { width: 12, height: 10, initialAgents: 2, reproduction: false, mutation: false, maxAge: 100000, horizon: 2400, phaseTicks: 400, initialEnergy: 20, metabolism: .0001, initialFood: 0, supplyAmount: 0, foodDecay: 0, diffusion: 0, deathReturn: 0 };
const V2 = [Math.log(3), .3, -.3, .05, .02, 1, 0, .3, 0];
const priors = new Map([...LOOK_PHRASES.A.harm.map(x => [lookText(x), .05]), ...LOOK_PHRASES.A.boost.map(x => [lookText(x), .95]), ...LOOK_PHRASES.A.calm.map(x => [lookText(x), .5])]);
function worldAfterMeal(kind) {   // 观察者 b 看到邻居 a 刚吃过 kind 并出现外观
  const w = new Ecology({ ...BASE, seed: 5, runId: 'social-agent', semantic: { kinds: structuredClone(KINDS), social } });
  const s = w.snapshot(), [a, b] = s.agents; b.x = a.x + .6; b.y = a.y; const cell = Math.floor(a.y) * s.config.width + Math.floor(a.x); s.food[cell] = 6; s.kinds[cell] = kind;
  const { initial, supplied, ...losses } = s.ledger; s.ledger.initial = s.food.reduce((x, y) => x + y, 0) + s.agents.reduce((x, y) => x + y.energy, 0) + Object.values(losses).reduce((x, y) => x + y, 0) - supplied; w.restore(s);
  const rs = w.requests(); w.step(rs.map(q => ({ identity: q.identity, action: q.identity.agentId === a.id ? 'eat' : 'rest', provider: 'test-only' })));
  return { w, observer: b.id };
}
const observe = (w, id) => w.requests().find(q => q.identity.agentId === id);

test('social genes decode within bounds and the size is checked', () => {
  assert.equal(SOCIAL_GENES, 10); assert.throws(() => decodeSocialGenes(V2), /genome_size/);
  assert.equal(decodeSocialGenes([...V2, 100]).social, 3); assert.equal(decodeSocialGenes([...V2, -100]).social, 0);
});
test('seeing a neighbour who looks ill after eating X lowers the belief about X; seeing a well one raises it', () => {
  const bad = worldAfterMeal(1), c1 = structuredSocialCohort([...V2, 1], 'laya', priors); c1(observe(bad.w, bad.observer), 5);
  const e1 = c1.beliefs.get(bad.observer)?.get('deadly black bulb'); assert.ok(e1 && e1.sum < 0 && e1.n > 0, JSON.stringify([...c1.beliefs.get(bad.observer) ?? []]));
  const good = worldAfterMeal(0), c2 = structuredSocialCohort([...V2, 1], 'laya', priors); c2(observe(good.w, good.observer), 5);
  const e2 = c2.beliefs.get(good.observer)?.get('round pale tuber'); assert.ok(e2 && e2.sum > 0);
});
test('the social weight gene scales the evidence; weight 0, no prior, or an unreadable look gives no update', () => {
  const mk = (genes, prior, pri = priors) => { const x = worldAfterMeal(1), c = structuredSocialCohort(genes, prior, pri); c(observe(x.w, x.observer), 5); return c.beliefs.get(x.observer)?.get('deadly black bulb'); };
  const w1 = mk([...V2, 1], 'laya'), w2 = mk([...V2, 2], 'laya'); assert.ok(Math.abs(w2.n - 2 * w1.n) < 1e-9 && Math.abs(w2.sum - 2 * w1.sum) < 1e-9);
  assert.equal(mk([...V2, 0], 'laya'), undefined); assert.equal(mk([...V2, 1], 'none', new Map()), undefined); assert.equal(mk([...V2, 1], 'laya', new Map(LOOK_PHRASES.A.harm.map(x => [lookText(x), .5]))), undefined, '先验认为外观中性时不更新');
});
test('the same evidence is counted once within the dedupe window, and beliefs belong to the observer only', () => {
  const x = worldAfterMeal(1), c = structuredSocialCohort([...V2, 1], 'laya', priors), q = observe(x.w, x.observer);
  c(q, 5); const once = JSON.stringify([...c.beliefs.get(x.observer)]); c(q, 5); assert.equal(JSON.stringify([...c.beliefs.get(x.observer)]), once, '重复观察同一证据不重复计数');
  assert.deepEqual([...c.beliefs.keys()], [x.observer]);
});
