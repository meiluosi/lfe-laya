import type { Snapshot } from '../../packages/sim/ecology';
import type { HistoryPoint } from './history';

export function EnergyHistory({history, snapshot, selected}: {history: HistoryPoint[]; snapshot: Snapshot; selected: string|null}) {
  if (history.length < 2) return <p>至少推进两轮后显示能量历史。</p>;
  const config=snapshot.config, start=history[0].tick, end=history.at(-1)!.tick;
  const ancestry=snapshot.lineage.find(a=>a.id===selected);
  const individual=ancestry ? history.filter(p=>p.tick>=ancestry.born).map(p=>({tick:p.tick,energy:p.energyById[ancestry.id]??0})) : [];
  const max=Math.max(config.capacity,...history.map(p=>p.cohortEnergy),...individual.map(p=>p.energy));
  const x=(tick:number)=>30+(tick-start)/Math.max(1,end-start)*560, y=(energy:number)=>140-energy/max*110;
  const phases=[];
  for(let tick=Math.floor(start/config.phaseTicks)*config.phaseTicks;tick<end;tick+=config.phaseTicks) {
    const a=Math.max(start,tick), b=Math.min(end,tick+config.phaseTicks), phase=Math.floor(tick/config.phaseTicks)%3;
    phases.push({a,b,label:phase===1?'B':'A'});
  }
  const died=ancestry?.died;
  return <div className="energy-history">
    <svg viewBox="0 0 610 172" role="img" aria-label="真实能量与资源阶段历史：初始队列均值计入死亡，虚线为所选生命">
      {phases.map(p=><g key={p.a}><rect x={x(p.a)} y="8" width={x(p.b)-x(p.a)} height="134" fill={p.label==='B'?'#29362a':'#142b30'}/><text x={x(p.a)+4} y="21">{p.label}</text></g>)}
      <text x="2" y="36">{max.toFixed(0)}</text><text x="15" y="144">0</text>
      <polyline fill="none" stroke="#a9cbb4" strokeWidth="2.5" points={history.map(p=>`${x(p.tick)},${y(p.cohortEnergy)}`).join(' ')}/>
      {individual.length>1 && <polyline fill="none" stroke="#dbca98" strokeWidth="2" strokeDasharray="5 3" points={individual.map(p=>`${x(p.tick)},${y(p.energy)}`).join(' ')}/>}
      {died!=null && died>=start && died<=end && <g><line x1={x(died)} x2={x(died)} y1="30" y2="142" stroke="#d79b85" strokeDasharray="2 3"/><text x={Math.min(545,x(died)+3)} y="48">死亡</text></g>}
      <text x="30" y="165">{(start/config.ticksPerSecond).toFixed(1)} 秒</text><text x="590" y="165" textAnchor="end">{(end/config.ticksPerSecond).toFixed(1)} 秒</text>
    </svg>
    <p>实线：初始队列平均能量（死亡计 0）；虚线：{selected??'未选择个体'}。背景 A / B 为资源阶段，仅向观察者展示。</p>
    <p>当前队列均值 {history.at(-1)!.cohortEnergy.toFixed(2)}{individual.length ? `；所选个体 ${individual.at(-1)!.energy.toFixed(2)}` : ''}。曲线是实际后果，不能单独证明学习有效。</p>
  </div>;
}
