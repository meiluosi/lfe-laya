import { parentPort } from 'node:worker_threads';
import { loadPriors, runSemanticWorld, type SemanticSpec } from './semantic-run.ts';
import { semanticCohort, type SemCondition } from './sempolicy.ts';
import { structuredCohort } from './structured.ts';
import { structuredHierCohort } from './structured-hier.ts';
import { structuredSocialCohort } from './structured-social.ts';
import { structuredHeadCohort } from './structured-head.ts';
import { distilledPrior } from './distill.ts';
import { structuredSafetyCohort } from './structured-safety.ts';
import { structuredBayesCohort } from './structured-bayes.ts';
import { structuredDualCohort, structuredRegimeCohort } from './structured-ctx.ts';
import { structuredLagCohort } from './structured-lag.ts';
import { registerPools, loadEmbeddings, loadLayaPriors, shuffledPrior, vaderPrior, type Priors } from './pools.ts';

const priors = loadPriors();
registerPools();                                    // 词池世界（options.pool）需要池已注册
const poolPriors = new Map<string, Priors>();
/** 结构化个体的先验来源：随世界的方言（训练/测试）取对应的 Laya 缓存表；shuffled 是打乱的 Laya；vader 是独立词典。 */
function priorsFor(source: string, split: string): Priors {
  const key = `${source}:${split}`; let m = poolPriors.get(key);
  if (!m) { const laya = loadLayaPriors(split as 'train' | 'test'); m = source === 'laya' ? laya : source === 'shuffled' ? shuffledPrior(laya, 3) : source === 'vader' ? vaderPrior() : source === 'distilled' ? distilledPrior(split) : new Map(); poolPriors.set(key, m); }
  return m;
}
const embCache = new Map<string, Map<string, Float32Array>>();
const embFor = (split: string) => { let m = embCache.get(split); if (!m) { m = loadEmbeddings(split as 'train'); embCache.set(split, m); } return m; };
type Task = { id: number; theta: number[]; cond: SemCondition; specs: SemanticSpec[]; greedy?: boolean; agent?: 'mlp' | 'structured'; hier?: boolean; social?: boolean; head?: boolean; learner?: 'plain' | 'safety' | 'bayes' | 'lag' | 'dual' | 'regime' };
parentPort!.on('message', (t: Task) => {
  try {
    const rs = t.specs.map(s => runSemanticWorld(s, kinds => t.agent === 'structured' && t.learner === 'dual' ? structuredDualCohort(t.theta, t.cond.prior === 'none' ? 'none' : 'laya', priorsFor(t.cond.prior, s.options.pool!)) : t.agent === 'structured' && t.learner === 'regime' ? structuredRegimeCohort(t.theta, t.cond.prior === 'none' ? 'none' : 'laya', priorsFor(t.cond.prior, s.options.pool!)) : t.agent === 'structured' && t.learner === 'safety' ? structuredSafetyCohort(t.theta, t.cond.prior === 'none' ? 'none' : 'laya', priorsFor(t.cond.prior, s.options.pool!)) : t.agent === 'structured' && t.learner === 'lag' ? structuredLagCohort(t.theta, t.cond.prior === 'none' ? 'none' : 'laya', priorsFor(t.cond.prior, s.options.pool!)) : t.agent === 'structured' && t.learner === 'bayes' ? structuredBayesCohort(t.theta, t.cond.prior === 'none' ? 'none' : 'laya', priorsFor(t.cond.prior, s.options.pool!)) : t.agent === 'structured' && t.head ? structuredHeadCohort(t.theta, t.cond.prior === 'none' ? 'none' : 'laya', priorsFor(t.cond.prior, s.options.pool!), embFor(s.options.pool!)) : t.agent === 'structured' && t.social ? structuredSocialCohort(t.theta, t.cond.prior === 'none' ? 'none' : 'laya', priorsFor(t.cond.prior, s.options.pool!)) : t.agent === 'structured' && t.hier ? structuredHierCohort(t.theta, t.cond.prior === 'none' ? 'none' : 'laya', priorsFor(t.cond.prior, s.options.pool!), embFor(s.options.pool!)) : t.agent === 'structured' ? structuredCohort(t.theta, t.cond.prior === 'none' ? 'none' : 'laya', s.options.pool ? priorsFor(t.cond.prior, s.options.pool) : priors) : semanticCohort(t.theta, t.cond, t.cond.prior === 'oracle' ? new Map(kinds.map(k => [k.description, (k.factor + 1) / 2])) : priors, t.greedy))), mean = (k: keyof typeof rs[0]) => rs.reduce((a, r) => a + r[k], 0) / rs.length;
    parentPort!.postMessage({ id: t.id, result: { survival: mean('survival'), lowEnergy: mean('lowEnergy'), energyFraction: mean('energyFraction'), living: mean('living'), deaths: mean('deaths'), fitness: mean('fitness'), toxicBites: mean('toxicBites') } });
  } catch (error) { parentPort!.postMessage({ id: t.id, error: String(error) }); }
});
