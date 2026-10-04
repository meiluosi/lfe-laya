import { parentPort } from 'node:worker_threads';
import { loadPriors, runSemanticWorld, type SemanticSpec } from './semantic-run.ts';
import { semanticCohort, type SemCondition } from './sempolicy.ts';

const priors = loadPriors();
type Task = { id: number; theta: number[]; cond: SemCondition; specs: SemanticSpec[]; greedy?: boolean };
parentPort!.on('message', (t: Task) => {
  try {
    const rs = t.specs.map(s => runSemanticWorld(s, kinds => semanticCohort(t.theta, t.cond, t.cond.prior === 'oracle' ? new Map(kinds.map(k => [k.description, (k.factor + 1) / 2])) : priors, t.greedy))), mean = (k: keyof typeof rs[0]) => rs.reduce((a, r) => a + r[k], 0) / rs.length;
    parentPort!.postMessage({ id: t.id, result: { survival: mean('survival'), lowEnergy: mean('lowEnergy'), energyFraction: mean('energyFraction'), living: mean('living'), deaths: mean('deaths'), fitness: mean('fitness'), toxicBites: mean('toxicBites') } });
  } catch (error) { parentPort!.postMessage({ id: t.id, error: String(error) }); }
});
