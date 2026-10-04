/** Authored P0 fixtures. No inference, training, ecological simulation or measured results. */
export type DemoState =
  "normal" | "empty" | "waiting" | "error" | "dead" | "extinct";
export type Point = { x: number; y: number };
export type Organism = {
  id: number;
  origin: Point;
  size: number;
  color: number;
  energy: number;
};
export const organisms: Organism[] = Array.from({ length: 48 }, (_, i) => ({
  id: i + 1,
  origin: { x: 100 + ((i * 173 + 137) % 820), y: 85 + ((i * 127 + 93) % 480) },
  size: 9 + ((i * 7) % 12),
  color: [0x9fddb5, 0xa6cbce, 0xcab1de, 0xdccc9b][i % 4],
  energy: 39 + ((i * 13) % 53),
}));
organisms[16] = {
  id: 17,
  origin: { x: 460, y: 320 },
  size: 23,
  color: 0xc6edb7,
  energy: 72,
};
export function positionOf(o: Organism, tick: number): Point {
  return {
    x: o.origin.x + Math.sin(tick / 90 + o.id) * 32,
    y: o.origin.y + Math.cos(tick / 115 + o.id * 2) * 25,
  };
}
export const episodes = [
  {
    step: "01",
    time: "02:00",
    title: "沿着熟悉的方向",
    tag: "初始策略",
    detail: "附近西侧有资源，地点记忆也指向西侧。示例个体选择靠近资源。",
    laya: "前往西侧 · 68%",
    action: "前往西侧 · 71%",
    result: "摄食成功 · 能量 +8",
    revision: "v0",
    bars: [71, 19, 10],
  },
  {
    step: "02",
    time: "03:20",
    title: "世界变了",
    tag: "资源迁移",
    detail: "资源从西侧移至东侧。旧地点记忆仍然存在，个体到达后没有获得营养。",
    laya: "探索附近 · 52%",
    action: "返回旧地点 · 58%",
    result: "未获得营养 · 能量 −4",
    revision: "v0",
    bars: [58, 32, 10],
  },
  {
    step: "03",
    time: "04:40",
    title: "经历留下痕迹",
    tag: "策略变化",
    detail:
      "演示时间跳转：展示同一观测下，小策略更新前后的候选分布。参数变化本身不代表改善。",
    laya: "探索附近 · 52%",
    action: "探索附近 · 66%",
    result: "示例反馈已记录 · 参数 v0 → v1",
    revision: "v1",
    bars: [24, 66, 10],
  },
  {
    step: "04",
    time: "06:00",
    title: "改变，是否有用？",
    tag: "冻结比较",
    detail:
      "相同起点的两个示例分支仍可能表现相近。这组预设展示“尚无改善证据”，而非成功结论。",
    laya: "探索附近 · 52%",
    action: "探索附近 · 66%",
    result: "示例对照：尚无改善证据",
    revision: "v1",
    bars: [24, 66, 10],
  },
];
export const chartData = {
  times: ["0", "20", "40", "60", "80", "100", "120"],
  learning: [62, 64, 57, 51, 57, 61, 64],
  frozen: [62, 63, 59, 50, 56, 63, 63],
};
