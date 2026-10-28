// S2 学习器（dual / regime）：基因解码有界；退化设置与 v2 逐动作一致；A/B/A 世界里 regime 个体回到旧环境时能切回旧信念表。
import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Ecology } from '../packages/sim/ecology.ts';
import { structuredCohort } from '../packages/evo/structured.ts';
import { structuredDualCohort, structuredRegimeCohort, structuredLatentCohort, decodeDualGenes, decodeRegimeGenes, decodeLatentGenes, DUAL_GENES, REGIME_GENES, LATENT_GENES } from '../packages/evo/structured-ctx.ts';
import { semanticWorldConfig, loadPriors } from '../packages/evo/semantic-run.ts';
import { registerPools } from '../packages/evo/pools.ts';

registerPools(); const priors = loadPriors(), V2 = [Math.log(3), .3, -.3, .05, .02, 1, 0, .3, 0];
test('genes decode within bounds', () => {
  assert.equal(DUAL_GENES, 13); assert.equal(REGIME_GENES, 12); assert.throws(() => decodeDualGenes(V2), /genome_size/); assert.throws(() => decodeRegimeGenes(V2), /genome_size/);
  const d = decodeDualGenes([...V2, 9, 9, 9, 99]); assert.deepEqual([d.fast, d.slow, d.rate, d.sharp], [.6, .05, .5, 12]);
  const r = decodeRegimeGenes([...V2, -9, -9, 9]); assert.deepEqual([r.theta, r.rate, r.margin], [.15, .05, .3]);
});
const same = (make) => {
  const cfg = () => semanticWorldConfig({ seed: 41, options: { split: 'test', pool: 'test', sensible: 6, harmCap: 1, inversion: 0 } }), a = structuredCohort(V2, 'laya', priors), b = make(), w1 = new Ecology(cfg()), w2 = new Ecology(cfg());
  const fb = (c, res) => c.feedback(res.outcomes.map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action })), new Map());
  for (let i = 0; i < 120 && !w1.done(); i++) { const p1 = w1.requests().map(r => a(r, 41)), p2 = w2.requests().map(r => b(r, 41)); assert.deepEqual(p1.map(p => p.action), p2.map(p => p.action)); fb(a, w1.step(p1)); fb(b, w2.step(p2)); }
};
test('regime with theta above any error never spawns and equals v2', () => { same(() => structuredRegimeCohort([...V2.slice(0, 3), .05, ...V2.slice(4), 1.2, .05, 0], 'laya', priors)); });
test('regime spawns a second table in a flipped world and returns to the first on return', () => {
  const cfg = semanticWorldConfig({ seed: 52, options: { split: 'test', pool: 'test', sensible: 6, harmCap: 1, inversion: 0, drift: { everyTicks: 1200, fraction: .5 } } }), w = new Ecology(cfg), c = structuredRegimeCohort([...V2, .5, .25, .03], 'none', new Map());
  const trace = new Map();
  while (!w.done()) { const t = w.snapshot().tick, res = w.step(w.requests().map(r => c(r, 52))); c.feedback(res.outcomes.map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action })), new Map()); for (const a of w.snapshot().agents) trace.set(a.id, Math.max(trace.get(a.id) ?? 1, c.regimes(a.id))); }
  assert.ok([...trace.values()].some(n => n >= 2), 'some individual opened a second regime');
});
test('dual runs deterministically', () => {
  const run = () => { const w = new Ecology(semanticWorldConfig({ seed: 61, options: { split: 'test', pool: 'test', sensible: 6, harmCap: 1, inversion: 0 } })), c = structuredDualCohort([...V2, .2, .005, .2, 4], 'laya', priors), acts = []; for (let i = 0; i < 80 && !w.done(); i++) { const res = w.step(w.requests().map(r => c(r, 61))); acts.push(res.outcomes.map(o => o.action).join()); c.feedback(res.outcomes.map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action })), new Map()); } return acts.join('|'); };
  assert.equal(run(), run());
});

import { structuredCueCohort } from '../packages/evo/structured-ctx.ts';
test('cue learner equals v2 when no cue is shown', () => { same(() => structuredCueCohort(V2, 'laya', priors)); });
const cuesByPhase = (pattern, cue, every) => {
  const w = new Ecology(semanticWorldConfig({ seed: 71, options: { split: 'test', pool: 'test', sensible: 6, harmCap: 1, inversion: 0, drift: { everyTicks: every, fraction: 1, pattern, ...(cue ? { cue } : {}) } } })), ctl = structuredCueCohort(V2, 'none', new Map()), byPhase = new Map();
  for (let i = 0; i < 80 && !w.done(); i++) { const t = w.snapshot().tick, ph = Math.floor(t / every); byPhase.set(ph, new Set([...(byPhase.get(ph) ?? []), w.requests()[0].observation.season])); w.step(w.requests().map(q => ctl(q, 71))); }
  return byPhase;
};
test('drift schedule A/B/C has three states with different flips', () => {
  const d = semanticWorldConfig({ seed: 71, options: { split: 'test', pool: 'test', sensible: 6, harmCap: 1, inversion: 0, drift: { everyTicks: 300, fraction: 1, pattern: 'abc', cue: 'true' } } }).semantic.drift;
  assert.deepEqual(d.schedule, [0, 1, 2]); assert.equal(d.states[0].length, 0); assert.equal(d.states[1].length, 6); assert.equal(d.states[2].length, 3);
});
test('true cue: one sentence per phase, and A/B/A repeats the A sentence on return; cue off shows nothing', () => {
  const m = cuesByPhase('aba', 'true', 100); assert.ok([...m.values()].every(v => v.size === 1));
  const c = ph => [...m.get(ph)][0]; assert.notEqual(c(0), c(1)); assert.equal(c(0), c(2)); assert.equal(c(0), c(5));
  assert.ok([...cuesByPhase('aba', 'off', 100).values()].every(v => v.size === 1 && v.has(undefined)));
  const abc = cuesByPhase('abc', 'true', 100); assert.equal(new Set([0, 1, 2].map(ph => [...abc.get(ph)][0])).size, 3);
});

import { makeDrift, makeKinds } from '../packages/evo/semantic.ts';
test('retention patterns: half flips a strict subset, abab alternates, long holds B for three phases, horizon applies', () => {
  const opt = { split: 'test', pool: 'test', sensible: 6, harmCap: 1, inversion: 0 }, kinds = makeKinds(91, opt), mk = pattern => makeDrift(91, kinds, { everyTicks: 1200, fraction: 1, pattern });
  const half = mk('half'); assert.deepEqual(half.schedule, [0, 1, 0]); assert.equal(half.states[1].length, 3); assert.ok(half.states[1].length < kinds.length);
  assert.deepEqual(mk('abab').schedule, [0, 1, 0, 1, 0]); assert.deepEqual(mk('long').schedule, [0, 1, 1, 1, 0]); assert.equal(mk('abab').states[1].length, kinds.length);
  assert.equal(semanticWorldConfig({ seed: 91, options: { ...opt, horizon: 6000, drift: { everyTicks: 1200, fraction: 1, pattern: 'abab' } } }).horizon, 6000);
  assert.equal(semanticWorldConfig({ seed: 91, options: opt }).horizon, 3600);
});

test('latent (sticky-CRP comparator): genes bounded; an impossible new table (alpha at minimum, kappa max, noise max) never spawns; a flipped world spawns more than one table', () => {
  assert.equal(LATENT_GENES, 13); assert.throws(() => decodeLatentGenes(V2), /genome_size/);
  const g = decodeLatentGenes([...V2, 99, 99, 99, 99]); assert.deepEqual([g.alpha, g.kappa, g.noise, g.decay], [3, 20, 1, .99]);
  const run = (genes) => {
    const cfg = semanticWorldConfig({ seed: 52, options: { split: 'test', pool: 'test', sensible: 6, harmCap: 1, inversion: 0, horizon: 3600, drift: { everyTicks: 1200, fraction: 1, pattern: 'aba', cue: 'off' } } }), w = new Ecology(cfg), c = structuredLatentCohort(genes, 'laya', priors); let maxTables = 1, trace = '';
    while (!w.done()) { const reqs = w.requests(), res = w.step(reqs.map(r => c(r, 52))); c.feedback(res.outcomes.map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action })), new Map()); for (const r of reqs) maxTables = Math.max(maxTables, c.regimes(r.identity.agentId)); }
    return { maxTables, hash: w.snapshot().tick + ':' + w.snapshot().agents.map(a => a.energy.toFixed(3)).join(',') };
  };
  assert.equal(run([...V2, .05, 20, 1, .5]).maxTables, 1);
  const a = run([...V2, .5, 4, .2, .9]), b = run([...V2, .5, 4, .2, .9]); assert.ok(a.maxTables > 1); assert.deepEqual(a, b);
});

test('flipHarm (default off): identical before the first reversal, harsher after; undefined/absent equals the old behaviour', async () => {
  const { ruleProposal } = await import('../packages/sim/controllers.ts');
  const mk = (flipHarm) => new Ecology(semanticWorldConfig({ seed: 61, options: { split: 'test', pool: 'test', sensible: 6, harmCap: 1, inversion: 0, horizon: 2000, drift: { everyTicks: 1000, fraction: 1, pattern: 'aba', cue: 'off', ...(flipHarm ? { flipHarm } : {}) } } }));
  const run = (w, until) => { while (w.snapshot().tick < until && !w.done()) { const r = w.step(w.requests().map(q => ruleProposal(q, 61))); assert.ok(r.accepted); } const sn = w.snapshot(); return JSON.stringify([sn.agents.map(a => a.energy.toFixed(4)), sn.metrics.deaths, sn.metrics.eaten.toFixed(4), sn.ledger.semanticLoss.toFixed(4)]); };
  const off = mk(0), absent = mk(undefined), harsh = mk(4);
  assert.equal(run(off, 990), run(absent, 990)); assert.equal(run(harsh, 990), run(mk(0), 990));
  const a = run(mk(0), 1900), b = run(harsh, 1900); assert.notEqual(a, b);
});

test('paraphrase cue: the same state is worded differently each time it returns, always from that state\'s own set, deterministically; true cue repeats the same sentence', () => {
  const mk = cue => new Ecology(semanticWorldConfig({ seed: 71, options: { split: 'test', pool: 'test', sensible: 6, harmCap: 1, inversion: 0, horizon: 6000, drift: { everyTicks: 1200, fraction: 1, pattern: 'abab', cue } } }));
  const seen = (w) => { const out = []; for (let p = 0; p < 5; p++) { while (w.tick < p * 1200 + 5) w.step(w.requests().map(q => ({ identity: q.identity, action: 'rest', provider: 't', distribution: { rest: 1 } }))); out.push(w.requests()[0]?.observation.season); } return out; };
  const para = seen(mk('paraphrase')), again = seen(mk('paraphrase')), tru = seen(mk('true'));
  assert.deepEqual(para, again); assert.equal(tru[0], tru[2]); assert.equal(tru[2], tru[4]); assert.equal(tru[1], tru[3]);
  assert.notEqual(para[0], para[2]); assert.notEqual(para[2], para[4]); assert.notEqual(para[0], para[4]); assert.notEqual(para[1], para[3]);
  const cues = JSON.parse(readFileSync('packages/evo/cues.json', 'utf8')), setOf = k => new Set([...cues[k].train, ...cues[k].eval]);
  assert.ok(setOf('A').has(para[0]) && setOf('A').has(para[2]) && setOf('B').has(para[1]) && setOf('B').has(para[3]));
});
