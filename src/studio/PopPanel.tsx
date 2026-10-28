import type { View } from '../lab/labels';

export const TYPE_COLORS = [0xf0b35a, 0x8fd0ff], TYPE_CSS = ['#f0b35a', '#8fd0ff'];
const W = 300, H = 96, TOP = 8, BASE = H - 16;
/** 种群曲线：各先天类型的在世个体数。类型由谱系决定（观察者信息），孩子继承父母的类型；后天信念不遗传。 */
export function PopPanel({ view }: { view: View }) {
  const t = view.innate; if (!t) return null;
  const { ticks, counts, labels } = t, horizon = view.snapshot.config.horizon, max = Math.max(8, ...counts.map(c => c.reduce((a, b) => a + b, 0)));
  const x = (k: number) => (k / horizon) * W, y = (v: number) => BASE - (v / max) * (BASE - TOP);
  const living = labels.map((_, i) => Object.values(t.of).filter(v => v === i).length);
  return <aside className="pop" aria-label="先天类型与种群曲线" data-testid="pop-panel">
    <strong>先天类型 · 种群曲线</strong>
    <small>色环 = 先天类型（由谱系决定，孩子继承父母；后天信念不遗传）。繁殖为固定本能。</small>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="各先天类型在世个体数随时间变化">
      {labels.map((_, i) => ticks.length > 0 && <polyline key={i} className="popline" style={{ stroke: TYPE_CSS[i] }} fill="none" points={ticks.map((k, j) => `${x(k).toFixed(1)},${y(counts[j][i]).toFixed(1)}`).join(' ')}/>)}
      <line className="axis" x1={0} x2={W} y1={BASE} y2={BASE}/>
      <text className="band-label" x={2} y={TOP + 6}>{max}</text>
    </svg>
    <ul>{labels.map((l, i) => <li key={l}><i style={{ borderColor: TYPE_CSS[i] }}/><span>{l}</span><b data-testid={`pop-count-${i}`}>{living[i]}</b></li>)}</ul>
  </aside>;
}
