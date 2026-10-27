import { historyPoint, type HistoryPoint } from './history';
import { isLearning } from '../../packages/sim/learning-port.ts';
import type { BranchChange } from '../../packages/sim/session.ts';
import { LocalLearning, api } from './learning-client';
import { stateHash } from '../../packages/sim/ecology.ts';
import type { Config, Intervention, Snapshot } from '../../packages/sim/ecology.ts';
import { Session, Replay } from '../../packages/sim/session.ts';
import { evolvedFactory } from '../studio/genomes';
import type { Mode, Provider, Recording } from '../../packages/sim/session.ts';

const provider: Provider = async (requests, { signal, memory }) => {
  const abort = new AbortController(), cancel = () => abort.abort(signal.reason);
  signal.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(() => abort.abort(new Error('model_timeout_120s')), 120000);
  try {
    const response = await fetch('/api/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests, memory }), signal: abort.signal });
    if (!response.ok) throw Error(`模型服务 ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const payload = await response.json();
    if (payload.mode !== 'real-laya' || !Array.isArray(payload.records)) throw Error('invalid_model_response');
    return payload.records.map((record: unknown) => ({ record }));
  } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel); }
};
const learning = new LocalLearning();
let session = new Session({runId:`interactive-${crypto.randomUUID()}`}, provider, () => notify(), 2000, learning, evolvedFactory), replay: Replay | null = null, replayPaused = true, replaySource: Recording | null = null;
const branches = new Map<string, Session>();
let operationBusy=false;
/** 回看实时会话：暂停后导出记录并在回放中跳转；live 退出回放，原会话不变。 */
let scrubbing=false;
let tapeOwner: unknown = null, tapeSent = 0;
/** 对照目标：另一个分支会话的只读回放。只用于画“幽灵”和对照曲线，不参与推进，也不改变任何会话。 */
let compareId: string | null = null, compareReplay: Replay | null = null, compareKey = '', compareTape: ReturnType<Replay['tape']> = [];
function syncCompare() {
  const target = compareId ? branches.get(compareId) : undefined;
  if (!target || target === session) { if (compareId) { compareId = null; compareReplay = null; compareKey = ''; compareTape = []; self.postMessage({ kind: 'compare-tape', runId: null, marks: [], initialTick: 0, initialLiving: 0 }); } return null; }
  const key = `${compareId}:${target.tape().length}`;
  if (key !== compareKey) {
    const rec = target.export(); compareReplay = new Replay(rec); compareKey = key; compareTape = compareReplay.tape();
    self.postMessage({ kind: 'compare-tape', runId: compareId, marks: compareTape, initialTick: rec.initial.tick, initialLiving: rec.initial.agents.length });
  }
  return compareReplay;
}
function ghostFor(tick: number) {
  const r = syncCompare(); if (!r || !compareId) return null;
  let index = -1;
  // 状态“已执行 i 条记录之后”的时刻：i=0 为初始，其余取带子标记。两者都只在记录边界上有定义。
  const initialTick = r.initialTick;
  if (tick === initialTick) index = 0; else for (let i = 0; i < compareTape.length; i++) if (compareTape[i].tick === tick) index = i + 1;
  if (index < 0) return { runId: compareId, tick: null as number | null, agents: [] as unknown[] };
  r.seek(index);
  return { runId: compareId, tick, agents: r.world.snapshot().agents.map(a => ({ id: a.id, x: a.x, y: a.y, shape: a.shape, heading: a.heading })) };
}
let speed = 1, timer: ReturnType<typeof setTimeout> | null = null, actualRate = 0;
const history: HistoryPoint[] = [];
/** 观察者统计：按 200 tick 窗口累计吃到营养 / 有害食物的次数（只读事件流，高水位去重，回看不重复累计；不进入任何个体输入）。 */
const ADAPT_WINDOW = 200; const adapt = { windowTicks: ADAPT_WINDOW, good: [] as number[], bad: [] as number[] }; let adaptSeq = -1;
function resetAdapt() { adapt.good = []; adapt.bad = []; adaptSeq = -1; }
function addAdapt(events: { seq: number; tick: number; kind: string; reason?: string }[]) {
  for (const e of events) { if (e.seq <= adaptSeq) continue; adaptSeq = e.seq; if (e.kind !== 'ate') continue; const w = Math.floor(e.tick / ADAPT_WINDOW); while (adapt.good.length <= w) { adapt.good.push(0); adapt.bad.push(0); } (e.reason === 'toxic' ? adapt.bad : adapt.good)[w]++; }
}
const statusLabels = { paused: '已暂停', running: '运行中', waiting: '等待模型决策', ready: '结果已就绪 · 已暂停', error: '模型故障 · 已暂停', done: '运行结束', 'record-full': '记录已满 · 已暂停' };
function notify(reply?: number, error?: string) {
  if (!replay) scrubbing = false;
  const snapshot = (replay?.world ?? session.world).snapshot();
  const v = replay ? {...session.view(), error:null,pending:false,failed:0,ready:0,learningTransaction:null,learningCommitPending:false,learningUpdates:replay.learningEvidence().updates,entries:replay.index,capacity:replaySource!.entries.length,attempts:0,recordBytes:replay.recordBytes,roundMilliseconds:0} : session.view();
  const evidence=replay ? replay.evidence() : session.evidence(), last=replay ? evidence : session.lastRound;
  self.postMessage({ kind: 'state', reply, error: error ?? v.error, snapshot, paused: replay ? replayPaused : v.paused, speed, mode: replay ? 'replay' : v.mode,
    roundMs: v.roundMilliseconds, actualRate, status: replay ? (replayPaused ? '录制回放 · 已暂停' : '录制回放') : session.world.done() ? (snapshot.agents.length ? '时限结束' : '世界已灭绝') : statusLabels[v.status],
    history: history.slice(), adapt: { windowTicks: adapt.windowTicks, good: adapt.good.slice(), bad: adapt.bad.slice() }, hash: stateHash(snapshot), runtime: v,
    branches: [...branches.values()].map(b=>({runId:b.world.snapshot().config.runId,active:b===session,mode:b.mode,source:b.branchInfo(),ticksPerSecond:b.world.snapshot().config.ticksPerSecond,tick:b.world.snapshot().tick,living:b.world.snapshot().agents.length,energy:b.world.snapshot().agents.reduce((sum,a)=>sum+a.energy,0),births:b.world.snapshot().metrics.births,deaths:b.world.snapshot().metrics.deaths})),
    learning: replay ? replay.learningEvidence().receipt : session.lastLearning,
    lastDecisions: last?.requests?.map((r, i) => ({ request: r, proposal: last.proposals![i], outcome: last.outcomes![i], model:evidence?.records.find(m=>m.proposal.identity.agentId===r.identity.agentId)??null, policyInput:evidence?.learning?.prepared.policyInputs.find(p=>p.agentId===r.identity.agentId)??null })) ?? [],
    replay: replay ? { index: replay.index, total: replaySource!.entries.length, live: scrubbing } : null,
    compare: compareId ? ghostFor(snapshot.tick) : null });
  publishTape();
}
function cancelTimer() { if (timer !== null) clearTimeout(timer); timer = null; }
function publishTape() {
  const owner = replay ?? session, marks = replay ? replay.tape() : session.tape();
  if (owner !== tapeOwner || marks.length < tapeSent) { tapeOwner = owner; tapeSent = 0; self.postMessage({ kind: 'tape', from: 0, marks, total: marks.length }); }
  else if (marks.length > tapeSent) self.postMessage({ kind: 'tape', from: tapeSent, marks: marks.slice(tapeSent), total: marks.length });
  tapeSent = marks.length;
}
function addHistory() {
  if (scrubbing) return;
  const s = (replay?.world ?? session.world).snapshot();
  if (history.at(-1)?.tick === s.tick) return;
  history.push(historyPoint(s)); addAdapt(s.events);
  if (history.length > 400) history.shift();
}
async function step(single = false) {
  if (replay) { if (!replay.step()) replayPaused = true; }
  else await session.advance(single);
  addHistory(); notify();
}
function schedule() {
  cancelTimer(); if (replay ? replayPaused : session.paused || session.world.done() || session.view().pending) return;
  const s = (replay?.world ?? session.world).snapshot(), interval = s.config.decisionTicks / s.config.ticksPerSecond * 1000 / speed;
  const start = performance.now();
  timer = setTimeout(async () => {
    timer = null;
    try { await step(); actualRate = s.config.decisionTicks / s.config.ticksPerSecond / ((performance.now() - start) / 1000); notify(); schedule(); }
    catch (error) { session.pause(); replayPaused = true; notify(undefined, String(error)); }
  }, Math.max(0, interval - session.roundMilliseconds));
}
self.onmessage = async (event: MessageEvent<{ id: number; kind: string; config?: Partial<Config>; snapshot?: Snapshot; command?: Intervention; recording?: Recording; value?: unknown }>) => {
  const q = event.data; let ownsOperation=false;
  try {
    if(operationBusy && !['pause','inspect'].includes(q.kind)) throw Error('正在保存、切换或恢复状态，请稍候。');
    if(['reset','mode','learning-checkpoint','learning-restore','branch','switch-branch','comparison'].includes(q.kind)) {
      session.pause();cancelTimer();
      if(session.view().learningTransaction) throw Error('请先完成或取消当前学习事务。');
      operationBusy=true;ownsOperation=true;
    }
    if (q.kind === 'reset') { session.cancelPending(); const currentId=session.world.snapshot().config.runId; await learning.close(currentId); for (const id of branches.keys()) if (id!==currentId) { try { await learning.close(id); } catch { /* 旧分支的学习运行可能已不存在 */ } } branches.clear(); compareId=null; session=new Session({...q.config,runId:`interactive-${crypto.randomUUID()}`},provider,()=>notify(),2000,learning,evolvedFactory); cancelTimer(); replay = null; replaySource = null; history.length = 0; resetAdapt(); actualRate = 0; }
    else if (q.kind === 'play') { if (replay) replayPaused = false; else session.resume(); schedule(); }
    else if (q.kind === 'pause') { if (replay) replayPaused = true; else session.pause(); cancelTimer(); }
    else if (q.kind === 'step') { cancelTimer(); if (replay) replayPaused = true; await step(true); }
    else if (q.kind === 'speed') { if (![1, 4, 16].includes(Number(q.value))) throw Error('invalid_speed'); speed = Number(q.value); schedule(); }
    else if (q.kind === 'mode') { if (replay) throw Error('回放期间不能改变大脑'); await learning.configure(session.world.snapshot().config.runId,String(q.value)); session.changeMode(q.value as Mode); schedule(); }
    else if (q.kind === 'cancel-learning') { await session.cancelLearning(); cancelTimer(); }
    else if (q.kind === 'learning-checkpoint') {
      session.pause(); session.export(); const saved = await api('checkpoint',{run_id:session.world.snapshot().config.runId,world:session.world.snapshot()});
      self.postMessage({kind:'learning-checkpoint',reply:q.id,...saved});
    }
    else if (q.kind === 'learning-restore') {
      session.pause(); session.export(); cancelTimer(); const runId=`restored-${crypto.randomUUID()}`;
      const restored=await api('restore',{run_id:runId,checkpoint_id:q.value});
      if(!branches.has(session.world.snapshot().config.runId)) await learning.close(session.world.snapshot().config.runId); learning.adopt(runId,restored.no_laya);
      session=new Session({},provider,()=>notify(),2000,learning,evolvedFactory);
      session.restore(restored.world,restored.no_laya?(restored.frozen?'no-laya-frozen':'no-laya'):restored.frozen?'frozen':'learning');replay=null;replaySource=null;history.length=0;resetAdapt();
      self.postMessage({kind:'notice',text:'完整状态已恢复；世界保持暂停，可继续学习。'});
    }
    else if (q.kind === 'branch') {
      if(replay) throw Error('请先退出回放；学习分支必须来自完整检查点。');
      session.pause();cancelTimer();const source=session.export(), change=q.value as BranchChange;
      if(branches.size>=4) throw Error('当前最多保留四个分支，请先导出。');
      const runId=`branch-${crypto.randomUUID()}`;let branch:Session;
      if(isLearning(session.mode)) {
        if(change.kind!=='controller'||change.mode!==(session.mode.startsWith('no-laya')?'no-laya-frozen':'frozen')) throw Error('学习对照只改变是否更新参数。');
        const saved=await api('checkpoint',{run_id:source.final.config.runId,world:source.final});
        const restored=await api('restore',{run_id:runId,checkpoint_id:saved.checkpoint_id});learning.adopt(runId,restored.no_laya);
        await api('freeze',{run_id:runId,frozen:true});
        branch=new Session({},provider,()=>notify(),2000,learning,evolvedFactory);branch.restore(restored.world,change.mode);
        branch.markBranch({sourceRunId:source.final.config.runId,sourceHash:stateHash(source.final),sourceTick:source.final.tick,change,original:session.mode});
      } else branch=session.fork(runId,change,()=>notify());
      branches.set(source.final.config.runId,session);branches.set(runId,branch);session=branch;history.length=0;resetAdapt();actualRate=0;compareId=source.final.config.runId;
    }
    else if(q.kind==='switch-branch') {
      session.pause();session.export();const next=branches.get(String(q.value));if(!next)throw Error('unknown_branch');
      compareId=session.world.snapshot().config.runId;cancelTimer();session=next;session.pause();replay=null;replaySource=null;history.length=0;resetAdapt();actualRate=0;
    }
    else if(q.kind==='comparison') {
      session.pause();session.export();self.postMessage({kind:'comparison',data:{format:'ecology-comparison-v1',runs:[...branches.values()].map(b=>b.export()),note:'各分支模拟时间可能不同；只有匹配的时间窗口才能直接比较。'}});
    }
    else if (q.kind === 'retry') { if (replay) throw Error('回放不调用模型'); session.retry(); await step(true); }
    else if (q.kind === 'intervene') { if (replay) throw Error('回放不能改变环境，请先创建分支'); session.intervene(q.command!); schedule(); }
    else if (q.kind === 'restore') { if(isLearning(session.mode)) throw Error('继续学习需要完整学习检查点。'); session.restore(q.snapshot!); replay = null; replaySource = null; cancelTimer(); history.length = 0; resetAdapt(); }
    else if (q.kind === 'export') { self.postMessage({ kind: 'recording', reply: q.id, recording: replay ? replaySource : session.export(), purpose: q.value }); }
    else if (q.kind === 'replay') { const next = new Replay(q.recording!); session.pause();session.cancelPending(); cancelTimer(); replay = next; replaySource = q.recording!; replayPaused = true; scrubbing = false; history.length = 0; resetAdapt(); }
    else if (q.kind === 'scrub-open') {
      if (replay) throw Error('已在回看');
      if (session.view().learningTransaction) throw Error('请先完成或取消当前学习事务。');
      session.pause(); cancelTimer();
      const recording = session.export(), next = new Replay(recording);
      replay = next; replaySource = recording; replayPaused = true; scrubbing = true; next.seek(next.total);
    }
    else if (q.kind === 'seek') { if (!replay) throw Error('尚未进入回看'); cancelTimer(); replayPaused = true; replay.seek(Number(q.value)); }
    else if (q.kind === 'live') { if (!replay || !scrubbing) throw Error('当前不是实时回看'); replay = null; replaySource = null; scrubbing = false; cancelTimer(); }
    else if (q.kind === 'compare') { compareId = q.value ? String(q.value) : null; if (!compareId) { compareReplay = null; compareKey = ''; compareTape = []; self.postMessage({ kind: 'compare-tape', runId: null, marks: [], initialTick: 0, initialLiving: 0 }); } else if (!branches.has(compareId)) { compareId = null; throw Error('unknown_branch'); } }
    else if (q.kind === 'verify') {
      const candidate = new Replay(q.recording!); let count = 0;
      while (candidate.step()) count++;
      self.postMessage({ kind: 'verified', reply: q.id, count, hash: stateHash(candidate.world.snapshot()) });
    }
    else if (q.kind !== 'inspect') throw Error('unknown_command');
    notify(q.id);
  } catch (error) { notify(q.id, error instanceof Error ? error.message : String(error)); }
  finally {if(ownsOperation) operationBusy=false;}
};
notify();
