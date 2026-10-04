// 选中个体的“故事卡”：现在 / 看到什么 / 倾向什么 / 经历 / 学习。
// 所有内容来自快照与已执行决策的记录；规则或随机策略没有概率时明确说明，不编造理由。
import { forwardRef } from 'react';
import { ACTIONS, type Action } from '../../packages/protocol/ecology.ts';
import type { Snapshot } from '../../packages/sim/ecology.ts';
import { LearningEvidence } from '../lab/LearningEvidence';
import { actionLabels, eventLabels, shapes, type View } from '../lab/labels';

type Decision = View['lastDecisions'][number];
type Props = { view: View; agent: Snapshot['agents'][number]; decision: Decision | undefined; onClose: () => void; following: boolean; onFollow: () => void };
const dirName = (dx: number, dy: number) => { const v = Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? '南' : '北') : (dx > 0 ? '东' : '西'); return v; };

/** 把决策时的局部观测概括成一句话：只描述该个体当时真实可见的内容。 */
function seen(decision: Decision): string[] {
  const o = decision.request.observation, food = o.local.filter(c => !c.blocked && c.food >= .05), walls = o.local.filter(c => c.blocked).length;
  const nearest = food.map(c => ({ c, d: Math.hypot(c.dx, c.dy) })).sort((a, b) => a.d - b.d)[0];
  const lines = [nearest ? `视野内 ${food.length} 格有食物，最近的在${nearest.d < .5 ? '脚下' : `${dirName(nearest.c.dx, nearest.c.dy)}侧 ${nearest.d.toFixed(1)}`}（${nearest.c.food.toFixed(1)}${nearest.c.desc ? ` · 「${nearest.c.desc}」` : ''}）` : '视野内没有可见的食物'];
  if (o.memory.length) lines.push(`记得 ${o.memory.length} 处曾有食物的地点`);
  if (o.neighbors.length) lines.push(`附近有 ${o.neighbors.length} 个其他生命`);
  if (walls) lines.push(`视野内有 ${walls} 格障碍`);
  return lines;
}

export const StoryCard = forwardRef<HTMLElement, Props>(function StoryCard({ view, agent, decision, onClose, following, onFollow }, ref) {
  const s = view.snapshot, c = s.config, capacity = c.capacity * agent.traits.size;
  const events = s.events.filter(e => e.agentId === agent.id || e.targetId === agent.id).slice(-4).reverse();
  const updates = view.runtime.learningUpdates.filter(u => u.agentId === agent.id);
  const legal = decision ? new Set(decision.request.candidates.map(x => x.id)) : null;
  const dist = decision?.proposal.distribution, prior = decision?.model?.proposal.distribution;
  const rows = decision && dist ? ACTIONS.filter(a => legal!.has(a)).map(a => ({ a, p: dist[a] ?? 0, q: prior?.[a] })) : [];
  const out = decision?.outcome;
  return <aside className="story" ref={ref} aria-label={`${agent.id} 的故事卡`}>
    <header><div><strong>{agent.id}</strong><small>{shapes[agent.shape]} · G{agent.generation}{agent.parentId ? ` · 父代 ${agent.parentId}` : ' · 初始生命'}</small></div>
      <div className="story-actions"><button aria-pressed={following} onClick={onFollow}>{following ? '停止跟随' : '跟随'}</button><button onClick={onClose} aria-label="取消选择">×</button></div></header>
    <div className="energy"><span>能量</span><meter min={0} max={capacity} value={agent.energy} aria-label="个体能量"/><b>{agent.energy.toFixed(1)}<small> / {capacity.toFixed(1)}</small></b></div>

    <section><h4>刚才</h4>
      {out ? <p><strong>{actionLabels[out.action]}</strong> · {out.rejected ? '受阻，未能执行' : '已执行'} · 能量 {out.energyBefore.toFixed(2)} → {out.energyAfter.toFixed(2)}</p>
           : <p className="dim">尚无该个体已执行的决策。当前动作：{actionLabels[agent.lastAction]}。</p>}</section>

    {decision && <section><h4>它看到的</h4><ul>{seen(decision).map(t => <li key={t}>{t}</li>)}</ul></section>}

    {decision && <section><h4>它的倾向</h4>
      {rows.length ? <div className="bars" role="table" aria-label="动作倾向">{rows.map(r => <div className={`bar ${decision.proposal.action === r.a ? 'chosen' : ''}`} key={r.a} role="row">
        <span>{actionLabels[r.a as Action]}</span><div className="track"><i style={{ width: `${Math.max(1, r.p * 100)}%` }}/>{r.q !== undefined && <u style={{ left: `${r.q * 100}%` }} title={`Laya 原始偏好 ${(r.q * 100).toFixed(1)}%`}/>}</div><em>{(r.p * 100).toFixed(1)}%</em></div>)}</div>
        : <p className="dim">{decision.proposal.provider} 不产生概率分布；只记录实际选择：{actionLabels[decision.proposal.action]}。</p>}
      {rows.length > 0 && <small>条形：最终策略；竖线：固定 Laya 原始偏好（有则显示）。实线框为实际选择。</small>}
    </section>}

    <section><h4>经历</h4>{events.length ? <ul className="events">{events.map(e => <li key={e.seq}><time>{(e.tick / c.ticksPerSecond).toFixed(1)}s</time><span>{eventLabels[e.kind] ?? e.kind}{e.reason === 'age' ? ' · 寿命耗尽' : e.reason === 'starvation' ? ' · 能量耗尽' : ''}{e.amount !== undefined ? ` ${e.amount.toFixed(2)}` : ''}</span></li>)}</ul> : <p className="dim">暂无记录的事件。</p>}</section>

    {(updates.length > 0 || view.learning) && <section><h4>学习{view.learning?.revisions[agent.id] !== undefined ? ` · 策略 v${view.learning.revisions[agent.id]}` : ''}</h4>
      {updates.length ? updates.map(u => <LearningEvidence key={`${u.agentId}:${u.revision}`} update={u} replay={!!view.replay}/>) : <p className="dim">该个体尚无已确认的参数更新。</p>}
      <small>参数更新不等于行为变好；同一观测下概率变化也不等于生存改善。</small></section>}
  </aside>;
});
