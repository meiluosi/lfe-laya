import { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, type StageHandle } from './Stage';
import { Tape } from './Tape';
import { Palette, type Command } from './Palette';
import { StoryCard } from './StoryCard';
import { useStudio } from './useStudio';
import { modeInfo } from './modeInfo';
import type { Tool } from './stageRenderer';
import { modes, shapes } from '../lab/labels';
import { evolvedGenomes, ctxGenomes, evolvedLabel } from './genomes';
import { EnergyHistory } from '../lab/EnergyHistory';
import { semanticPreset } from '../../packages/evo/semantic';
import { kindStyle } from './kinds';
import { AdaptPanel } from './AdaptPanel';

const PRESETS: Record<string, object> = {
  ecology: {},
  l1: { width: 16, height: 12, initialAgents: 8, reproduction: false, mutation: false, maxAge: 100000, horizon: 3600, phaseTicks: 1200, initialEnergy: 32, metabolism: .012, initialFood: 100, supplyAmount: 6, foodDecay: .003, diffusion: .002 },
};
const BRAINS: [string, string][] = [['rule', '规则大脑'], ['random', '随机合法策略'], ['laya', '固定 Laya · 当前观测'], ['laya-memory', '固定 Laya · 有限记忆'], ['learning', 'Laya + 个体学习'], ['no-laya', '独立小网络 · 无 Laya'], ['frozen', 'Laya + 小网络 · 暂停学习'], ['no-laya-frozen', '独立小网络 · 暂停学习'], ['rule-fallback', '规则降级']];

export default function Studio() {
  const { view, tape, compareTape, error, setError, notice, setNotice, saved, checkpointId, send, seek, serial, openSaved, importFile, importLearning } = useStudio();
  const stage = useRef<StageHandle>(null), card = useRef<HTMLElement>(null), root = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState<string | null>(null), [following, setFollowing] = useState(false), [tool, setTool] = useState<Tool>('observe');
  const [resources, setResources] = useState(true), [trails, setTrails] = useState(false), [reduceMotion, setReduceMotion] = useState(false), [fitKey, setFitKey] = useState(0);
  const [palette, setPalette] = useState(false), [drawer, setDrawer] = useState(false), [frame, setFrame] = useState({ ms: 0, zoom: 1 });
  const [seed, setSeed] = useState('1'), [preset, setPreset] = useState('ecology'), [savedId, setSavedId] = useState(''), [branchChoice, setBranchChoice] = useState('random');

  const [narrow, setNarrow] = useState(() => matchMedia('(max-width:700px)').matches);
  useEffect(() => { const m = matchMedia('(max-width:700px)'), f = () => setNarrow(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(v => !v); }
      else if (e.key === 'Escape') { setPalette(false); setDrawer(false); }
    };
    addEventListener('keydown', h); return () => removeEventListener('keydown', h);
  }, []);

  const reseed = () => {
    const n = Number(seed); if (!Number.isInteger(n) || n < 1 || n > 0xffffffff) { setError('种子须为 1–4294967295 的整数'); return; }
    send('reset', { config: { ...(preset === 'semantic' ? semanticPreset(n) : preset === 'aba-cue' || preset === 'aba-off' ? semanticPreset(n, { drift: { everyTicks: 1200, fraction: 1, pattern: 'aba', cue: preset === 'aba-cue' ? 'true' : 'off' } }) : PRESETS[preset]), seed: n, runId: `interactive-${n}-${serial.current}` } }); setSelected(null); setFitKey(k => k + 1);
  };
  const commands: Command[] = useMemo(() => [
    { id: 'reseed', label: '重新播种', hint: `按“实验”抽屉中的种子与场景`, run: reseed },
    { id: 'drawer', label: '打开实验抽屉', hint: '种子、场景、大脑、保存与导入', run: () => setDrawer(true) },
    { id: 'fit', label: '适配视野', hint: '全景', run: () => { stage.current?.fit(); setFollowing(false); } },
    { id: 'resources', label: resources ? '隐藏营养图层' : '显示营养图层', run: () => setResources(v => !v) },
    { id: 'trails', label: trails ? '隐藏轨迹' : '显示轨迹', hint: '仅显示本页面看到的位置', run: () => setTrails(v => !v) },
    { id: 'motion', label: reduceMotion ? '恢复装饰动效' : '减少装饰动效', run: () => setReduceMotion(v => !v) },
    { id: 'export', label: '导出动作回放', hint: '不含可继续训练的学习状态', run: () => send('export', { value: 'download' }) },
    { id: 'save', label: '保存到本机', run: () => send('export', { value: 'save' }) },
    ...(view?.snapshot.agents ?? []).map(a => ({ id: `life-${a.id}`, label: `选择 ${a.id}`, hint: `${shapes[a.shape]} · G${a.generation}`, run: () => setSelected(a.id) })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [view?.snapshot, resources, trails, reduceMotion, seed, preset]);

  /** 故事卡跟随选中个体：直接写样式，避免每帧触发 React 渲染。 */
  const anchor = (x: number, y: number, r: number, visible: boolean) => {
    const el = card.current, host = root.current; if (!el || !host) return;
    if (!visible) { el.style.visibility = 'hidden'; return; }
    const W = host.clientWidth, H = host.clientHeight, w = el.offsetWidth, h = el.offsetHeight;
    let left = x + r + 26; if (left + w > W - 16) left = x - r - 26 - w; left = Math.max(12, Math.min(left, W - w - 12));
    const top = Math.max(64, Math.min(y - h / 3, H - 190 - h));
    el.style.visibility = 'visible'; el.style.transform = `translate(${left}px,${top}px)`;
  };
  if (!view) return <main className="studio-loading">正在创建真实世界…{error && <p role="alert">{error}</p>}</main>;
  const s = view.snapshot, c = s.config, info = modeInfo(view), replay = view.replay, scrubbing = !!replay?.live;
  const total = replay ? replay.total : tape.length, playhead = replay ? replay.index : tape.length;
  const initialTick = tape.length ? (tape[0].kind === 'round' ? tape[0].tick - c.decisionTicks : tape[0].tick) : s.tick;
  const branchLabel = (id: string) => { const i = view.branches.findIndex(b => b.runId === id); return i < 0 ? id : (view.branches[i].source ? `分支 ${i}` : '原世界'); };
  const compare = view.compare ?? null, compareLabel = compare ? branchLabel(compare.runId) : '';
  const initialLiving = tape.length ? tape[0].living - tape[0].births + tape[0].deaths : s.agents.length;
  const finished = replay ? replay.index >= replay.total : s.tick >= c.horizon || !s.agents.length;
  const play = () => {
    if (scrubbing && replay!.index >= replay!.total) { send('live'); send('play'); return; }
    send(view.paused ? 'play' : 'pause');
  };
  const agent = s.agents.find(a => a.id === selected), decision = selected ? view.lastDecisions.find(d => d.request.identity.agentId === selected) : undefined;
  const died = !agent && selected ? s.events.filter(e => e.kind === 'died' && e.agentId === selected).at(-1) : undefined;
  const place = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= c.width || y >= c.height) return;
    send('intervene', { command: tool === 'nutrient' ? { kind: 'nutrient', x: Math.floor(x), y: Math.floor(y), amount: 12 } : { kind: 'obstacle', x: Math.floor(x), y: Math.floor(y), blocked: tool === 'obstacle' } });
  };
  const insets = narrow ? { top: 108, bottom: 214 + (selected ? Math.round(innerHeight * .34) : 0), left: 12, right: 12 } : { top: 64, bottom: 176, left: 24, right: 24 };

  return <main className="studio" data-tone={info.tone} ref={root}>
    <Stage ref={stage} snapshot={s} selected={selected} following={following} resources={resources} trails={trails} reduceMotion={reduceMotion} tool={tool} insets={insets} fitKey={fitKey} animate={!view.paused && !replay} ghosts={compare && compare.tick !== null ? compare.agents : null}
      decision={decision ? { agentId: decision.request.identity.agentId, chosen: decision.proposal.action, distribution: decision.proposal.distribution } : null}
      onAnchor={anchor} onSelect={setSelected} onPlace={place} onUserCamera={() => setFollowing(false)} onFrame={(ms, zoom) => setFrame({ ms, zoom })}/>

    <header className="hud-top">
      <span className="brand">LFE · 观察台</span>
      <div className={`badge tone-${info.tone}`} role="status"><span aria-hidden="true">{info.symbol}</span><div><strong>{info.title}</strong><small>{info.note}</small></div></div>
      <div className="hud-right"><button onClick={() => setPalette(true)} aria-label="打开命令面板">命令 <kbd>⌘K</kbd></button><button onClick={() => setDrawer(v => !v)} aria-expanded={drawer}>实验</button></div>
    </header>

    {compare && <div className="compare-chip" role="status">对照：{compareLabel}（紫色虚线 / 空心幽灵）{compare.tick === null ? <><br/>对照世界在此时刻没有记录；只在记录边界且时间相同时才可比较。</> : <><br/>同在 {(compare.tick / c.ticksPerSecond).toFixed(1)} 秒；连线表示同一生命的位置差异。</>}</div>}
    {(notice || error) && <div className={`toast ${error ? 'bad' : ''}`} role={error ? 'alert' : 'status'}><span>{error ? (error === 'occupied_obstacle' ? '这里有生命，不能放置障碍。' : error) : notice}</span><button onClick={() => { setError(''); setNotice(''); }} aria-label="关闭提示">×</button></div>}
    {view.runtime.failed > 0 && !replay && <div className="toast bad"><span>已保留 {view.runtime.ready} 个结果，{view.runtime.failed} 个请求失败。</span><button onClick={() => send('retry')}>重试</button><button onClick={() => send('mode', { value: 'rule-fallback' })}>明确切换规则降级</button></div>}
    {!s.agents.length && !replay && <div className="extinction">这个世界已经安静下来<small>灭绝保留为真实结果，可以重新播种。</small></div>}

    {s.config.semantic && <aside className="legend" aria-label="食物种类图例（观察者）"><strong>食物种类</strong><small>形状与颜色是任意分配的；「真实影响」只有观察者看得到，个体只看得到描述。</small>
      <ul>{s.config.semantic.kinds.map((k, i) => { const st = kindStyle(i); return <li key={k.description}><i className={`k-${st.shape}`} style={{ background: st.css, color: st.css }}/><span>{k.description}</span><b className={k.factor > 0 ? 'pos' : k.factor < 0 ? 'neg' : ''}>{k.factor > 0 ? '+' : ''}{k.factor}</b></li>; })}</ul></aside>}
    <AdaptPanel view={view}/>
    <nav className="dock" aria-label="环境工具">
      {([['observe', '观察'], ['nutrient', '营养'], ['obstacle', '障碍'], ['erase', '擦除']] as const).map(([id, name]) => <button key={id} aria-pressed={tool === id} disabled={!!replay && id !== 'observe'} onClick={() => setTool(id)}>{name}</button>)}
      <span className="dock-sep"/>
      <button aria-label="缩小" onClick={() => stage.current?.zoomBy(1 / 1.25)}>−</button><span className="zoom">{Math.round(frame.zoom * 100)}%</span><button aria-label="放大" onClick={() => stage.current?.zoomBy(1.25)}>＋</button>
      <button onClick={() => { stage.current?.fit(); setFollowing(false); }}>全景</button>
    </nav>

    {agent && <StoryCard ref={card} view={view} agent={agent} decision={decision} following={following} onFollow={() => setFollowing(v => !v)} onClose={() => setSelected(null)}/>}
    {died && <aside className="focus-chip" aria-label="已死亡个体"><strong>{selected}</strong><span>在 {(died.tick / c.ticksPerSecond).toFixed(1)} 秒死亡{died.reason === 'age' ? '（寿命耗尽）' : died.reason === 'starvation' ? '（能量耗尽）' : ''}</span><button onClick={() => setSelected(null)} aria-label="取消选择">×</button></aside>}

    <section className="hud-bottom">
      <div className="transport">
        <button className="primary" onClick={play} disabled={finished && !scrubbing} aria-label={view.paused ? '播放' : '暂停'}>{view.paused ? '▶ 播放' : '❚❚ 暂停'}</button>
        <button onClick={() => send('step')} disabled={finished && !scrubbing} title="执行一轮决策，推进 10 个模拟步">单轮</button>
        <div className="speed" role="group" aria-label="模拟速度">{[1, 4, 16].map(v => <button key={v} aria-pressed={view.speed === v} onClick={() => send('speed', { value: v })}>{v}×</button>)}</div>
        {scrubbing && <button className="live-btn" onClick={() => send('live')}>回到现在</button>}
        <span className="status" role="status">{view.status}</span>
        <div className="clock"><strong>{(s.tick / c.ticksPerSecond).toFixed(1)}</strong><span> 模拟秒 · {s.agents.length} 个生命</span></div>
      </div>
      <Tape marks={tape} initialTick={initialTick} compare={{ runId: compareTape.runId, label: compareTape.runId ? branchLabel(compareTape.runId) : '', marks: compareTape.marks, initialTick: compareTape.initialTick, initialLiving: compareTape.initialLiving }} initialLiving={initialLiving} ticksPerSecond={c.ticksPerSecond} playhead={playhead} total={total} scrubbing={scrubbing} onSeek={seek} onLive={() => send('live')}/>
    </section>

    {drawer && <aside className="drawer" aria-label="实验">
      <div className="drawer-head"><h2>实验</h2><button onClick={() => setDrawer(false)} aria-label="关闭实验抽屉">×</button></div>
      <h3>新世界</h3>
      <label>场景<select aria-label="播种场景" value={preset} onChange={e => setPreset(e.target.value)}><option value="ecology">繁殖生态</option><option value="l1">L1 资源变化 · 固定初始队列</option><option value="semantic">语义食物（实验性 · 新描述词）</option><option value="aba-cue">语义食物 · A/B/A 反转（环境线索开）</option><option value="aba-off">语义食物 · A/B/A 反转（无线索）</option></select></label>
      <label>种子<input aria-label="世界种子" value={seed} onChange={e => setSeed(e.target.value)} inputMode="numeric"/></label>
      <button onClick={reseed}>重新播种</button>
      <h3>大脑</h3>
      <label><select aria-label="大脑模式" disabled={!!replay} value={view.mode} onChange={e => send('mode', { value: e.target.value })}>{BRAINS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}{[...Object.keys(evolvedGenomes), ...Object.keys(ctxGenomes)].map(n => <option key={n} value={`evolved:${n}`}>{evolvedLabel(n)}</option>)}{replay && <option value="replay">录制回放</option>}</select></label>
      <h3>同起点对照</h3>
      {['learning', 'no-laya', 'frozen', 'no-laya-frozen'].includes(view.mode)
        ? <button disabled={!!view.runtime.learningTransaction || view.mode.endsWith('frozen') || !!replay} onClick={() => send('branch', { value: { kind: 'controller', mode: view.mode === 'no-laya' ? 'no-laya-frozen' : 'frozen' } })}>创建暂停学习的分支</button>
        : <div className="row"><select aria-label="分支唯一改变量" value={branchChoice} onChange={e => setBranchChoice(e.target.value)}><option value="random">改为随机策略</option><option value="rule">改为规则大脑</option><option value="laya-memory">改为固定 Laya + 记忆</option><option value="half-food">营养供给减半</option></select>
            <button disabled={!!replay || view.runtime.pending} onClick={() => send('branch', { value: branchChoice === 'half-food' ? { kind: 'environment', parameter: 'supplyAmount', value: c.supplyAmount / 2 } : { kind: 'controller', mode: branchChoice } })}>创建对照分支</button></div>}
      {view.branches.length > 1 ? <div className="branches" role="list" aria-label="分支">{view.branches.map((b, i) => <div className={`branch ${b.active ? 'on' : ''}`} role="listitem" key={b.runId}>
        <span>{b.source ? `分支 ${i}` : '原世界'}{b.active ? ' · 当前' : ''}<small>{modes[b.mode] ?? b.mode} · {(b.tick / b.ticksPerSecond).toFixed(1)} 秒 · 存活 {b.living}{b.source ? ` · 自 ${(b.source.sourceTick / b.ticksPerSecond).toFixed(1)} 秒分叉` : ''}</small></span>
        {b.active ? <button aria-pressed={!compare} onClick={() => send('compare', { value: null })}>不对照</button> : <span className="row"><button aria-pressed={compare?.runId === b.runId} onClick={() => send('compare', { value: b.runId })}>对照</button><button onClick={() => send('switch-branch', { value: b.runId })}>切换</button></span>}</div>)}</div>
        : <small>创建分支后，可在此与原世界对照：带子上叠加存活曲线，画布上显示同一时刻的幽灵。</small>}
      {view.branches.length > 1 && <button onClick={() => send('comparison')}>导出比较</button>}
      <h3>保存与回放</h3>
      <div className="row"><button disabled={view.runtime.pending || view.runtime.ready > 0 || view.runtime.failed > 0} onClick={() => send('export', { value: 'save' })}>保存到本机</button><button onClick={() => send('export', { value: 'download' })}>导出记录</button></div>
      <label className="file">导入记录<input aria-label="导入回放文件" type="file" accept=".json,application/json" onChange={e => { importFile(e.target.files?.[0]); e.target.value = ''; }}/></label>
      <div className="row"><select aria-label="本机保存的世界" value={savedId} onChange={e => setSavedId(e.target.value)}><option value="">选择保存记录</option>{saved.map(r => <option key={r.id} value={r.id}>{r.name} · {modes[r.mode]}</option>)}</select></div>
      <div className="row"><button disabled={!savedId} onClick={() => openSaved(savedId, false)}>打开回放</button><button disabled={!savedId} onClick={() => openSaved(savedId, true)}>校验回放</button></div>
      <h3>学习与完整恢复</h3>
      <small>{view.learning ? `${replay ? '录制反馈到' : '已确认到'}模拟步 ${view.learning.tick}。参数更新不等于行为已经改善。` : '尚无已确认的个体学习反馈。'} 完整检查点含世界、独立参数、优化器、经历与随机状态；恢复时创建新世界。</small>
      <div className="row"><button disabled={!view.learning || !!view.runtime.learningTransaction || !!replay} onClick={() => send('learning-checkpoint')}>保存完整学习状态</button><button disabled={!checkpointId} onClick={() => send('learning-restore', { value: checkpointId })}>恢复最近学习状态</button></div>
      {checkpointId && <a href={`/api/learning/checkpoint/${checkpointId}`} download>下载完整检查点</a>}
      <label className="file">导入学习检查点<input aria-label="导入完整学习检查点" type="file" accept=".pt" onChange={e => { importLearning(e.target.files?.[0]); e.target.value = ''; }}/></label>
      {!!view.runtime.learningTransaction && !view.runtime.learningCommitPending && <div className="row"><small>本轮学习尚未提交，取消后可修改世界。</small><button onClick={() => send('cancel-learning')}>取消本轮学习</button></div>}
      <h3>能量与资源变化 · 最近 {view.history.length} 轮</h3>
      <div className="energy-history-box"><EnergyHistory history={view.history} snapshot={s} selected={selected}/></div>
      <h3>谱系</h3>
      <p className="mono">共 {s.lineage.length} 个体，最高 G{Math.max(...s.lineage.map(l => l.generation), 0)}；出生 {s.metrics.births} · 死亡 {s.metrics.deaths}{selected ? <><br/>父代 {s.lineage.find(l => l.id === selected)?.parentId ?? '无'} → {selected} → 后代 {s.lineage.filter(l => l.parentId === selected).map(l => `${l.id}${l.died === null ? '' : '（已死亡）'}`).join('、') || '无'}</> : null}</p>
      <h3>运行证据</h3>
      <p className="mono">模拟版本 {s.version} · 步 {s.tick}<br/>状态 {view.hash}<br/>最近一轮 {view.roundMs.toFixed(1)} ms · 实际 {view.actualRate.toFixed(2)} 模拟秒/秒<br/>画布绘制 CPU {frame.ms ? `${frame.ms.toFixed(2)} ms` : '—'}（不含 GPU）<br/>记录 {view.runtime.entries} / {view.runtime.capacity} 条{checkpointId ? <><br/>最近学习检查点 {checkpointId.slice(0, 12)}…</> : null}</p>
      {selected && <><h3>选中个体的原始证据</h3>{decision
        ? <details><summary>{selected} 最近一次已执行决策：观测、提案、反馈{decision.model ? '、固定 Laya 原始输入输出' : ''}</summary><pre className="raw">{JSON.stringify(decision, null, 2)}</pre></details>
        : <small>{selected} 尚无已执行的决策记录。</small>}</>}
      <label className="check"><input type="checkbox" checked={reduceMotion} onChange={e => setReduceMotion(e.target.checked)}/>减少装饰动效</label>
      <a href="/lab.html">打开旧版观察室</a>
    </aside>}

    <Palette open={palette} commands={commands} onClose={() => setPalette(false)}/>
  </main>;
}
