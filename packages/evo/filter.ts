// 浏览器安全的小工具（不依赖 node:fs）：按条件隐藏观测里的食物描述。观察台与评估共用。
import type { Request } from '../protocol/ecology.ts';
export function filterRequest(q: Request, keep: (desc: string | undefined) => boolean): Request {
  const o = q.observation;
  return { ...q, observation: { ...o,
    local: o.local.map(c => (c.food > .05 && !keep(c.desc)) ? { dx: c.dx, dy: c.dy, blocked: c.blocked, food: 0 } : c),
    memory: o.memory.filter(m => keep(m.desc)) } };
}
