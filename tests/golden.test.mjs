// 行为冻结的回归基线：重构、性能优化不得改变这些固定种子的世界终态。
// 若有意改变模拟行为，必须更新 ECOLOGY_VERSION 与 docs/OPTIMIZATION.md，并在此重新生成，不得静默修改。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Ecology, stateHash, ECOLOGY_VERSION } from '../packages/sim/ecology.ts';
import { ruleProposal, randomProposal } from '../packages/sim/controllers.ts';

const run = (seed, mode, rounds) => {
  const w = new Ecology({ seed, runId: `golden-${mode}-${seed}` });
  for (let i = 0; i < rounds && !w.done(); i++) {
    const proposals = w.requests().map(r => (mode === 'rule' ? ruleProposal : randomProposal)(r, seed));
    assert.equal(w.step(proposals).accepted, true);
  }
  return { hash: stateHash(w.snapshot()), tick: w.snapshot().tick, living: w.snapshot().agents.length };
};
const GOLDEN = JSON.parse(process.env.GOLDEN_PRINT ? '{}' : '{"ecology-v1:rule:7":{"hash":"d56ddcf1a5a3d8d1","tick":3000,"living":14},"ecology-v1:random:7":{"hash":"60cb9e5b3e267cd7","tick":1800,"living":0},"ecology-v1:rule:313":{"hash":"b3e6e101d97e9fcd","tick":3000,"living":13},"ecology-v1:random:331":{"hash":"bf5892bb1c3b2847","tick":1800,"living":0}}');
test('golden worlds are unchanged', () => {
  const actual = {};
  for (const [seed, mode] of [[7, 'rule'], [7, 'random'], [313, 'rule'], [331, 'random']]) actual[`${ECOLOGY_VERSION}:${mode}:${seed}`] = run(seed, mode, 300);
  if (process.env.GOLDEN_PRINT) console.log(JSON.stringify(actual));
  else assert.deepEqual(actual, GOLDEN);
});
