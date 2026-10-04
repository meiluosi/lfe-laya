import test from 'node:test';
import assert from 'node:assert/strict';
import {MicroWorld} from '../packages/sim/micro-world.ts';
import {validateProposal} from '../packages/protocol/decision.ts';
const proposal=(r,action='rest')=>({identity:r.identity,action,provider:'test-rule'});
const advance=(w,a='rest')=>w.step(proposal(w.request(),a));
test('非法/过期/重复动作、候选重排和返回值修改不污染世界',()=>{
 const w=new MicroWorld(); const r=w.request(),s=w.snapshot();
 for(const p of [proposal(r,'fly'),{...proposal(r),identity:{...r.identity,epoch:99}}, {...proposal(r),distribution:{rest:NaN}}]) {assert.equal(w.step(p).accepted,false);assert.deepEqual(w.snapshot(),s);}
 const sorted={...r,candidates:[...r.candidates].reverse()};assert.equal(validateProposal(sorted,proposal(r)),null);
 r.observation.energy=-5;assert.ok(w.request().observation.energy>0);
 const p=proposal(w.request());assert.equal(w.step(p).accepted,true);const committed=w.snapshot();
 assert.equal(w.step(p).accepted,false);assert.deepEqual(w.snapshot(),committed);
});
test('重试与取消使旧请求失效，等待不推进模拟',()=>{
 const w=new MicroWorld(); const r=w.request();assert.deepEqual(w.request(),r);
 const next=w.retry();assert.equal(w.step(proposal(r)).accepted,false);assert.equal(w.snapshot().tick,0);
 w.cancel();w.request();assert.equal(w.step(proposal(next)).accepted,false);assert.equal(w.snapshot().tick,0);
});
test('局部感知不泄漏远处食物和日程，记忆有来源与容量上限',()=>{
 const a=new MicroWorld({initialFood:0,perception:1,memorySize:2});const b=new MicroWorld({initialFood:0,perception:1,memorySize:2});
 const s=b.snapshot();s.food[0]=20;s.ledger.initial+=20;b.restore(s);
 assert.deepEqual(a.request().observation,b.request().observation);
 const keys=Object.keys(a.request().observation);assert.deepEqual(keys,['energy','capacity','age','local','memory']);
 assert.ok(a.request().observation.local.every(c=>Math.abs(c.dx)+Math.abs(c.dy)<=1));
 const c=new MicroWorld({memorySize:2});for(let i=0;i<10;i++)advance(c);
 assert.ok(c.request().observation.memory.length<=2);
});
test('摄食/移动/代谢/补给能量账本闭合且容量不溢出',()=>{
 const w=new MicroWorld({initialFood:0,initialEnergy:39.9});const s=w.snapshot();s.food[s.y*7+s.x]=20;s.ledger.initial+=20;w.restore(s);
 const t=advance(w,'eat');assert.ok(t.events.some(e=>e.kind==='ate' && Math.abs(e.amount-.1)<1e-7));
 assert.ok(t.snapshot.energy<=40);w.assertLedger();
 for(let i=0;i<100 && !w.done();i++){const r=w.request();w.step(proposal(r,r.candidates[i%r.candidates.length].id));w.assertLedger();}
});
test('死亡与截断不同，终止个体不得再决策',()=>{
 const w=new MicroWorld({initialFood:0,initialEnergy:.1});const t=advance(w);assert.equal(t.terminated,true);assert.equal(t.truncated,false);assert.equal(t.rewardParts.death,-1);assert.throws(()=>w.request(),/done/);
 const h=new MicroWorld({horizon:1});const end=advance(h);assert.equal(end.terminated,false);assert.equal(end.truncated,true);
});
test('按动作记录严格回放与完整世界恢复确定，不依赖渲染',()=>{
 const a=new MicroWorld({seed:42});const actions=[];
 for(let i=0;i<35;i++){const r=a.request();const action=r.candidates[i%r.candidates.length].id;actions.push(action);a.step(proposal(r,action));}
 const b=new MicroWorld({seed:42});for(const action of actions) advance(b,action);assert.deepEqual(a.snapshot(),b.snapshot());
 const c=new MicroWorld();c.restore(a.snapshot());for(let i=0;i<8;i++){advance(a);advance(c);}assert.deepEqual(a.snapshot(),c.snapshot());
 const before=c.snapshot();const bad=c.snapshot();bad.food[0]=-1;assert.throws(()=>c.restore(bad));assert.deepEqual(c.snapshot(),before);
});
test('恢复快照隔离旧的在途请求，即使模拟步相同',()=>{
 const w=new MicroWorld();const old=w.request();const snapshot=w.snapshot();w.restore(snapshot);w.request();
 assert.equal(w.step(proposal(old)).accepted,false);assert.deepEqual(w.snapshot(),snapshot);
});
