import type { Action, Proposal, Request } from '../protocol/ecology.ts';

/** 独立的按身份/时间索引随机流，不消耗环境/遗传 RNG；不使用隐藏世界信息。 */
export function controllerUniform(seed: number, request: Request, slot = 0): number {
  const text = `${seed}:controller:${request.identity.agentId}:${request.identity.tick}:${slot}`;
  let x = 2166136261;
  for (const char of text) x = Math.imul(x ^ char.charCodeAt(0), 16777619);
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
export function randomProposal(request: Request, seed: number): Proposal {
  const choice = Math.floor(controllerUniform(seed, request) * request.candidates.length);
  return { identity: request.identity, action: request.candidates[choice].id, provider: 'random-legal' };
}
export function ruleProposal(request: Request, seed: number): Proposal {
  const o = request.observation, legal = new Set(request.candidates.map(c => c.id));
  let action: Action = 'rest';
  const here = o.local.find(c => Math.abs(c.dx) < .5 + 1e-8 && Math.abs(c.dy) < .5 + 1e-8 && !c.blocked);
  if (legal.has('reproduce')) action = 'reproduce';
  else if (legal.has('eat') && here && here.food >= .35 && o.capacity - o.energy >= .6) action = 'eat';
  else {
    const moves = request.candidates.filter(c => c.dx || c.dy);
    const current = o.local.reduce<typeof here>((best, cell) => !cell.blocked && (!best || Math.hypot(cell.dx, cell.dy) < Math.hypot(best.dx, best.dy)) ? cell : best, undefined);
    const targets = [...o.local.filter(c => !c.blocked && c.food >= .4), ...o.memory.filter(m => m.food >= .4 && m.stepsAgo > 0)]
      .filter(t => Math.hypot(t.dx, t.dy) > .6)
      .sort((a, b) => b.food / (1 + Math.hypot(b.dx, b.dy)) - a.food / (1 + Math.hypot(a.dx, a.dy)));
    // 局部 BFS；既不读取完整障碍图，也不会朝不可见的食物规划路线。
    if (current) {
      const key = (x: number, y: number) => `${Math.round(x * 1e6)},${Math.round(y * 1e6)}`;
      const cells = new Map(o.local.filter(c => !c.blocked).map(c => [key(c.dx, c.dy), c]));
      const queue: { x: number; y: number; first: Action | null }[] = [{ x: current.dx, y: current.dy, first: null }];
      const visited = new Map<string, Action | null>([[key(current.dx, current.dy), null]]);
      for (let i = 0; i < queue.length; i++) {
        const node = queue[i];
        for (const [id, dx, dy] of [['north', 0, -1], ['east', 1, 0], ['south', 0, 1], ['west', -1, 0]] as const) {
          const k = key(node.x + dx, node.y + dy);
          if (!cells.has(k) || visited.has(k) || (!node.first && !legal.has(id))) continue;
          const first = node.first ?? id; visited.set(k, first); queue.push({ x: node.x + dx, y: node.y + dy, first });
        }
      }
      for (const target of targets) {
        const first = visited.get(key(target.dx, target.dy));
        if (first) { action = first; break; }
      }
    }
    if (action === 'rest' && targets.length && moves.length) {
      const target = targets[0];
      action = moves.slice().sort((a, b) => Math.hypot(target.dx - a.dx, target.dy - a.dy) - Math.hypot(target.dx - b.dx, target.dy - b.dy))[0].id;
    }
    if (action === 'rest' && moves.length) {
      const forward = moves.find(m => Math.abs(Math.atan2(m.dy, m.dx) - o.heading) < .01);
      action = forward && controllerUniform(seed, request, 1) < .78 ? forward.id : moves[Math.floor(controllerUniform(seed, request) * moves.length)].id;
    }
  }
  return { identity: request.identity, action, provider: 'rule-local-v1' };
}
