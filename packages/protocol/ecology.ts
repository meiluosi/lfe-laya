/** 世界身份仅用于协议校验；模型适配器只接收 observation 与 candidates。 */
export const ECOLOGY_PROTOCOL = 'ecology-decision-v1';
export const ACTIONS = ['north', 'east', 'south', 'west', 'eat', 'rest', 'reproduce'] as const;
export type Action = typeof ACTIONS[number];
export const DIRECTIONS: Record<Action, readonly [number, number]> = {
  north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0],
  eat: [0, 0], rest: [0, 0], reproduce: [0, 0],
};
export type Traits = { size: number; speed: number; perception: number; metabolism: number };
export type Observation = {
  energy: number; capacity: number; age: number; traits: Traits;
  heading: number; lastAction: Action; lastRejected: boolean;
  costs: { metabolismPerTick: number; movementPerUnit: number; decisionTicks: number; bitePerTick: number };
  local: { dx: number; dy: number; food: number; blocked: boolean; /** 语义世界：该格食物的自然语言描述 */ desc?: string }[];
  neighbors: { dx: number; dy: number; shape: number }[];
  memory: { dx: number; dy: number; food: number; stepsAgo: number; desc?: string }[];
  /** 延迟世界：个体此刻的自身感受（语言描述），如“胃里绞痛”。 */
  sensation?: string;
};
export type Identity = {
  protocol: string; runId: string; generation: number; epoch: number;
  tick: number; snapshotId: string; agentId: string; decisionId: string; attemptId: string;
};
export type Request = {
  identity: Identity; observation: Observation;
  candidates: { id: Action; dx: number; dy: number; description: string }[];
};
export type Proposal = {
  identity: Identity; action: Action; provider: string;
  distribution?: Partial<Record<Action, number>>; revision?: number;
};
export function validateProposal(request: Request, proposal: Proposal): string | null {
  if (!proposal || typeof proposal !== 'object' || !proposal.identity) return 'invalid_schema';
  if (Object.keys(proposal.identity).length !== Object.keys(request.identity).length) return 'invalid_identity';
  for (const key of Object.keys(request.identity) as (keyof Identity)[])
    if (request.identity[key] !== proposal.identity[key]) return `stale_${key}`;
  if (typeof proposal.provider !== 'string' || !proposal.provider.trim() || proposal.provider.length > 100) return 'invalid_provider';
  const legal = new Set(request.candidates.map(c => c.id));
  if (!legal.has(proposal.action)) return 'illegal_action';
  if (proposal.revision !== undefined && (!Number.isInteger(proposal.revision) || proposal.revision < 0)) return 'invalid_revision';
  if (proposal.distribution !== undefined) {
    if (!proposal.distribution || typeof proposal.distribution !== 'object') return 'invalid_distribution';
    const entries = Object.entries(proposal.distribution);
    if (entries.length !== legal.size || entries.some(([a, p]) => !legal.has(a as Action) || !Number.isFinite(p) || p < 0 || p > 1)) return 'invalid_distribution';
    if (Math.abs(entries.reduce((sum, [, p]) => sum + p, 0) - 1) > 1e-6) return 'invalid_distribution';
  }
  return null;
}
