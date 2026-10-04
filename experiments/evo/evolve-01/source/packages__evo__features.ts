// 决策层的输入特征：只从该个体的许可观测（Request.observation / candidates）计算，不接触世界状态。
// 可选的“Laya 直觉向量”（6 维方向概率 + 存在标志）由调用方提供；没有时槽位为 0 且标志为 0。
import type { Request } from '../protocol/ecology.ts';

export const SECTORS = 4;                         // 北、东、南、西（按主导轴划分）
export const PERCEPT_LABELS = ['north', 'east', 'south', 'west', 'here', 'none'] as const;
export const N_BASE = 6, N_SECTOR_FEATURES = 4, N_PERCEPT = PERCEPT_LABELS.length + 1;
export const N_FEATURES = N_BASE + SECTORS * N_SECTOR_FEATURES + N_PERCEPT;

const sectorOf = (dx: number, dy: number): number => Math.abs(dy) >= Math.abs(dx) ? (dy < 0 ? 0 : 2) : (dx > 0 ? 1 : 3);

export function extractFeatures(request: Request, percept?: readonly number[] | null): Float64Array {
  const o = request.observation, f = new Float64Array(N_FEATURES);
  const attract = new Float64Array(SECTORS), nearest = new Float64Array(SECTORS).fill(Infinity), wall = new Float64Array(SECTORS), memory = new Float64Array(SECTORS);
  let here = 0;
  for (const c of o.local) {
    const d = Math.hypot(c.dx, c.dy);
    if (d < .5) { if (!c.blocked) here = c.food; continue; }
    const s = sectorOf(c.dx, c.dy);
    if (c.blocked) { if (d <= 1.2) wall[s] = 1; continue; }
    if (c.food >= .02) attract[s] += c.food / (1 + d);
    if (c.food >= .05 && d < nearest[s]) nearest[s] = d;
  }
  for (const m of o.memory) {
    const d = Math.hypot(m.dx, m.dy); if (d < .5) continue;
    memory[sectorOf(m.dx, m.dy)] += m.food * Math.exp(-m.stepsAgo / 300) / (1 + d);
  }
  const frac = o.energy / o.capacity, ids = new Set(request.candidates.map(c => c.id));
  f[0] = frac; f[1] = frac < .3 ? 1 : 0; f[2] = Math.tanh(here / 2); f[3] = ids.has('eat') ? 1 : 0; f[4] = Math.min(4, o.neighbors.length) / 4; f[5] = o.lastRejected ? 1 : 0;
  for (let s = 0; s < SECTORS; s++) {
    const base = N_BASE + s * N_SECTOR_FEATURES;
    f[base] = Math.tanh(attract[s] / 2); f[base + 1] = Number.isFinite(nearest[s]) ? 1 / (1 + nearest[s]) : 0; f[base + 2] = wall[s]; f[base + 3] = Math.tanh(memory[s] / 2);
  }
  const p0 = N_BASE + SECTORS * N_SECTOR_FEATURES;
  if (percept) { if (percept.length !== PERCEPT_LABELS.length) throw Error('percept_length'); for (let i = 0; i < percept.length; i++) f[p0 + i] = percept[i]; f[p0 + PERCEPT_LABELS.length] = 1; }
  return f;
}
