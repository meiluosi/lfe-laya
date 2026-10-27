import type { View } from '../lab/labels';

const W = 300, H = 92, TOP = 18, BASE = H - 16;
const pct = (x: number | null) => x === null ? '—' : `${Math.round(x * 100)}%`;
/** 适应与保留：每个 200 tick 窗口里“吃到营养的食物占比”。阶段与环境状态来自世界配置（观察者信息；个体只在线索开启时看到一句话）。 */
export function AdaptPanel({ view }: { view: View }) {
  const c = view.snapshot.config, d = c.semantic?.drift; if (!d || !d.schedule || !d.states) return null;
  const { windowTicks: wt, good, bad } = view.adapt, nWin = Math.ceil(c.horizon / wt), per = Math.round(d.everyTicks / wt), phases = Math.ceil(c.horizon / d.everyTicks);
  const stateOf = (p: number) => d.schedule![Math.min(p, d.schedule!.length - 1)], name = (s: number) => String.fromCharCode(65 + s);
  const share = (i: number) => { const t = (good[i] ?? 0) + (bad[i] ?? 0); return i < good.length && t > 0 ? good[i] / t : null; };
  const early = (p: number) => { const a = p * per, b = Math.min(a + 2, good.length); let g = 0, t = 0; for (let i = a; i < b; i++) { g += good[i]; t += good[i] + bad[i]; } return b - a < 2 || !t ? null : g / t; };
  const firstA = early(0), lastP = phases - 1, back = lastP > 0 && stateOf(lastP) === stateOf(0) ? early(lastP) : null;
  const bw = W / nWin, y = (v: number) => BASE - v * (BASE - TOP);
  const bands = Array.from({ length: phases }, (_, p) => ({ p, s: stateOf(p), x: p * per * bw, w: Math.min(per, nWin - p * per) * bw }));
  return <aside className="adapt" aria-label="适应与保留" data-testid="adapt-panel">
    <strong>适应与保留</strong>
    <small>每 {wt} 步窗口内，吃到营养食物占全部进食的比例。环境状态是观察者信息。</small>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="各窗口营养食物占比，按环境阶段分段">
      {bands.map(b => <g key={b.p}><rect className={`band s${b.s}`} x={b.x} y={TOP - 4} width={b.w} height={BASE - TOP + 4}/>
        <text className="band-label" x={b.x + 3} y={TOP - 6}>{name(b.s)}</text>{b.p > 0 && <line className="rev" x1={b.x} x2={b.x} y1={2} y2={BASE}/>}</g>)}
      {firstA !== null && <line className="ref" x1={0} x2={W} y1={y(firstA)} y2={y(firstA)}/>}
      {Array.from({ length: nWin }, (_, i) => { const v = share(i); return v === null ? null : <rect key={i} className="win" x={i * bw + 1} width={Math.max(1, bw - 2)} y={y(v)} height={BASE - y(v)}/>; })}
      <line className="axis" x1={0} x2={W} y1={BASE} y2={BASE}/>
    </svg>
    <p className="mono">首个 {name(stateOf(0))} 早期 {pct(firstA)}{back !== null && <> · 回到 {name(stateOf(0))} 早期 {pct(back)} · 节省 <b className={back - (firstA ?? 0) >= 0 ? 'pos' : 'neg'} data-testid="adapt-savings">{firstA === null ? '—' : `${back - firstA >= 0 ? '+' : ''}${Math.round((back - firstA) * 100)} 点`}</b></>}</p>
    <small>早期 = 每段前两个窗口。节省为正 = 旧环境回来时比第一次更快进入状态。一个世界只有一次抽样，不是评估结论{d.cue ? `；线索：${d.cue.mode === 'true' ? '真实' : d.cue.mode === 'random' ? '随机' : '关闭'}` : ''}。</small>
  </aside>;
}
