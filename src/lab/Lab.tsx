import { useState } from 'react';
import { EcologyCanvas, type Tool } from './Canvas';
import { EnergyHistory } from './EnergyHistory';
import { actionLabels, eventLabels, modes, shapes, type View } from './labels';
import { ArchivePanel, BranchPanel, EvidencePanel, LearningPanel, SettingsPanel, type LabContext } from './panels';
import { loadRecording } from './storage';
import { useWorldWorker } from './useWorldWorker';
export default function Lab() {
  const { view, error, setError, notice, setNotice, saved, setSaved, savedId, setSavedId, checkpointId, setCheckpointId, recordingRef, send, serial } = useWorldWorker();
  const [selected, setSelected] = useState<string | null>('life-0');
  const [following, setFollowing] = useState(false), [resources, setResources] = useState(true), [zoom, setZoom] = useState(1), [fitKey, setFitKey] = useState(0);
  const [tool, setTool] = useState<Tool>('observe'), [seed, setSeed] = useState('1'), [frameMs, setFrameMs] = useState(0), [details, setDetails] = useState(false);
  const [preset,setPreset]=useState('ecology');
  const [reduceMotion,setReduceMotion]=useState(false);
  const [branchChoice,setBranchChoice]=useState('random');
  const openSaved = async (verify: boolean) => {
    try { const recording = await loadRecording(savedId); recordingRef.current = recording; send(verify ? 'verify' : 'replay', {recording}); if (!verify) fit(); }
    catch (error) { setError(String(error)); }
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    try { if (file.size > 80 * 1024 * 1024) throw Error('文件超过 80 MiB 上限'); const recording = JSON.parse(await file.text()); recordingRef.current = recording; send('replay', {recording}); fit(); }
    catch (error) { setError(`导入失败：${error}`); }
  };
  const importLearning = async (file?: File) => {
    if (!file) return;
    try { if(file.size>256*1048576) throw Error('检查点超过 256 MiB');
      const response=await fetch('/api/learning/import',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
      if(!response.ok) throw Error(await response.text()); const result=await response.json();setCheckpointId(result.checkpoint_id);localStorage.setItem('lfe-learning-checkpoint',result.checkpoint_id);setNotice('完整检查点已导入，可恢复为新的独立世界。');
    } catch(error) {setError(String(error));}
  };
  const fit = () => { setZoom(1); setFollowing(false); setFitKey(k => k + 1); };
  if (!view) return <main className="lab-loading">正在创建真实世界…{error && <p role="alert">{error}</p>}</main>;
  const s = view.snapshot, c = s.config, agent = s.agents.find(a => a.id === selected), ancestry = s.lineage.find(a => a.id === selected);
  const totalFood = s.food.reduce((a, b) => a + b, 0), losses = s.ledger.metabolism + s.ledger.movement + s.ledger.decay + s.ledger.reproduction + s.ledger.deathLoss + s.ledger.overflow;
  const residual = totalFood + s.agents.reduce((n, a) => n + a.energy, 0) + losses - s.ledger.initial - s.ledger.supplied;
  const reset = () => {
    const n = Number(seed); if (!Number.isInteger(n) || n < 1 || n > 0xffffffff) { setError('种子须为 1–4294967295 的整数'); return; }
    send('reset', { config: { ...(preset==='l1'?{width:16,height:12,initialAgents:8,reproduction:false,mutation:false,maxAge:100000,horizon:3600,phaseTicks:1200,initialEnergy:32,metabolism:.012,initialFood:100,supplyAmount:6,foodDecay:.003,diffusion:.002}:{}), seed: n, runId: `interactive-${n}-${serial.current}` } }); setSelected('life-0'); fit();
  };
  const place = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= c.width || y >= c.height) return;
    send('intervene', { command: tool === 'nutrient' ? { kind: 'nutrient', x, y, amount: 12 } : { kind: 'obstacle', x, y, blocked: tool === 'obstacle' } });
  };
  const ctx: LabContext = { view, s, c, agent, ancestry, selected, send, residual, frameMs, reduceMotion, setReduceMotion, preset, setPreset, seed, setSeed, reset, branchChoice, setBranchChoice, saved, savedId, setSavedId, openSaved, importFile, importLearning, checkpointId };
  return <main className="lab">
    <header className="lab-header"><div><span className="lab-kicker">LFE · LIFE LAB</span><h1>生命观察室</h1></div><div className="lab-source"><span className="status-dot"/>{view.replay ? '历史记录' : '真实模拟'} · {modes[view.mode] ?? view.mode}<small>{view.replay ? '按动作重放 / 不调用模型' : view.mode==='learning'||view.mode==='no-laya' ? (view.paused ? '世界暂停 / 独立学习状态保留' : '个体独立训练 / 效果待对照验证') : view.mode.endsWith('frozen') ? '策略参数冻结 / 行为仍可继续' : '共享世界 / 未训练个体策略'}</small></div><a href="/m0/index.html">M0 实验记录 ↗</a></header>
    <div className="lab-controls"><button className="primary" onClick={() => send(view.paused ? 'play' : 'pause')} disabled={view.replay ? view.replay.index >= view.replay.total : s.tick >= c.horizon || !s.agents.length}>{view.paused ? '开始' : '暂停'}</button><button onClick={() => send('step')} disabled={view.replay ? view.replay.index >= view.replay.total : s.tick >= c.horizon || !s.agents.length} title="执行一轮决策，推进 10 个模拟步">单轮</button><label>速度 <select aria-label="模拟速度" value={view.speed} onChange={e => send('speed', { value: Number(e.target.value) })}>{[1, 4, 16].map(v => <option key={v} value={v}>{v}×</option>)}</select></label><span className="lab-status" role="status">{view.status}</span><div className="lab-time"><strong>{(s.tick / c.ticksPerSecond).toFixed(1)}</strong> 模拟秒 <span>· {s.agents.length} 个生命</span></div></div>
    {notice && <div className="lab-notice" role="status">{notice}<button onClick={() => setNotice('')}>关闭</button></div>}
    {view.runtime.failed > 0 && !view.replay && <div className="lab-error"><span>已保留 {view.runtime.ready} 个结果，{view.runtime.failed} 个请求失败。</span><button onClick={() => send('retry')}>重试失败请求</button><button onClick={() => send('mode',{value:'rule-fallback'})}>明确切换规则降级</button></div>}
    {!!view.runtime.learningTransaction && !view.runtime.learningCommitPending && <div className="lab-notice"><span>本轮学习尚未提交，取消后可修改世界。</span><button onClick={()=>send('cancel-learning')}>取消本轮学习</button></div>}
    {error && <div className="lab-error" role="alert">{error === 'occupied_obstacle' ? '这里有生命，不能放置障碍。' : error}<button onClick={() => setError('')}>关闭</button></div>}
    <section className="lab-stage">
      <div className="lab-world"><EcologyCanvas snapshot={s} selected={selected} following={following} resources={resources} reduceMotion={reduceMotion} zoom={zoom} fitKey={fitKey} tool={tool} onSelect={setSelected} onPan={() => setFollowing(false)} onZoom={d => setZoom(z => Math.max(.5, Math.min(4, z + d)))} onPlace={place} onFrame={setFrameMs}/>
        <div className="world-caption"><span>培养皿 {c.seed.toString().padStart(3, '0')}</span><small>{tool === 'observe' ? '点击生命 · 拖动镜头' : tool === 'nutrient' ? '点击投放 12 能量营养' : tool === 'obstacle' ? '点击放置障碍' : '点击移除障碍'}</small></div>
        <div className="camera-controls"><button aria-label="缩小" onClick={() => setZoom(z => Math.max(.5, z - .2))}>−</button><span>{Math.round(zoom * 100)}%</span><button aria-label="放大" onClick={() => setZoom(z => Math.min(4, z + .2))}>＋</button><button onClick={fit}>全景</button></div>
        {!s.agents.length && <div className="extinction">这个世界已经安静下来。<small>灭绝保留为真实结果，可以重新播种。</small></div>}
      </div>
      <aside className="life-panel"><div className="panel-title"><span>个体观察</span><span>{agent ? shapes[agent.shape] : '—'}</span></div>
        <select aria-label="选择生命" value={selected ?? ''} onChange={e => { setSelected(e.target.value); }}><option value="">选择一个生命</option>{s.agents.map(a => <option key={a.id} value={a.id}>{a.id} · {shapes[a.shape]} · G{a.generation}</option>)}{ancestry?.died !== null && ancestry?.died !== undefined && <option value={ancestry.id}>{ancestry.id} · 已死亡</option>}</select>
        {agent ? <><h2>{agent.id}</h2><div className="energy-label"><span>能量</span><strong>{agent.energy.toFixed(1)} <small>/ {(c.capacity * agent.traits.size).toFixed(1)}</small></strong></div><progress aria-label="个体能量" value={agent.energy} max={c.capacity * agent.traits.size}/><p className="life-action">{actionLabels[agent.lastAction]}{agent.lastRejected ? ' · 本轮受阻' : ''}</p><dl><div><dt>年龄</dt><dd>{((s.tick - agent.born) / c.ticksPerSecond).toFixed(1)} 秒</dd></div><div><dt>世代</dt><dd>G{agent.generation}</dd></div><div><dt>父代</dt><dd>{agent.parentId ?? '初始生命'}</dd></div><div><dt>地点记忆</dt><dd>{agent.memory.length} / {c.memorySize}</dd></div></dl><button className={following ? 'active' : ''} onClick={() => setFollowing(v => !v)}>{following ? '停止跟随' : '跟随生命'}</button></> : <p className="empty-life">{ancestry?.died != null ? `该生命在 ${(ancestry.died / c.ticksPerSecond).toFixed(1)} 秒死亡。` : '选择生命，观察它的经历。'}</p>}
        <div className="recent-events"><span>最近经历</span>{s.events.filter(e => !selected || e.agentId === selected || e.targetId === selected).slice(-5).reverse().map(e => <div key={e.seq}><small>{(e.tick / c.ticksPerSecond).toFixed(1)}s</small><span>{eventLabels[e.kind] ?? e.kind}{e.reason === 'age' ? ' · 寿命耗尽' : e.reason === 'starvation' ? ' · 能量耗尽' : ''}{e.amount !== undefined ? ` ${e.amount.toFixed(2)}` : ''}</span></div>)}</div>
      </aside>
    </section>
    <section className="lab-bottom"><div className="tool-controls" role="group" aria-label="环境工具">{([['observe', '观察'], ['nutrient', '营养'], ['obstacle', '障碍'], ['erase', '擦除']] as const).map(([id, name]) => <button key={id} aria-pressed={tool === id} className={tool === id ? 'active' : ''} onClick={() => setTool(id)}>{name}</button>)}<label><input type="checkbox" checked={resources} onChange={e => setResources(e.target.checked)}/>资源层</label></div><div className="world-totals"><span>出生 <b>{s.metrics.births}</b></span><span>死亡 <b>{s.metrics.deaths}</b></span><span>营养 <b>{totalFood.toFixed(0)}</b></span></div><button onClick={() => setDetails(v => !v)} aria-expanded={details}>{details ? '收起详情' : '实验详情'}</button></section>
    {details && <SettingsPanel {...ctx}/>}
    {details && <BranchPanel {...ctx}/>}
    {details && <ArchivePanel {...ctx}/>}
    {details && <LearningPanel {...ctx}/>}
    {details && <section className="lab-archive"><h3>能量与资源变化 · 最近 {view.history.length} 轮</h3><EnergyHistory history={view.history} snapshot={s} selected={selected}/></section>}
    {details && <EvidencePanel {...ctx}/>}
    <footer className="lab-footer"><span>世界由同一 TS 模拟器推进，画面不驱动行为。</span><a href="/">查看早期原型</a></footer>
  </main>;
}
