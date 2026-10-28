import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, Replay } from '../packages/sim/session.ts';
import { ruleProposal } from '../packages/sim/controllers.ts';

// 故障注入只验证协议，不作为真实模型能力或推理证据。
const record = request => ({ proposal: { identity: structuredClone(request.identity), action: 'rest', provider: 'laya' },
  input: { test: true }, raw_output: { test: true }, metadata: { test: true }, input_sha256: '0'.repeat(64), batch_ms: 1, batch_size: 1, amortized_ms: 1 });
const ready = async requests => requests.map(request => ({ record: record(request) }));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('partial decisions never advance; retry targets only failed IDs and applies once', async () => {
  let calls = [], fail = true;
  const provider = async requests => { calls.push(requests); return requests.map((r, i) => fail && i === 1 ? { identity: r.identity, error: 'test outage' } : { record: record(r) }); };
  const s = new Session({ initialAgents: 3 }, provider); s.changeMode('laya');
  await s.advance(true); assert.equal(s.world.snapshot().tick, 0); assert.equal(s.view().ready, 2); assert.equal(s.view().failed, 1);
  await s.advance(true); assert.equal(calls.length, 1);
  assert.throws(() => s.export(), /committed_boundary/);
  fail = false; s.retry(); await s.advance(true);
  assert.equal(calls[1].length, 1); assert.equal(calls[1][0].identity.attemptId, 'try-1'); assert.equal(s.world.snapshot().tick, 10);
  const export_ = s.export(); assert.equal(export_.entries.filter(e => e.kind === 'round').length, 1); assert.equal(export_.attempts.length, 2);
  const replay = new Replay(export_); while (replay.step()); assert.deepEqual(replay.world.snapshot(), s.world.snapshot());
});
test('pause retains successful replies; explicit single step later commits without another inference', async () => {
  const wait = deferred(); let requests, calls = 0;
  const s = new Session({}, async rs => { requests = rs; calls++; return wait.promise; }); s.changeMode('laya'); s.resume();
  const job = s.advance(); s.pause(); wait.resolve(requests.map(r => ({ record: record(r) }))); await job;
  assert.equal(s.world.snapshot().tick, 0); assert.equal(s.status, 'ready'); assert.equal(s.view().ready, 8);
  await s.advance(true); assert.equal(s.world.snapshot().tick, 10); assert.equal(calls, 1);
});
test('reset during inference rejects late old-world result; current world progresses independently', async () => {
  const wait = deferred(); let requests;
  const s = new Session({}, async rs => { requests = rs; return wait.promise; }); s.changeMode('laya');
  const job = s.advance(true); s.reset({ seed: 2, runId: 'new-world' }); s.changeMode('rule');
  await s.advance(true); const current = s.world.snapshot();
  wait.resolve(requests.map(r => ({ record: record(r) }))); await job; assert.deepEqual(s.world.snapshot(), current);
});
test('intervention invalidates full batch; stale inference cannot act on new resources', async () => {
  const wait = deferred(); let requests;
  const s = new Session({}, async rs => { requests = rs; return wait.promise; }); s.changeMode('laya');
  const job = s.advance(true); s.intervene({ kind: 'nutrient', x: 3, y: 3, amount: 5 }); const changed = s.world.snapshot();
  wait.resolve(requests.map(r => ({ record: record(r) }))); await job; assert.deepEqual(s.world.snapshot(), changed); assert.equal(s.view().ready, 0);
  const export_ = s.export(); assert.equal(export_.attempts[0].status, 'cancelled');
  const replay = new Replay(export_); while (replay.step()); assert.deepEqual(replay.world.snapshot(), changed);
});
test('invalid intervention preserves in-flight round; invalid or duplicated response cannot partially commit', async () => {
  const wait = deferred(); let requests;
  const s = new Session({}, async rs => { requests = rs; return wait.promise; }); s.changeMode('laya');
  const job = s.advance(true), agent = s.world.snapshot().agents[0];
  assert.throws(() => s.intervene({ kind: 'obstacle', x: agent.x, y: agent.y, blocked: true }), /occupied/);
  wait.resolve([...requests.map(r => ({ record: record(r) })), { record: record(requests[0]) }]); await job;
  assert.equal(s.world.snapshot().tick, 0); assert.equal(s.status, 'error'); assert.equal(s.view().ready, 0); assert.equal(s.view().failed, 8);
});
test('stale retry response and nonfinite output are rejected; explicit fallback records true provider', async () => {
  let old;
  const s = new Session({ initialAgents: 1 }, async requests => {
    const request = requests[0]; if (!old) { old = request; return [{ identity: request.identity, error: 'offline' }]; }
    return [{ record: record(old) }];
  }); s.changeMode('laya'); await s.advance(true); s.retry(); await s.advance(true);
  assert.equal(s.world.snapshot().tick, 0); assert.match(s.error, /stale_attemptId/);
  s.changeMode('rule-fallback'); await s.advance(true); const recording = s.export();
  assert(recording.entries.find(e => e.kind === 'round').proposals.every(p => p.provider === 'rule-fallback'));
});
test('capacity stops before next execution and exports complete recorded prefix', async () => {
  const s = new Session({}, ready, () => {}, 2); await s.advance(true); await s.advance(true); await s.advance(true);
  assert.equal(s.world.snapshot().tick, 20); assert.equal(s.status, 'record-full'); const recording = s.export();
  assert.equal(recording.stopReason, 'record_capacity'); assert.equal(recording.entries.length, 2);
  const replay = new Replay(recording); while (replay.step()); assert.deepEqual(replay.world.snapshot(), s.world.snapshot());
});
test('mixed mode, environment interventions, and strict replay validate every execution', async () => {
  const s = new Session({ horizon: 100 }, ready);
  await s.advance(true); s.intervene({ kind: 'nutrient', x: 1, y: 1, amount: 8 }); s.changeMode('random');
  for (let i = 0; i < 8; i++) await s.advance(true);
  s.changeMode('laya-memory'); await s.advance(true);
  const recording = s.export(), replay = new Replay(recording); while (replay.step());
  assert.deepEqual(replay.world.snapshot(), recording.final);
  const damaged = structuredClone(recording); damaged.entries.find(e => e.kind === 'round').outcomes[0].reward += 1;
  const bad = new Replay(damaged); assert.throws(() => { while (bad.step()); }, /outcome_mismatch/);
  const branch = new Session({}, ready); branch.restore(recording.final); assert.deepEqual(branch.world.snapshot(), s.world.snapshot());
});
test('branches share the starting world and RNG by value, with exactly one declared change', async () => {
  const source = new Session({}, ready); for (let i = 0; i < 3; i++) await source.advance(true);
  const before = source.world.snapshot(), a = source.fork('branch-a', {kind:'controller',mode:'random'});
  const b = source.fork('branch-b', {kind:'environment',parameter:'supplyAmount',value:4});
  const aStart = a.world.snapshot(), bStart = b.world.snapshot();
  aStart.config.runId = before.config.runId; assert.deepEqual(aStart, before);
  bStart.config.runId = before.config.runId; bStart.config.supplyAmount = before.config.supplyAmount; assert.deepEqual(bStart, before);
  assert.equal(a.export().branch.sourceHash, b.export().branch.sourceHash);
  await a.advance(true); assert.deepEqual(source.world.snapshot(), before); assert.equal(b.world.snapshot().tick, before.tick);
  const replay = new Replay(a.export()); while (replay.step()); assert.deepEqual(replay.world.snapshot(), a.world.snapshot());
  assert.throws(() => source.fork('bad', {kind:'environment',parameter:'foodDecay',value:2}));
  assert.deepEqual(source.world.snapshot(), before);
});

// 合成学习后端只用于事务故障测试；真实 PPO 另由 Python 与真实 TS 反馈测试。
function learningPort() {
  const calls = {prepare:0,commit:0,abort:0}; let stage;
  return {calls,
    async prepare(world,requests,mode,tx) { calls.prepare++;
      stage={transactionId:tx,committed:false,frozen:mode.endsWith('frozen'),noLaya:mode.startsWith('no-laya'),records:mode==='no-laya'?[]:requests.map(record),updates:[],
        proposals:requests.map(r=>({...record(r).proposal,provider:mode==='no-laya'?'individual-ppo-no-laya':'laya+individual-ppo',revision:0,distribution:Object.fromEntries(r.candidates.map(c=>[c.id,c.id==='rest'?1:0]))})),
        policyInputs:requests.map(r=>({agentId:r.identity.agentId,encoding:'test-only',features:[1],mask:[true],prior:null,revision:0}))};return stage; },
    async commit(run,tx,result) {calls.commit++;return {transactionId:tx,worldHash:result.afterHash,tick:result.snapshot.tick,updates:[],revisions:Object.fromEntries(result.proposals.map(p=>[p.identity.agentId,p.revision])),retired:[]};},
    async abort() {calls.abort++;stage=null;}
  };
}
test('learning feedback timeout retries only commit; mutations and incomplete export are blocked', async () => {
  const port=learningPort(), commit=port.commit; let fail=true;
  port.commit=async (...args)=>{if(fail) {port.calls.commit++;throw Error('test response lost');}return commit(...args);};
  const s=new Session({initialAgents:2},ready,()=>{},2000,port);s.changeMode('no-laya');await s.advance(true);
  assert.equal(s.world.snapshot().tick,0);assert.equal(s.status,'error');assert(s.view().learningCommitPending);
  assert.throws(()=>s.reset({}));assert.throws(()=>s.changeMode('rule'));assert.throws(()=>s.intervene({kind:'nutrient',x:0,y:0,amount:1}));assert.throws(()=>s.export());
  await assert.rejects(s.cancelLearning(),/动作结果已暂存/);
  fail=false;s.retry();await s.advance(true);
  assert.equal(s.world.snapshot().tick,10);assert.equal(port.calls.prepare,1);assert.equal(port.calls.commit,2);
  const recording=s.export();assert.equal(recording.entries.filter(e=>e.kind==='round').length,1);
  const replay=new Replay(recording);while(replay.step());assert.deepEqual(replay.world.snapshot(),s.world.snapshot());
});
test('learning pause retains staged proposal; cancellation is confirmed before world can change', async () => {
  const port=learningPort(), wait=deferred(), prepare=port.prepare;let args;
  port.prepare=(...a)=>{args=a;return wait.promise;};
  const s=new Session({},ready,()=>{},2000,port);s.changeMode('learning');s.resume();const running=s.advance();s.pause();
  wait.resolve(await prepare(...args));await running;
  assert.equal(s.status,'ready');assert.equal(s.world.snapshot().tick,0);assert.equal(port.calls.commit,0);
  await s.cancelLearning();assert.equal(port.calls.abort,1);s.intervene({kind:'nutrient',x:0,y:0,amount:1});assert.equal(s.world.snapshot().tick,0);
});
test('learning cancellation invalidates a late prepare reply and never commits it', async () => {
  const port=learningPort(), wait=deferred(), prepare=port.prepare;let args;
  port.prepare=(...a)=>{args=a;return wait.promise;};
  const s=new Session({},ready,()=>{},2000,port);s.changeMode('learning');const running=s.advance(true);
  await s.cancelLearning();s.reset({seed:2,runId:'new-learning-world'});
  wait.resolve(await prepare(...args));await running;
  assert.equal(s.world.snapshot().config.runId,'new-learning-world');assert.equal(s.world.snapshot().tick,0);assert.equal(port.calls.commit,0);
});

test('empty replay cannot certify a changed final world', () => {
  const session=new Session({},ready), recording=session.export();recording.final.tick=10;
  assert.throws(()=>new Replay(recording),/empty_final_mismatch/);
});

test('replay evidence contains only consumed recorded rounds, never future learning', async () => {
  const port=learningPort(), session=new Session({initialAgents:1},ready,()=>{},2000,port);
  session.changeMode('no-laya');await session.advance(true);await session.advance(true);
  const replay=new Replay(session.export()), calls={...port.calls};
  assert.equal(replay.evidence(),null);assert.equal(replay.learningEvidence().receipt,null);
  while(replay.world.snapshot().tick<10) replay.step();
  assert.equal(replay.evidence().requests[0].identity.tick,0);
  assert.equal(replay.learningEvidence().receipt.tick,10);
  const detached=replay.evidence();detached.proposals[0].action='fake';
  assert.notEqual(replay.evidence().proposals[0].action,'fake');
  while(replay.step());
  assert.equal(replay.learningEvidence().receipt.tick,20);
  assert.deepEqual(port.calls,calls);
});

test('evolved mode: injected controller proposes, receives feedback, replays from the record, and refuses to fork', async () => {
  const calls = { propose: 0, feedback: 0 };
  const factory = name => name === 'demo' ? Object.assign((r, seed) => { calls.propose++; return { ...ruleProposal(r, seed), provider: 'evolved-demo' }; }, { feedback: (outcomes, next) => { calls.feedback++; assert.ok(outcomes.every(o => typeof o.energyAfter === 'number')); assert.ok(next instanceof Map); } }) : null;
  const s = new Session({ seed: 4, runId: 'evolved-test', initialAgents: 3 }, async () => { throw Error('no model'); }, () => {}, 2000, undefined, factory);
  assert.throws(() => s.changeMode('evolved:unknown'), /invalid_mode/);
  s.changeMode('evolved:demo'); s.resume(); for (let i = 0; i < 12; i++) await s.advance(true);
  assert.ok(calls.propose >= 12 * 3 - 3 && calls.feedback === 12, JSON.stringify(calls));
  const rec = s.export(); assert.equal(rec.mode, 'evolved:demo'); assert.ok(rec.entries.filter(e => e.kind === 'round').every(e => e.proposals.every(p => p.provider === 'evolved-demo')));
  const r = new Replay(rec); r.seek(r.total); assert.deepEqual(r.world.snapshot(), s.world.snapshot());
  assert.throws(() => s.fork('branch-x', { kind: 'controller', mode: 'random' }), /进化策略/);
  assert.throws(() => s.fork('branch-y', { kind: 'environment', parameter: 'supplyAmount', value: 2 }), /进化策略/);
});

test('evolved mode: factory gets a lineage lookup, and innate() reports observer-only types for living agents', async () => {
  let ctx = null;
  const factory = (name, c) => { if (name !== 'typed') return null; ctx = c; const type = new Map();
    const of = id => { if (!type.has(id)) { const p = c.parentOf(id); type.set(id, p ? of(p) : type.size % 2); } return type.get(id); };
    return Object.assign((r, seed) => { of(r.identity.agentId); return ruleProposal(r, seed); }, { types: { labels: ['甲', '乙'], of } }); };
  const s = new Session({ seed: 5, runId: 'typed-test', initialAgents: 4 }, async () => { throw Error('no model'); }, () => {}, 2000, undefined, factory);
  assert.equal(s.innate(), null);
  s.changeMode('evolved:typed'); s.resume(); for (let i = 0; i < 5; i++) await s.advance(true);
  assert.equal(typeof ctx.parentOf, 'function'); assert.equal(ctx.parentOf('nonexistent'), null);
  const t = s.innate(); assert.deepEqual(t.labels, ['甲', '乙']);
  const living = s.world.snapshot().agents.map(a => a.id); assert.deepEqual(Object.keys(t.of).sort(), living.slice().sort()); assert.ok(Object.values(t.of).every(v => v === 0 || v === 1));
  s.changeMode('rule'); assert.equal(s.innate(), null);
});
