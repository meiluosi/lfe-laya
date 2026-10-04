import type { Snapshot } from '../../packages/sim/ecology';

export type HistoryPoint = { tick: number; living: number; meanEnergy: number; cohortEnergy: number; energyById: Record<string, number> };
/** 仅供观察者使用的全局统计；不进入任何策略输入。死亡的初始个体仍留在分母。 */
export function historyPoint(snapshot: Snapshot): HistoryPoint {
  const energyById = Object.fromEntries(snapshot.agents.map(a => [a.id, a.energy]));
  const cohort = snapshot.lineage.filter(a => a.parentId === null);
  return { tick: snapshot.tick, living: snapshot.agents.length,
    meanEnergy: snapshot.agents.reduce((sum, a) => sum + a.energy, 0) / Math.max(1, snapshot.agents.length),
    cohortEnergy: cohort.reduce((sum, a) => sum + (energyById[a.id] ?? 0), 0) / Math.max(1, cohort.length), energyById };
}
