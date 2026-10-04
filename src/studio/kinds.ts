// 语义食物种类的外观：形状与色相按种类下标任意分配，**不暗示好坏**（好坏只由观察者图例里的“真实影响”显示）。
export const KIND_SHAPES = ['circle', 'diamond', 'square', 'triangle'] as const;
export function kindStyle(index: number): { shape: typeof KIND_SHAPES[number]; color: number; css: string } {
  const hue = (index * 47 + 20) % 360, s = .55, l = .62, k = (n: number) => (n + hue / 30) % 12, a = s * Math.min(l, 1 - l), f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const r = Math.round(f(0) * 255), g = Math.round(f(8) * 255), b = Math.round(f(4) * 255);
  return { shape: KIND_SHAPES[index % KIND_SHAPES.length], color: (r << 16) | (g << 8) | b, css: `rgb(${r},${g},${b})` };
}
