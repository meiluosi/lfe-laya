import { useEffect, useRef, useState } from 'react';
import type { TapeMark } from '../../packages/sim/session.ts';

export type CompareTape = { runId: string | null; label: string; marks: TapeMark[]; initialTick: number; initialLiving: number };
type Props = {
  marks: TapeMark[]; initialTick: number; initialLiving: number; ticksPerSecond: number; playhead: number; total: number; scrubbing: boolean;
  compare?: CompareTape; onSeek: (index: number) => void; onLive: () => void;
};
const HEIGHT = 84, TOP = 16, BASE = HEIGHT - 8;

/** 底部“带子”：横轴是模拟时间（不是记录条数），所以不同分支可以直接对齐。曲线与刻度都来自记录索引。 */
export function Tape({ marks, initialTick, initialLiving, ticksPerSecond, playhead, total, scrubbing, compare, onSeek, onLive }: Props) {
  const box = useRef<HTMLDivElement>(null), [width, setWidth] = useState(600), [hover, setHover] = useState<number | null>(null), dragging = useRef(false);
  useEffect(() => { const el = box.current!, ro = new ResizeObserver(() => setWidth(el.clientWidth)); ro.observe(el); setWidth(el.clientWidth); return () => ro.disconnect(); }, []);
  const tickAt = (i: number) => i <= 0 ? initialTick : marks[Math.min(i, marks.length) - 1]?.tick ?? initialTick;
  const t0 = initialTick, tEnd = Math.max(tickAt(total), compare?.runId ? (compare.marks.at(-1)?.tick ?? 0) : 0, t0 + 1);
  const x = (t: number) => ((t - t0) / (tEnd - t0)) * width;
  const peak = Math.max(1, initialLiving, ...marks.map(m => m.living), ...(compare?.runId ? compare.marks.map(m => m.living) : []));
  const y = (living: number) => BASE - (living / peak) * (BASE - TOP - 14);
  const curve = (start: number, startLiving: number, list: TapeMark[], close: boolean) => {
    let d = `M${x(start)},${close ? BASE : y(startLiving)}${close ? ` L${x(start)},${y(startLiving)}` : ''}`, last = startLiving;
    for (const m of list) { if (m.tick < t0) { last = m.living; continue; } d += ` L${x(m.tick)},${y(last)} L${x(m.tick)},${y(m.living)}`; last = m.living; }
    const end = list.length ? list[list.length - 1].tick : start; d += ` L${x(Math.max(end, start))},${y(last)}`;
    return close ? d + ` L${x(Math.max(end, start))},${BASE} Z` : d;
  };
  const tri = (cx: number, up: boolean) => up ? `M${cx - 3},${BASE - 1}l3,-6l3,6z` : `M${cx - 3},${TOP + 2}l3,6l3,-6z`;
  let births = '', deaths = '', acts = '';
  for (const m of marks) { const cx = x(m.tick); if (m.births) births += tri(cx, true); if (m.deaths) deaths += tri(cx, false); if (m.kind === 'intervention') acts += `M${cx},${TOP - 7}l3.5,3.5l-3.5,3.5l-3.5,-3.5z`; }
  /** 像素位置 → 记录位置：取模拟时间不小于目标的第一个边界。 */
  const indexAt = (clientX: number) => {
    const b = box.current!.getBoundingClientRect(), tick = t0 + Math.max(0, Math.min(1, (clientX - b.left) / b.width)) * (tEnd - t0);
    let lo = 0, hi = total; while (lo < hi) { const mid = (lo + hi) >> 1; if (tickAt(mid) >= tick) hi = mid; else lo = mid + 1; }
    return lo;
  };
  const describe = (i: number) => {
    const m = marks[i - 1], parts = [`${(tickAt(i) / ticksPerSecond).toFixed(1)} 秒`]; if (!m) return parts[0] + ' · 起点';
    if (m.births) parts.push(`出生 ${m.births}`); if (m.deaths) parts.push(`死亡 ${m.deaths}`); if (m.intervention) parts.push(m.intervention === 'nutrient' ? '投放营养' : '改变障碍');
    const cmp = compare?.runId ? compare.marks.filter(c => c.tick <= m.tick).at(-1) : undefined; if (cmp) parts.push(`${compare!.label} 存活 ${cmp.living} / 当前 ${m.living}`);
    return parts.join(' · ');
  };
  const down = (e: React.PointerEvent) => { dragging.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); onSeek(indexAt(e.clientX)); };
  const move = (e: React.PointerEvent) => { const i = indexAt(e.clientX); setHover(i); if (dragging.current) onSeek(i); };
  const up = (e: React.PointerEvent) => { if (!dragging.current) return; dragging.current = false; if (indexAt(e.clientX) >= total && scrubbing) onLive(); };
  const key = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') onSeek(Math.max(0, playhead - step)); else if (e.key === 'ArrowRight') onSeek(Math.min(total, playhead + step));
    else if (e.key === 'Home') onSeek(0); else if (e.key === 'End') { if (scrubbing) onLive(); } else return;
    e.preventDefault();
  };
  const sec = (t: number) => (t / ticksPerSecond);
  const ruler = Math.max(1, Math.round(sec(tEnd - t0) / 6));
  const rulerMarks: number[] = []; for (let s = Math.ceil(sec(t0) / ruler) * ruler; s * ticksPerSecond <= tEnd; s += ruler) rulerMarks.push(s);
  return <div className="tape" ref={box}>
    <div className="tape-track" role="slider" tabIndex={0} aria-label="时间带子" aria-valuemin={0} aria-valuemax={total} aria-valuenow={playhead} aria-valuetext={describe(playhead)}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => setHover(null)} onKeyDown={key}>
      <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} aria-hidden="true">
        {rulerMarks.map(s => <g key={s}><line x1={x(s * ticksPerSecond)} x2={x(s * ticksPerSecond)} y1={BASE} y2={BASE + 3} className="tape-base"/><text x={x(s * ticksPerSecond) + 2} y={TOP - 5} className="tape-label">{s}s</text></g>)}
        <path d={curve(t0, initialLiving, marks, true)} className="tape-area"/>
        {compare?.runId && <path d={curve(compare.initialTick, compare.initialLiving, compare.marks, false)} className="tape-compare"/>}
        <line x1="0" x2={width} y1={BASE} y2={BASE} className="tape-base"/>
        <path d={births} className="tape-birth"/><path d={deaths} className="tape-death"/><path d={acts} className="tape-act"/>
        {hover !== null && <line x1={x(tickAt(hover))} x2={x(tickAt(hover))} y1={TOP - 8} y2={BASE} className="tape-hover"/>}
        <line x1={x(tickAt(playhead))} x2={x(tickAt(playhead))} y1={TOP - 10} y2={BASE} className="tape-head"/>
        <circle cx={x(tickAt(playhead))} cy={TOP - 10} r="4" className="tape-knob"/>
      </svg>
    </div>
    <div className="tape-legend" aria-hidden="true"><span>▲ 出生</span><span>▼ 死亡</span><span>◆ 干预</span>{compare?.runId && <span className="tape-cmp-key">┄ {compare.label}（对照）</span>}<span className="tape-readout">{describe(hover ?? playhead)}</span></div>
  </div>;
}
