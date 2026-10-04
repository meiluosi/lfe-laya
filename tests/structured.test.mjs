// 结构化个体：基因解码与截断、信念只属于个体、否决/重试/遗忘按设计工作、合法且可复现、不接触隐藏真值。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Ecology } from '../packages/sim/ecology.ts';
import { validateProposal } from '../packages/protocol/ecology.ts';
import { structuredCohort, decodeGenes, updateBelief, STRUCTURED_GENES } from '../packages/evo/structured.ts';
import { runSemanticWorld, semanticWorldConfig, loadPriors } from '../packages/evo/semantic-run.ts';

const priors = loadPriors(), GOOD = 'ripe and sweet berry';
const worldWithFoodHere = (desc, energy = 20) => {
  const w = new Ecology({ ...semanticWorldConfig({ seed: 5, options: { split: 'test' } }), initialAgents: 1, initialFood: 0 });
  const s = w.snapshot(), a = s.agents[0], cell = Math.floor(a.y) * s.config.width + Math.floor(a.x), k = s.config.semantic.kinds.findIndex(x => x.description === desc);
  return { w, cell, k, s, a };
};

test('genes decode within bounds and the size is checked', () => {
  const d = decodeGenes([100, 100, 100, 100, 100]); assert.ok(d.trust <= Math.exp(4) + 1e-9 && d.curiosity === 1.5 && d.tau === 1 && d.forget === .5 && d.retry === .2);
  const e = decodeGenes([-100, -100, -100, -100, -100]); assert.ok(e.trust >= Math.exp(-2) - 1e-9 && e.curiosity === 0 && e.tau === -1 && e.forget === 0 && e.retry === 0);
  assert.throws(() => decodeGenes([1, 2]), /genome_size/); assert.equal(STRUCTURED_GENES, 5);
});
test('proposals are legal and reproducible; beliefs belong to the individual; hidden truth never reaches the agent', () => {
  const genes = [Math.log(3), .3, -.3, .05, .02], cohort = structuredCohort(genes, 'laya', priors), w = new Ecology(semanticWorldConfig({ seed: 21, options: { split: 'test', inversion: .25 } }));
  for (let i = 0; i < 100 && !w.done(); i++) {
    const rs = w.requests(); assert.ok(!/factor/.test(JSON.stringify(rs)));
    const ps = rs.map(r => cohort(r, 21)); ps.forEach((p, k) => assert.equal(validateProposal(rs[k], p), null));
    const res = w.step(ps); cohort.feedback(res.outcomes.map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action })), new Map());
  }
  assert.ok(cohort.beliefs.size >= 2); const maps = [...cohort.beliefs.values()]; assert.equal(new Set(maps).size, maps.length);
  const run = () => runSemanticWorld({ seed: 31, options: { split: 'test' } }, () => structuredCohort(genes, 'laya', priors)); assert.deepEqual(run(), run());
});
test('one bad experience vetoes a food the prior liked; retry sometimes lets it through', () => {
  const BAD = 'rotten and foul-smelling berry';
  const cfg = { ...semanticWorldConfig({ seed: 5, options: { split: 'test' } }), initialAgents: 1, initialFood: 0, semantic: { kinds: [{ description: GOOD, factor: 1 }, { description: BAD, factor: -1 }] } };
  const setup = genes => {
    const w = new Ecology(cfg), s = w.snapshot(), a = s.agents[0], cell = Math.floor(a.y) * s.config.width + Math.floor(a.x);
    s.food[cell] = 5; s.kinds[cell] = 0; s.ledger.initial += 5; w.restore(s);
    const q = w.requests()[0], c = structuredCohort(genes, 'laya', priors), metabolism = q.observation.costs.metabolismPerTick * q.observation.costs.decisionTicks;
    const at = tick => ({ ...q, identity: { ...q.identity, tick } });
    const bite = (x, tick) => { assert.equal(c(at(tick), 5).action, 'eat', '要先真的吃了才有经验'); c.feedback([{ agentId: q.identity.agentId, reward: 0, terminated: false, action: 'eat', energyBefore: 20, energyAfter: 20 + 3 * x - metabolism }], new Map()); };
    const eatsOver = ticks => { let n = 0; for (let t = 100; t < 100 + ticks; t++) if (c(at(t), 5).action === 'eat') n++; return n; };
    return { c, at, bite, eatsOver };
  };
  const plain = setup([Math.log(1), 0, .1, 0, 0]);
  assert.equal(plain.c(plain.at(0), 5).action, 'eat', '先验喜欢（v0≈0.39 ≥ τ=0.1），所以会吃');
  plain.bite(-1, 1);                                              // 吃了一口，结果很糟
  assert.equal(plain.eatsOver(200), 0, '被自己的糟糕经验否决，retry=0 时永不再吃');
  const retry = setup([Math.log(1), 0, .1, 0, .2]); retry.bite(-1, 1);
  const n = retry.eatsOver(300); assert.ok(n > 20 && n < 120, `retry=0.2 时约 20% 的决策放行，实际 ${n}/300`);
});
test('updateBelief: forgetting lets recent good experience win back against old bad experience', () => {
  const run = forget => { let e; for (let i = 0; i < 4; i++) e = updateBelief(e, -1, forget); for (let i = 0; i < 3; i++) e = updateBelief(e, 1, forget); return e.sum / e.n; };
  assert.ok(run(0) < 0, '不遗忘：旧经验仍占上风'); assert.ok(run(.5) > 0.3, '遗忘 0.5：近期好经验翻案');
  assert.deepEqual(updateBelief(undefined, .5, 0), { n: 1, sum: .5 });
});
test('prior none vs laya differ on a food Laya judges clearly good or bad', () => {
  const none = structuredCohort([Math.log(3), 0, .1, 0, 0], 'none', priors), laya = structuredCohort([Math.log(3), 0, .1, 0, 0], 'laya', priors);
  const w = new Ecology(semanticWorldConfig({ seed: 8, options: { split: 'test' } })); let differ = 0;
  for (let i = 0; i < 60 && !w.done(); i++) { const rs = w.requests(); for (const r of rs) if (none(r, 8).action !== laya(r, 8).action) differ++; w.step(rs.map(r => laya(r, 8))); }
  assert.ok(differ > 0, '两种先验设置应产生不同的行为');
});
