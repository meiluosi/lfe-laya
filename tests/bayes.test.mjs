// G11c 贝叶斯环境推断学习器：基因界、缓存传感器矩阵的性质、关闭传感器时不依赖线索、预言机传感器下回到旧环境时切回旧表、确定性。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Ecology } from '../packages/sim/ecology.ts';
import { semanticWorldConfig } from '../packages/evo/semantic-run.ts';
import { registerPools, loadLayaPriors } from '../packages/evo/pools.ts';
import { structuredBenvCohort, decodeBenvGenes, BENV_GENES, CUE_STATE } from '../packages/evo/structured-benv.ts';

registerPools(); const priors = loadLayaPriors('test'), base = JSON.parse(readFileSync('experiments/evo/dev-aba-laya-plain-201/final.json', 'utf8')).innate, g = [...base, .7, .02, .3, .9, .5];
const sim = JSON.parse(readFileSync('packages/evo/cue-sim.json', 'utf8'));
const world = (cue, seed = 600001) => new Ecology(semanticWorldConfig({ seed, options: { split: 'test', pool: 'test', sensible: 6, harmCap: 1, inversion: 0, horizon: 3600, drift: { everyTicks: 1200, fraction: 1, pattern: 'aba', cue } } }));
const play = (w, c, onTick = () => {}) => { while (!w.done()) { const reqs = w.requests(), r = w.step(reqs.map(q => c(q, 1))); c.feedback(r.outcomes.map(o => ({ agentId: o.agentId, reward: o.reward, terminated: o.terminated, energyBefore: o.energyBefore, energyAfter: o.energyAfter, action: o.action })), new Map()); onTick(w, reqs); } return w.snapshot(); };
test('genes decode within bounds and the size is checked', () => {
  assert.equal(BENV_GENES, 14); assert.throws(() => decodeBenvGenes(base), /genome_size/);
  const d = decodeBenvGenes([...base, 99, 99, 99, 99, 99]); assert.deepEqual([d.sigma, d.hazard, d.newShare, d.rel, d.boundary], [1.5, .3, 1, .99, .95]);
  const e = decodeBenvGenes([...base, -9, -9, -9, -9, -9]); assert.deepEqual([e.sigma, e.hazard, e.newShare, e.rel, e.boundary], [.15, .001, .05, .5, .05]);
});
test('cached sensor matrix: symmetric, unit diagonal, same-state pairs read higher than different-state pairs (no leakage into agents: state labels are only exported for controls)', () => {
  const n = sim.sentences.length; assert.equal(n, 36); let same = [], diff = [];
  for (let i = 0; i < n; i++) { assert.equal(sim.p[i][i], 1); for (let j = i + 1; j < n; j++) { assert.equal(sim.p[i][j], sim.p[j][i]); (sim.state[i] === sim.state[j] ? same : diff).push(sim.p[i][j]); } }
  assert.ok(Math.min(...same) > Math.max(...diff)); assert.equal(CUE_STATE.length, n);
});
test('sensor off: behaviour does not depend on the cue at all (cue shown vs hidden gives identical worlds)', () => {
  const a = play(world('paraphrase'), structuredBenvCohort(g, 'laya', priors, { sensor: false })), b = play(world('off'), structuredBenvCohort(g, 'laya', priors, { sensor: false }));
  assert.equal(JSON.stringify(a.agents.map(x => x.energy)), JSON.stringify(b.agents.map(x => x.energy))); assert.equal(a.metrics.eaten, b.metrics.eaten);
});
test('oracle sensor in A/B/A: a second context opens in B and the posterior returns to the first context when A comes back; deterministic', () => {
  const oracle = (i, j) => CUE_STATE[i] === CUE_STATE[j] ? 1 : 0, mk = () => structuredBenvCohort([...base, .7, .02, .3, .95, .9], 'laya', priors, { sensor: true, sim: oracle });
  const run = () => { const c = mk(), w = world('paraphrase'), seen = { b: 0, a2: 0, n: 0 }; play(w, c, (ww, reqs) => { const t = ww.tick; for (const q of reqs) { const id = q.identity.agentId; if (t === 2300) { seen.n++; if (c.contexts(id) >= 2 && c.active(id) !== 0) seen.b++; } if (t === 3500) { if (c.active(id) === 0) seen.a2++; } } }); return { seen, c, w }; };
  const r = run(), r2 = run(); assert.deepEqual(r.seen, r2.seen); assert.ok(r.seen.n > 0 && r.seen.b >= Math.ceil(r.seen.n / 2), JSON.stringify(r.seen));
  assert.ok(r.seen.a2 >= 1, JSON.stringify(r.seen));
});
