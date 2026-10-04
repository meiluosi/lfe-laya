import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Ecology, stateHash } from '../../packages/sim/ecology.ts';
import { ruleProposal, randomProposal } from '../../packages/sim/controllers.ts';

const output = process.argv[2];
if (!output) throw Error('Usage: node experiments/ecology/difficulty.mjs <new-output-directory>');
mkdirSync(output, { recursive: false });
const input = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], 'utf8')) : null;
const base = input?.base ?? { width: 16, height: 12, initialAgents: 8, reproduction: false, mutation: false, maxAge: 100000, horizon: 2400, phaseTicks: 800, initialEnergy: 20 };
const scenarios = input?.scenarios ?? [
  { name: 'abundant-reference', initialFood: 160, supplyAmount: 8, foodDecay: .001, diffusion: .015 },
  { name: 'scarce-diffuse', initialFood: 80, supplyAmount: 4, foodDecay: .004, diffusion: .015 },
  { name: 'scarce-patches', initialFood: 80, supplyAmount: 4, foodDecay: .004, diffusion: .002 },
];
const seeds = input?.seeds ?? [211, 223, 227, 229, 233];
const manifest = { status: 'development-only', base, scenarios, seeds, modes: ['rule', 'random'], metrics: 'All initial agents; death retained. Low energy <25% capacity. A/B/A truth only in evaluator.', source: {} };
for (const path of ['packages/sim/ecology.ts', 'packages/sim/controllers.ts', 'packages/protocol/ecology.ts', 'experiments/ecology/difficulty.mjs']) manifest.source[path] = createHash('sha256').update(readFileSync(path)).digest('hex');
mkdirSync(`${output}/source`);
for (const path of Object.keys(manifest.source)) writeFileSync(`${output}/source/${path.replaceAll('/', '__')}`, readFileSync(path));
writeFileSync(`${output}/manifest.json`, JSON.stringify(manifest, null, 2));
const results = [];
for (const scenario of scenarios) for (const seed of seeds) for (const mode of ['rule', 'random']) {
  const { name, ...settings } = scenario, config = { ...base, ...settings, seed, runId: `difficulty-${name}-${seed}-${mode}` };
  const world = new Ecology(config), initial = world.snapshot(), start = performance.now(), windows = [];
  let stepMilliseconds = 0;
  while (!world.done()) {
    const at = performance.now(), requests = world.requests();
    const result = world.step(requests.map(r => (mode === 'rule' ? ruleProposal : randomProposal)(r, seed)));
    if (!result.accepted) throw Error(result.reason);
    stepMilliseconds += performance.now() - at;
    const s = result.snapshot;
    if (s.tick % 100 === 0 || world.done()) windows.push({ tick: s.tick, living: s.agents.length, meanEnergy: s.agents.reduce((n, a) => n + a.energy, 0) / base.initialAgents,
      food: s.food.reduce((a, b) => a + b, 0), metrics: s.metrics, ledger: s.ledger });
  }
  const s = world.snapshot();
  const row = { scenario: name, mode, seed, config, initialHash: stateHash(initial), finalHash: stateHash(s), tick: s.tick,
    living: s.agents.length, deaths: s.metrics.deaths, metrics: s.metrics, ledger: s.ledger,
    lowEnergyFraction: s.metrics.lowEnergyTicks / s.metrics.agentTicks,
    survivalFraction: s.metrics.agentTicks / (base.initialAgents * base.horizon),
    finalFood: s.food.reduce((a, b) => a + b, 0), meanInitialCohortEnergy: s.agents.reduce((n, a) => n + a.energy, 0) / base.initialAgents,
    windows, lineage: s.lineage, elapsedMilliseconds: performance.now() - start, stepMilliseconds };
  results.push(row); appendFileSync(`${output}/runs.jsonl`, JSON.stringify(row) + '\n');
  console.log(JSON.stringify({ scenario: name, mode, seed, living: row.living, low: +row.lowEnergyFraction.toFixed(3), food: +row.finalFood.toFixed(1), ms: Math.round(row.elapsedMilliseconds) }));
}
const summary = scenarios.flatMap(({ name }) => ['rule', 'random'].map(mode => {
  const rows = results.filter(r => r.scenario === name && r.mode === mode), mean = key => rows.reduce((n, r) => n + r[key], 0) / rows.length;
  return { scenario: name, mode, seeds: rows.length, meanLiving: mean('living'), meanSurvival: mean('survivalFraction'), meanLowEnergy: mean('lowEnergyFraction'), meanFood: mean('finalFood'), meanEnergy: mean('meanInitialCohortEnergy') };
}));
writeFileSync(`${output}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ complete: true, summary }));
