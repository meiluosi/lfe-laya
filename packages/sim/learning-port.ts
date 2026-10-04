import type { Snapshot, StepResult } from './ecology.ts';
import type { ModelRecord } from './session.ts';
import type { Proposal, Request } from '../protocol/ecology.ts';

export type LearningMode = 'learning' | 'no-laya' | 'frozen' | 'no-laya-frozen';
export type LearningUpdate = { agentId: string; revision: number; input_revision: number; samples: number; before: string; after: string; milliseconds: number; probe?: {features:number[];mask:boolean[];before:number[];after:number[];maxDelta:number} };
export type PreparedLearning = { transactionId: string; frozen:boolean; noLaya:boolean; proposals: Proposal[]; records: ModelRecord[]; updates: LearningUpdate[]; policyInputs: { agentId: string; encoding: string; features: number[]; mask: boolean[]; prior: unknown; revision: number }[]; committed: false };
export type LearningReceipt = { transactionId: string; worldHash: string; tick: number; updates: LearningUpdate[]; revisions: Record<string, number>; retired: string[] };
export interface LearningPort {
  prepare(world: Snapshot, requests: Request[], mode: LearningMode, transactionId: string): Promise<PreparedLearning>;
  commit(runId: string, transactionId: string, result: StepResult): Promise<LearningReceipt>;
  abort(runId: string, transactionId: string): Promise<void>;
}
export const isLearning = (mode: string): mode is LearningMode => ['learning', 'no-laya', 'frozen', 'no-laya-frozen'].includes(mode);
