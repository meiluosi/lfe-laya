// G8 评估框架：谱系继承类型、中性对照与纯种群逐位一致（个体的行为不依赖标签）、确定性、繁殖本能。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runEcology } from '../packages/evo/ecology-run.ts';
import { registerPools, loadLayaPriors } from '../packages/evo/pools.ts';

registerPools(); const priors = loadLayaPriors('train'), genes = JSON.parse(readFileSync('experiments/evo/dev-aba-laya-plain-201/final.json', 'utf8')).innate, regimeGenes = JSON.parse(readFileSync('experiments/evo/dev-aba-laya-regime-201/final.json', 'utf8')).innate;
const base = { seed: 800001, pool: 'train', split: 'train', priors, pattern: 'aba', cue: 'off', supply: 20, threshold: 26, init: 8 };
const P = { label: 'P', learner: 'plain', genes }, R = { label: 'R', learner: 'regime', genes: regimeGenes };
test('deterministic and births happen (reproduction instinct)', () => {
  const a = runEcology({ ...base, types: [P] }), b = runEcology({ ...base, types: [P] });
  assert.equal(a.hash, b.hash); assert.ok(a.births > 0, 'reproduction instinct should produce births'); assert.deepEqual(a.phaseMean, b.phaseMean);
});
test('neutral control equals the pure population (behaviour does not depend on the label)', () => {
  const pure = runEcology({ ...base, types: [P] }), neutral = runEcology({ ...base, types: [{ ...P, label: 'X' }, { ...P, label: 'Y' }] });
  assert.equal(neutral.hash, pure.hash); assert.equal(neutral.births, pure.births);
  assert.equal(neutral.finalByType.X + neutral.finalByType.Y, pure.finalLiving);
});
test('children inherit the parent type: a mixed population only ever contains the starting types, and per-type births add up', () => {
  const r = runEcology({ ...base, types: [P, R] });
  assert.deepEqual(Object.keys(r.finalByType).sort(), ['P', 'R']); assert.equal(r.bornByType.P + r.bornByType.R, r.births);
  assert.equal(r.finalByType.P + r.finalByType.R, r.finalLiving);
});
test('types are actually used: plain and regime populations behave differently in the same world', () => {
  const pr = runEcology({ ...base, types: [R] }), pp = runEcology({ ...base, types: [P] });
  assert.notEqual(pr.hash, pp.hash); assert.equal(pr.phaseMean.length, 3); assert.ok(Number.isFinite(pr.recovery) && Number.isFinite(pp.recovery));
});

test('G8b probe: zero-noise mutation path equals the shared-cohort path (per-individual controllers behave the same)', () => {
  for (const T of [P, R]) { const shared = runEcology({ ...base, types: [T] }), own = runEcology({ ...base, types: [T], mutation: { sigma: 0 } }); assert.equal(own.hash, shared.hash); assert.equal(own.births, shared.births); }
});
test('G8b probe: children get the parent genome plus noise, deterministically; founders keep the type genome; beliefs still start fresh', () => {
  const spec = { ...base, types: [P], mutation: { sigma: 0.3 } }, a = runEcology(spec), b = runEcology(spec);
  assert.equal(a.hash, b.hash); assert.deepEqual(a.genomes, b.genomes);
  const byId = new Map(a.genomes.map(g => [g.id, g])), founders = a.genomes.filter(g => !g.parentId), kids = a.genomes.filter(g => g.parentId);
  assert.ok(kids.length > 0 && founders.every(g => g.generation === 0 && g.genes.every((x, i) => x === genes[i])));
  assert.ok(kids.every(k => k.generation === byId.get(k.parentId).generation + 1 && k.genes.some((x, i) => x !== byId.get(k.parentId).genes[i])));
  const c = runEcology({ ...spec, mutation: { sigma: 0.3 }, seed: base.seed + 1 }); assert.notEqual(c.hash, a.hash);
});
