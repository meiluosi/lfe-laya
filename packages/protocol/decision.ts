/** M0 单体协议。Identity 只供系统关联，Perception 才能传给大脑。 */
export const PROTOCOL_VERSION = 'm0-decision-v1';
export type Action = 'north' | 'east' | 'south' | 'west' | 'eat' | 'rest';
export type Identity = {
  protocol: string; runId: string; generation: number; epoch: number; decisionId: string;
  attemptId: string; tick: number; snapshotId: string; agentId: string;
};
export type Candidate = { id: Action; dx: number; dy: number; description: string };
export type Perception = {
  energy: number; capacity: number; age: number;
  local: { dx: number; dy: number; food: number; blocked: boolean }[];
  memory: { dx: number; dy: number; food: number; stepsAgo: number }[];
};
export type Request = { identity: Identity; observation: Perception; candidates: Candidate[] };
export type Proposal = {
  identity: Identity; action: Action; provider: string;
  distribution?: Partial<Record<Action, number>>;
};
export const DIRECTIONS: Record<string, [number, number]> = {
  north: [0,-1], east: [1,0], south: [0,1], west: [-1,0], eat:[0,0], rest:[0,0],
};
export function validateProposal(request: Request, proposal: Proposal): string | null {
  if (!proposal || typeof proposal !== 'object' || !proposal.identity) return 'invalid_schema';
  for (const key of Object.keys(request.identity) as (keyof Identity)[])
    if (request.identity[key] !== proposal.identity[key]) return `stale_${key}`;
  if (typeof proposal.provider !== 'string' || !proposal.provider.trim()) return 'missing_provider';
  const legal = new Set(request.candidates.map(c => c.id));
  if (!legal.has(proposal.action)) return 'illegal_action';
  if (proposal.distribution !== undefined) {
    if (!proposal.distribution || typeof proposal.distribution !== 'object') return 'invalid_distribution';
    const entries = Object.entries(proposal.distribution);
    if (entries.length !== legal.size || entries.some(([k,v]) => !legal.has(k as Action) || !Number.isFinite(v) || v < 0 || v > 1)) return 'invalid_distribution';
    if (Math.abs(entries.reduce((sum,[,v])=>sum+v,0)-1)>1e-6) return 'invalid_distribution';
  }
  return null;
}
