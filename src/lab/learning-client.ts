import type { Snapshot, StepResult } from '../../packages/sim/ecology.ts';
import type { Request } from '../../packages/protocol/ecology.ts';
import type { LearningPort, LearningMode, PreparedLearning, LearningReceipt } from '../../packages/sim/learning-port.ts';

export async function api(path: string, body: unknown): Promise<any> {
  const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 120000);
  try {
    const response = await fetch(`/api/learning/${path}`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body), signal: abort.signal });
    if (!response.ok) throw Error(`学习服务 ${response.status}: ${(await response.text()).slice(0,500)}`);
    return await response.json();
  } finally { clearTimeout(timeout); }
}
export class LocalLearning implements LearningPort {
  private created = new Map<string, boolean>();
  async prepare(world: Snapshot, requests: Request[], mode: LearningMode, transactionId: string): Promise<PreparedLearning> {
    const runId=world.config.runId, noLaya=mode.startsWith('no-laya');
    if (this.created.has(runId) && this.created.get(runId)!==noLaya) throw Error('更换 Laya 对照需要重新播种，以保留原实验的学习归属。');
    if (!this.created.has(runId)) {
      await api('create',{run_id:runId,seed:world.config.seed,mode:noLaya?'no-laya':mode}); this.created.set(runId,noLaya);
    }
    return api('prepare',{run_id:runId,transaction_id:transactionId,requests,world,frozen:mode.endsWith('frozen')});
  }
  async commit(runId: string, transactionId: string, result: StepResult): Promise<LearningReceipt> { return api('commit',{run_id:runId,transaction_id:transactionId,result}); }
  async abort(runId: string, transactionId: string): Promise<void> { await api('abort',{run_id:runId,transaction_id:transactionId}); }
  async configure(runId:string, mode:string) {
    if(!this.created.has(runId)) return;
    if(['learning','frozen','no-laya','no-laya-frozen'].includes(mode) && this.created.get(runId)!==mode.startsWith('no-laya')) throw Error('更换 Laya 对照需要重新播种。');
    await api('freeze',{run_id:runId,frozen:!['learning','no-laya'].includes(mode)});
  }
  async close(runId:string) { if(this.created.has(runId)) {await api('close',{run_id:runId});this.created.delete(runId);} }
  adopt(runId:string,noLaya:boolean) {this.created.set(runId,noLaya);}
}
