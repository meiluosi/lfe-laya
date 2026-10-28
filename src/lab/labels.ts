// 观察室的界面状态类型与中文标签。仅展示用，不参与模拟或学习。
import type { Snapshot, Outcome } from '../../packages/sim/ecology.ts';
import type { HistoryPoint } from './history';
import type { LearningReceipt, LearningUpdate } from '../../packages/sim/learning-port.ts';
import type { BranchInfo, ModelRecord } from '../../packages/sim/session.ts';
import type { Request, Proposal } from '../../packages/protocol/ecology.ts';
export type View = { snapshot: Snapshot; paused: boolean; speed: number; mode: string; roundMs: number; actualRate: number; status: string; hash: string; error?: string;
  history: HistoryPoint[]; adapt: { windowTicks: number; good: number[]; bad: number[] }; innate: { labels: string[]; of: Record<string, number>; every: number; ticks: number[]; counts: number[][] } | null; runtime: {pending: boolean; failed: number; ready: number; entries: number; attempts: number; capacity: number; recordBytes: number; learningTransaction: string|null; learningCommitPending: boolean; learningUpdates: LearningUpdate[]}; branches: {runId:string;active:boolean;mode:string;source:BranchInfo|null;ticksPerSecond:number;tick:number;living:number;energy:number;births:number;deaths:number}[]; learning: LearningReceipt|null; lastDecisions: {request: Request; proposal: Proposal; outcome: Outcome; model:ModelRecord|null}[]; replay: {index:number;total:number;live?:boolean}|null; compare?: {runId:string;tick:number|null;agents:{id:string;x:number;y:number;shape:number;heading:number}[]}|null };
export const actionLabels: Record<string, string> = { north: '向北移动', east: '向东移动', south: '向南移动', west: '向西移动', eat: '摄食', rest: '休眠', reproduce: '繁殖提案' };
export const eventLabels: Record<string, string> = { born: '出生', died: '死亡', ate: '摄食', rejected: '执行受阻', nutrient: '投放营养', obstacle_added: '添加障碍', obstacle_removed: '移除障碍' };
export const shapes = ['柔团', '尾游', '节虫'];
export const modes: Record<string, string> = {rule:'规则大脑',random:'随机合法策略',laya:'固定 Laya · 当前观测','laya-memory':'固定 Laya · 有限记忆','rule-fallback':'规则降级',replay:'录制回放',learning:'Laya + 个体学习','no-laya':'独立小网络 · 无 Laya',frozen:'Laya + 小网络 · 暂停学习','no-laya-frozen':'独立小网络 · 暂停学习'};
/** 进化出的先天策略模式：evolved:laya-on 等。名称由 studio/genomes 解释；这里只给通用回退。 */
export const modeName = (mode: string, evolvedLabel?: (name: string) => string): string => mode.startsWith('evolved:') ? (evolvedLabel ? evolvedLabel(mode.slice(8)) : '进化先天策略') : (modes[mode] ?? mode);
