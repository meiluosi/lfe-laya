import test from 'node:test';
import assert from 'node:assert/strict';
import { Ecology } from '../packages/sim/ecology.ts';
import { historyPoint } from '../src/lab/history.ts';

test('observer energy history keeps deaths in original cohort and excludes children from its denominator', () => {
  const world=new Ecology({initialAgents:2,initialEnergy:24});const snapshot=world.snapshot();
  // 展示统计的明确夹具：初始 life-1 已死亡，life-2 是后代；不是模型或生态收益证据。
  snapshot.agents=[{...snapshot.agents[0],energy:10},{...snapshot.agents[0],id:'life-2',parentId:'life-0',energy:20}];
  snapshot.lineage[1].died=10;
  snapshot.lineage.push({...snapshot.lineage[0],id:'life-2',parentId:'life-0',born:10,generation:1});
  const point=historyPoint(snapshot);
  assert.equal(point.living,2);assert.equal(point.meanEnergy,15);assert.equal(point.cohortEnergy,5);
  assert.equal(point.energyById['life-2'],20);assert.equal(point.energyById['life-1'],undefined);
  snapshot.agents.length=0;assert.equal(historyPoint(snapshot).cohortEnergy,0);
  assert.equal(point.energyById['life-0'],10);
});
