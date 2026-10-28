// G13 benv3：基因界、固定可靠度、在线可靠度在可靠 / 误导线索下分化、第二通道、传感器关闭时不依赖线索。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Ecology } from '../packages/sim/ecology.ts';
import { semanticWorldConfig } from '../packages/evo/semantic-run.ts';
import { registerPools, loadLayaPriors } from '../packages/evo/pools.ts';
import { structuredBenv3Cohort, decodeBenv3Genes, BENV3_GENES } from '../packages/evo/structured-benv3.ts';
import { cueOptions, drawRegimes, REGIMES } from '../packages/evo/cue-regimes.ts';

registerPools(); const priors = loadLayaPriors('test'), base = JSON.parse(readFileSync('experiments/evo/dev-aba-laya-plain-201/final.json', 'utf8')).innate, g = [...base, .7, .02, .3, .5, .8, 8];
const world = (r1, r2, horizon = 3000, seed = 660001) => new Ecology(semanticWorldConfig({ seed, options: { split: 'test', pool: 'test', sensible: 6, harmCap: 1, inversion: 0, horizon, drift: { everyTicks: 300, fraction: 1, pattern: 'alt', cue: 'paraphrase', ...cueOptions(r1, r2) } } }));
const play = (w, c) => { let first = null; while (!w.done()) { const reqs = w.requests(), r = w.step(reqs.map(q => c(q, 1))); c.feedback(r.outcomes.map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action })), new Map()); first ??= reqs[0]?.identity.agentId; } return { snap: w.snapshot(), id: first }; };
test('genes decode within bounds and the size is checked; regimes are drawn deterministically over the four regimes', () => {
  assert.equal(BENV3_GENES, 15); assert.throws(() => decodeBenv3Genes(base), /genome_size/);
  const d = decodeBenv3Genes([...base, 99, 99, 99, 99, 99, 99]), e = decodeBenv3Genes([...base, -9, -9, -9, -9, -9, -9]);
  assert.deepEqual([d.sigma, d.hazard, d.newShare, d.boundary, d.rel0, d.strength], [1.5, .3, 1, .95, .99, 40]); assert.deepEqual([e.sigma, e.hazard, e.newShare, e.boundary, e.rel0, e.strength], [.15, .001, .05, .05, .5, 1]);
  const seen = new Set(); for (let s = 0; s < 200; s++) { assert.deepEqual(drawRegimes(s), drawRegimes(s)); const [a, b] = drawRegimes(s); seen.add(a + '/' + b); } assert.equal(seen.size, 16); assert.equal(REGIMES.length, 4);
});
test('sensor off: behaviour does not depend on the cue (cue shown vs absent gives identical worlds)', () => {
  const a = play(world('reliable', 'reliable'), structuredBenv3Cohort(g, 'laya', priors, { sensor: false, channels: 2 })), b = play(world('absent', 'absent'), structuredBenv3Cohort(g, 'laya', priors, { sensor: false, channels: 2 }));
  assert.equal(JSON.stringify(a.snap.agents.map(x => x.energy)), JSON.stringify(b.snap.agents.map(x => x.energy)));
});
test('fixed reliability stays at rel0; online reliability ends higher with a reliable cue than with a misleading one; deterministic', () => {
  const run = (r, online) => { const c = structuredBenv3Cohort(g, 'laya', priors, { channels: 1, online }), { id } = play(world(r, 'absent', 4500), c); return c.reliability(id, 0); };
  assert.ok(Math.abs(run('reliable', false) - .8) < 1e-9 && Math.abs(run('noisy', false) - .8) < 1e-9);
  const rel = run('reliable', true), noisy = run('noisy', true), rel2 = run('reliable', true); assert.equal(rel, rel2); assert.ok(rel > noisy + .05, `${rel} vs ${noisy}`); assert.ok(rel > .82, String(rel));
});
test('a single-channel species ignores channel 2; with both channels the second can carry the information when the first is absent', () => {
  const only1 = play(world('absent', 'reliable'), structuredBenv3Cohort(g, 'laya', priors, { channels: 1 })), off = play(world('absent', 'reliable'), structuredBenv3Cohort(g, 'laya', priors, { sensor: false }));
  assert.equal(JSON.stringify(only1.snap.agents.map(x => x.energy)), JSON.stringify(off.snap.agents.map(x => x.energy)));
  const c2 = structuredBenv3Cohort(g, 'laya', priors, { channels: 2 }), { id } = play(world('absent', 'reliable'), c2); assert.ok(c2.contexts(id) >= 2);
});
