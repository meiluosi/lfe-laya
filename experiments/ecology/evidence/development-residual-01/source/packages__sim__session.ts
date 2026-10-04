import { Ecology, ECOLOGY_VERSION, stateHash } from './ecology.ts';
import type { Config, Intervention, Snapshot, StepResult } from './ecology.ts';
import { isLearning } from './learning-port.ts';
import type { LearningPort, PreparedLearning, LearningReceipt, LearningUpdate } from './learning-port.ts';
import { randomProposal, ruleProposal } from './controllers.ts';
import { validateProposal } from '../protocol/ecology.ts';
import type { Proposal, Request } from '../protocol/ecology.ts';

export type Mode = 'rule' | 'random' | 'laya' | 'laya-memory' | 'rule-fallback' | 'learning' | 'no-laya' | 'frozen' | 'no-laya-frozen';
export type ModelRecord = { proposal: Proposal; input: unknown; raw_output: unknown; metadata: unknown; input_sha256: string; batch_ms: number; batch_size: number; amortized_ms: number };
export type DecisionReply = { record: ModelRecord } | { identity: Request['identity']; error: string };
export type Provider = (requests: Request[], options: { signal: AbortSignal; memory: boolean }) => Promise<DecisionReply[]>;
export type JournalEntry =
  | { kind: 'round'; mode?: Mode; requests: Request[]; proposals: Proposal[]; records: ModelRecord[]; outcomes: NonNullable<StepResult['outcomes']>; events: NonNullable<StepResult['events']>; beforeHash: string; afterHash: string; wallMilliseconds: number | null; learning?: { prepared: PreparedLearning; receipt: LearningReceipt } }
  | { kind: 'intervention'; command: Intervention; beforeHash: string; afterHash: string }
  | { kind: 'cancel'; reason: string; beforeHash: string; afterHash: string };
export type Attempt = { requests: Request[]; startedAt: string; wallMilliseconds: number; status: 'success' | 'partial' | 'error' | 'cancelled'; errors: string[] };
export type BranchChange = { kind: 'controller'; mode: Mode } | { kind: 'environment'; parameter: 'supplyAmount' | 'foodDecay' | 'diffusion'; value: number };
export type BranchInfo = { sourceRunId: string; sourceHash: string; sourceTick: number; change: BranchChange; original: string | number };
export type Recording = { format: 'ecology-recording-v1'; simulator: string; canResumeLearning: false; initial: Snapshot; entries: JournalEntry[]; attempts: Attempt[]; final: Snapshot; mode: Mode; complete: boolean; stopReason: string | null; branch?: BranchInfo };
export type SessionStatus = 'paused' | 'running' | 'waiting' | 'ready' | 'error' | 'done' | 'record-full';
const copy = <T>(x: T): T => structuredClone(x);
const isModel = (mode: Mode) => mode === 'laya' || mode === 'laya-memory';

export class Session {
  world: Ecology;
  mode: Mode = 'rule';
  paused = true;
  status: SessionStatus = 'paused';
  error: string | null = null;
  lastRound: StepResult | null = null;
  roundMilliseconds = 0;
  readonly maxEntries: number;
  private initial: Snapshot;
  private entries: JournalEntry[] = [];
  private attempts: Attempt[] = [];
  private records = new Map<string, ModelRecord>();
  private failures = new Map<string, string>();
  private token = 0;
  private inFlight: number | null = null;
  private abort: AbortController | null = null;
  private singlePermit = false;
  private stopped = false;
  private recordBytes = 0;
  private branch?: BranchInfo;
  private learning?: LearningPort;
  private learningTransaction: string | null = null;
  private preparedLearning: PreparedLearning | null = null;
  private learningFeedback: StepResult | null = null;
  private learningError = false;
  private learningStart = 0;
  private learningSequence = 0;
  lastLearning: LearningReceipt | null = null;
  private lastUpdates = new Map<string, LearningUpdate>();
  private provider: Provider;
  private changed: () => void;

  constructor(config: Partial<Config>, provider: Provider, changed = () => {}, maxEntries = 2000, learning?: LearningPort) {
    this.world = new Ecology(config); this.initial = this.world.snapshot(); this.provider = provider; this.changed = changed;
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 10000) throw Error('record_capacity');
    this.maxEntries = maxEntries; this.learning = learning;
  }
  private capacity(): boolean {
    // 每条最多 64 个体；额外限制序列化体积，停止前保留全部已执行记录。
    if (this.stopped || this.entries.length >= this.maxEntries || this.attempts.length >= this.maxEntries * 2 || this.recordBytes >= 64 * 1024 * 1024) {
      this.stopped = true; this.paused = true; this.singlePermit = false; this.status = 'record-full'; this.error = '记录容量已满，请导出并创建续段。'; this.changed(); return false;
    }
    return true;
  }
  pause(): void { this.paused = true; this.singlePermit = false; if (this.status === 'running') this.status = 'paused'; this.changed(); }
  resume(): void { if (!this.capacity() || this.failures.size || this.learningError) return; this.paused = false; this.error = null; if (this.status === 'paused' || this.status === 'ready') this.status = 'running'; this.changed(); }
  private append(entry: JournalEntry): void { this.entries.push(entry); this.recordBytes += new TextEncoder().encode(JSON.stringify(entry)).length; }
  private learningBoundary(): void { if (this.learningTransaction) throw Error(this.learningFeedback ? '动作结果已暂存，请先重试确认学习反馈。' : '请先暂停并取消本轮学习，再修改世界。'); }
  private invalidate(reason: string, journal = true): void {
    this.learningBoundary();
    if (journal && !this.capacity()) throw Error('record_capacity');
    const beforeHash = stateHash(this.world.snapshot());
    this.token++; this.abort?.abort(); this.abort = null; this.inFlight = null; this.records.clear(); this.failures.clear(); this.singlePermit = false;
    if (journal) { this.world.cancel(); this.append({ kind: 'cancel', reason, beforeHash, afterHash: stateHash(this.world.snapshot()) }); }
    this.error = null; this.status = this.paused ? 'paused' : 'running';
  }
  changeMode(mode: Mode): void {
    if (!['rule', 'random', 'laya', 'laya-memory', 'rule-fallback', 'learning', 'no-laya', 'frozen', 'no-laya-frozen'].includes(mode)) throw Error('invalid_mode');
    if (mode === this.mode) return;
    this.invalidate(`mode:${this.mode}->${mode}`); this.mode = mode; this.changed();
  }
  intervene(command: Intervention): void {
    this.learningBoundary();
    if (!this.capacity()) throw Error('record_capacity');
    const beforeHash = stateHash(this.world.snapshot());
    // 先由世界原子校验，失败不能取消仍有效的推理。
    this.world.intervene(command); this.invalidate('intervention', false);
    this.append({ kind: 'intervention', command: copy(command), beforeHash, afterHash: stateHash(this.world.snapshot()) }); this.changed();
  }
  reset(config: Partial<Config>): void {
    this.learningBoundary();
    const next = new Ecology(config); this.invalidate('reset', false); this.world = next; this.initial = next.snapshot();
    this.entries = []; this.attempts = []; this.recordBytes = 0; this.branch = undefined; this.lastLearning = null; this.lastUpdates.clear(); this.stopped = false; this.lastRound = null; this.paused = true; this.status = 'paused'; this.changed();
  }
  restore(snapshot: Snapshot, mode: Mode = this.mode): void {
    const next = new Ecology(snapshot.config); next.restore(snapshot);
    this.invalidate('restore', false); this.world = next; this.initial = next.snapshot(); this.mode = mode;
    this.entries = []; this.attempts = []; this.recordBytes = 0; this.branch = undefined; this.lastLearning = null; this.lastUpdates.clear(); this.stopped = false; this.lastRound = null; this.paused = true; this.status = 'paused'; this.changed();
  }
  fork(runId: string, change: BranchChange, changed = this.changed): Session {
    if (isLearning(this.mode) || (change.kind === 'controller' && isLearning(change.mode))) throw Error('学习分支需要完整学习检查点。');
    this.export(); // 只允许从已共同确认的动作边界分叉。
    const snapshot = this.world.snapshot(), sourceHash = stateHash(snapshot), sourceRunId = snapshot.config.runId;
    if (!runId || runId === sourceRunId) throw Error('branch_requires_new_run_id');
    let mode: Mode = this.mode, original: string | number;
    if (change.kind === 'controller') {
      if (!['rule', 'random', 'laya', 'laya-memory', 'rule-fallback', 'learning', 'no-laya', 'frozen', 'no-laya-frozen'].includes(change.mode)) throw Error('invalid_branch_mode');
      original = mode; mode = change.mode;
    } else if (change.kind === 'environment' && ['supplyAmount', 'foodDecay', 'diffusion'].includes(change.parameter)) {
      original = snapshot.config[change.parameter]; snapshot.config[change.parameter] = change.value;
    } else throw Error('invalid_branch_change');
    snapshot.config.runId = runId;
    const branch = new Session(snapshot.config, this.provider, changed, this.maxEntries); branch.restore(snapshot, mode);
    branch.branch = { sourceRunId, sourceHash, sourceTick: snapshot.tick, change: copy(change), original };
    return branch;
  }
  retry(): void {
    if (this.inFlight !== null) throw Error('request_still_running');
    if (this.learningError) { this.learningError = false; this.error = null; this.status = 'paused'; this.changed(); return; }
    if (!this.failures.size) throw Error('no_failed_requests');
    if (!this.capacity()) return;
    for (const id of this.failures.keys()) this.world.retry(id);
    this.failures.clear(); this.error = null; this.status = 'paused'; this.changed();
  }
  async advance(singleStep = false): Promise<void> {
    if (singleStep) { this.paused = true; this.singlePermit = true; }
    if (this.inFlight !== null || (!singleStep && this.paused) || !this.capacity()) return;
    if (isLearning(this.mode) || this.learningFeedback) { await this.advanceLearning(); return; }
    if (this.world.done()) { this.paused = true; this.status = 'done'; this.changed(); return; }
    if (this.failures.size) { this.paused = true; this.status = 'error'; this.changed(); return; }
    const requests = this.world.requests();
    const start = performance.now();
    if (isModel(this.mode)) {
      const missing = requests.filter(r => !this.records.has(r.identity.agentId));
      if (missing.length) {
        const token = ++this.token, abort = new AbortController(), attempt: Attempt = { requests: copy(missing), startedAt: new Date().toISOString(), wallMilliseconds: 0, status: 'error', errors: [] };
        this.inFlight = token; this.abort = abort; this.status = 'waiting'; this.attempts.push(attempt); this.changed();
        try {
          const replies = await this.provider(copy(missing), { signal: abort.signal, memory: this.mode === 'laya-memory' });
          attempt.wallMilliseconds = performance.now() - start;
          if (token !== this.token) { attempt.status = 'cancelled'; return; }
          if (!Array.isArray(replies)) throw Error('invalid_batch_response');
          const requested = new Map(missing.map(r => [r.identity.agentId, r])), seen = new Set<string>();
          for (const reply of replies) {
            const record = 'record' in reply ? reply.record : null, identity = record ? record.proposal?.identity : 'identity' in reply ? reply.identity : null;
            const id = identity?.agentId, request = id ? requested.get(id) : undefined;
            if (!id || !request || seen.has(id)) throw Error('unexpected_or_duplicate_response');
            seen.add(id);
            if (!record) {
              const invalid = validateProposal(request, { identity: identity!, action: 'rest', provider: 'error-validation' });
              this.failures.set(id, invalid ?? ('error' in reply ? reply.error : 'invalid_record')); continue;
            }
            const reason = validateProposal(request, record.proposal);
            if (reason || record.proposal.provider !== 'laya' || !record.input || !record.raw_output || !record.metadata || typeof record.input_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.input_sha256) || !Number.isFinite(record.batch_ms) || record.batch_ms < 0) {
              this.failures.set(id, reason ?? 'invalid_model_evidence'); continue;
            }
            this.records.set(id, copy(record));
          }
          for (const request of missing) if (!seen.has(request.identity.agentId)) this.failures.set(request.identity.agentId, 'missing_response');
          attempt.errors = [...this.failures.values()]; attempt.status = this.failures.size ? 'partial' : 'success';
        } catch (error) {
          attempt.wallMilliseconds = performance.now() - start;
          if (token !== this.token) { attempt.status = 'cancelled'; return; }
          attempt.errors = [String(error)]; attempt.status = 'error';
          for (const request of missing) { this.records.delete(request.identity.agentId); this.failures.set(request.identity.agentId, String(error)); }
        } finally {
          if (this.inFlight === token) { this.inFlight = null; this.abort = null; }
        }
        if (this.failures.size) { this.paused = true; this.singlePermit = false; this.error = [...new Set(this.failures.values())].join('; '); this.status = 'error'; this.changed(); return; }
      }
    }
    if (this.paused && !this.singlePermit) { this.status = 'ready'; this.changed(); return; }
    const seed = this.world.snapshot().config.seed;
    const proposals = isModel(this.mode) ? requests.map(r => this.records.get(r.identity.agentId)!.proposal) : requests.map(r => {
      const proposal = (this.mode === 'random' ? randomProposal : ruleProposal)(r, seed);
      if (this.mode === 'rule-fallback') proposal.provider = 'rule-fallback'; return proposal;
    });
    const result = this.world.step(proposals);
    if (!result.accepted) { this.paused = true; this.status = 'error'; this.error = result.reason ?? 'execution_rejected'; this.changed(); return; }
    this.roundMilliseconds = performance.now() - start;
    this.append({ kind: 'round', mode: this.mode, requests: result.requests!, proposals: result.proposals!, records: requests.flatMap(r => this.records.has(r.identity.agentId) ? [this.records.get(r.identity.agentId)!] : []),
      outcomes: result.outcomes!, events: result.events!, beforeHash: result.beforeHash!, afterHash: result.afterHash!, wallMilliseconds: this.roundMilliseconds });
    this.lastRound = result; this.records.clear(); this.singlePermit = false;
    this.status = this.world.done() ? 'done' : this.paused ? 'paused' : 'running';
    if (this.world.done()) this.paused = true;
    this.changed();
  }
  cancelPending(): void { this.learningBoundary(); if (this.inFlight !== null || this.records.size || this.failures.size) this.invalidate('cancel-pending'); }
  async cancelLearning(): Promise<void> {
    if (!this.learningTransaction || !this.learning) return;
    if (this.learningFeedback) throw Error('动作结果已暂存，必须确认反馈后才能继续。');
    this.pause(); ++this.token;
    // 取消服务端事务确认之前，仍锁住当前世界；不会留下无法恢复的半轮。
    await this.learning.abort(this.world.snapshot().config.runId, this.learningTransaction);
    this.inFlight = null; this.learningTransaction = null; this.preparedLearning = null; this.learningError = false;
    this.invalidate('cancel-learning'); this.changed();
  }
  private async advanceLearning(): Promise<void> {
    if (!this.learning) throw Error('learning_backend_not_connected');
    if (this.learningError) return;
    if (this.world.done() && !this.learningFeedback) { this.paused = true; this.status = 'done'; this.changed(); return; }
    const token = ++this.token; let attempt: Attempt | null = null;
    this.inFlight = token; this.status = 'waiting';
    try {
      if (!this.learningTransaction) {
        const s = this.world.snapshot(); this.learningTransaction = `${s.config.runId}:${s.tick}:${s.epoch}:${++this.learningSequence}`;
        this.learningStart = performance.now();
      }
      const transaction = this.learningTransaction; this.changed();
      if (!this.preparedLearning && !this.learningFeedback) {
        const requests = this.world.requests(), mode = this.mode;
        if (!isLearning(mode)) throw Error('learning_mode_required');
        attempt = {requests:copy(requests),startedAt:new Date().toISOString(),wallMilliseconds:0,status:'error',errors:[]}; this.attempts.push(attempt);
        const prepareStart=performance.now();
        const prepared = await this.learning.prepare(this.world.snapshot(), copy(requests), mode, transaction);
        attempt.wallMilliseconds=performance.now()-prepareStart;
        if (token !== this.token) { attempt.status='cancelled'; return; }
        if (!prepared || prepared.committed !== false || prepared.transactionId !== transaction || prepared.frozen !== mode.endsWith('frozen') || prepared.noLaya !== mode.startsWith('no-laya') || prepared.proposals.length !== requests.length || prepared.policyInputs.length !== requests.length) throw Error('invalid_learning_barrier');
        const expectedProvider = mode.startsWith('no-laya') ? 'individual-ppo-no-laya' : 'laya+individual-ppo';
        for (let i = 0; i < requests.length; i++) {
          const p = prepared.proposals[i], reason = validateProposal(requests[i], p), input = prepared.policyInputs[i];
          if (reason || p.provider !== expectedProvider || p.revision === undefined || !p.distribution || input.agentId !== p.identity.agentId || input.revision !== p.revision || !input.features.every(Number.isFinite)) throw Error(reason ?? 'invalid_learning_evidence');
        }
        if (!mode.startsWith('no-laya') && (prepared.records.length !== requests.length || prepared.records.some((r, i) => validateProposal(requests[i], r.proposal) || r.proposal.provider !== 'laya' || !r.input || !r.raw_output || !r.metadata))) throw Error('missing_real_laya_evidence');
        if (mode.startsWith('no-laya') && prepared.records.length) throw Error('unexpected_laya_evidence');
        this.preparedLearning = copy(prepared); attempt.status='success';
      }
      if (!this.learningFeedback) {
        if (this.paused && !this.singlePermit) { this.status = 'ready'; return; }
        const result = this.world.previewStep(this.preparedLearning!.proposals);
        if (!result.accepted) throw Error(result.reason ?? 'learning_execution_rejected');
        this.learningFeedback = result; // 网络故障时保留暂存执行，只重试确认；当前世界仍停在共同边界。
      }
      const result = this.learningFeedback;
      const receipt = await this.learning.commit(this.world.snapshot().config.runId, transaction, copy(result));
      if (receipt.transactionId !== transaction || receipt.worldHash !== result.afterHash || receipt.tick !== result.snapshot!.tick) throw Error('learning_receipt_mismatch');
      if (stateHash(this.world.snapshot()) !== result.beforeHash) throw Error('staged_world_changed');
      const committed = this.world.step(this.preparedLearning!.proposals);
      if (!committed.accepted || committed.afterHash !== result.afterHash) throw Error('staged_execution_mismatch');
      this.roundMilliseconds = performance.now() - this.learningStart;
      this.append({ kind: 'round', mode: this.mode, requests: result.requests!, proposals: result.proposals!, records: this.preparedLearning!.records,
        outcomes: result.outcomes!, events: result.events!, beforeHash: result.beforeHash!, afterHash: result.afterHash!, wallMilliseconds: this.roundMilliseconds,
        learning: { prepared: this.preparedLearning!, receipt } });
      this.lastRound = result; this.lastLearning = receipt; for (const update of receipt.updates) this.lastUpdates.set(update.agentId, copy(update)); this.learningTransaction = null; this.preparedLearning = null; this.learningFeedback = null; this.singlePermit = false;
      this.status = this.world.done() ? 'done' : this.paused ? 'paused' : 'running';
      if (this.world.done()) this.paused = true;
    } catch (error) {
      if (token !== this.token) { if(attempt) attempt.status='cancelled'; return; }
      if(attempt && attempt.status!=='success') { attempt.errors=[String(error)]; attempt.wallMilliseconds=performance.now()-this.learningStart; }
      this.learningError = true; this.paused = true; this.singlePermit = false; this.status = 'error'; this.error = String(error);
    } finally { if (this.inFlight === token) this.inFlight = null; this.changed(); }
  }
  evidence(): Extract<JournalEntry, {kind:'round'}> | null { const entry = this.entries.slice().reverse().find(e => e.kind === 'round'); return entry?.kind === 'round' ? copy(entry) : null; }
  branchInfo(): BranchInfo | null { return this.branch ? copy(this.branch) : null; }
  markBranch(info: BranchInfo): void { this.learningBoundary(); this.branch = copy(info); }
  export(): Recording {
    this.learningBoundary();
    if (this.inFlight !== null || this.records.size || this.failures.size) throw Error('save_requires_committed_boundary');
    return copy({ format: 'ecology-recording-v1', simulator: ECOLOGY_VERSION, canResumeLearning: false,
      initial: this.initial, entries: this.entries, attempts: this.attempts, final: this.world.snapshot(), mode: this.mode, complete: true, stopReason: this.stopped ? 'record_capacity' : null, ...(this.branch ? { branch: this.branch } : {}) });
  }
  view() { return { status: this.status, paused: this.paused, error: this.error, mode: this.mode, pending: this.inFlight !== null, ready: this.records.size + (this.preparedLearning?.proposals.length ?? 0), failed: this.failures.size + Number(this.learningError), learningTransaction: this.learningTransaction, learningCommitPending: !!this.learningFeedback, learning: this.lastLearning, learningUpdates: [...this.lastUpdates.values()], entries: this.entries.length, attempts: this.attempts.length, capacity: this.maxEntries, recordBytes: this.recordBytes, roundMilliseconds: this.roundMilliseconds }; }
}

/** 同版本动作重放。不调用 provider，不训练，不信任导出文件附带的终态。 */
export class Replay {
  world: Ecology;
  index = 0;
  readonly recordBytes: number;
  private lastEvidence: Extract<JournalEntry, {kind:'round'}> | null = null;
  private lastLearning: LearningReceipt | null = null;
  private lastUpdates = new Map<string, LearningUpdate>();
  private recording: Recording;
  constructor(recording: Recording) {
    if (recording.format !== 'ecology-recording-v1' || recording.simulator !== ECOLOGY_VERSION || recording.canResumeLearning !== false || !Array.isArray(recording.entries) || recording.entries.length > 10000 || !recording.complete) throw Error('recording_version_or_capacity');
    if (!recording.entries.length && JSON.stringify(recording.initial) !== JSON.stringify(recording.final)) throw Error('replay_empty_final_mismatch');
    this.recording = copy(recording); this.world = new Ecology(recording.initial.config); this.world.restore(recording.initial);
    this.recordBytes = new TextEncoder().encode(JSON.stringify(recording)).length;
  }
  evidence() { return copy(this.lastEvidence); }
  learningEvidence() { return { receipt: copy(this.lastLearning), updates: copy([...this.lastUpdates.values()]) }; }
  step(): boolean {
    if (this.index >= this.recording.entries.length) return false;
    const entry = this.recording.entries[this.index];
    if (stateHash(this.world.snapshot()) !== entry.beforeHash) throw Error(`replay_before_mismatch:${this.index}`);
    if (entry.kind === 'cancel') this.world.cancel();
    else if (entry.kind === 'intervention') this.world.intervene(entry.command);
    else if (entry.kind === 'round') {
      const requests = this.world.requests();
      if (requests.length !== entry.proposals.length || requests.length !== entry.requests.length) throw Error('replay_barrier_mismatch');
      const proposals = requests.map((r, i) => {
        if (r.identity.agentId !== entry.requests[i].identity.agentId || JSON.stringify(r.observation) !== JSON.stringify(entry.requests[i].observation) || JSON.stringify(r.candidates) !== JSON.stringify(entry.requests[i].candidates)) throw Error('replay_observation_mismatch');
        return { ...entry.proposals[i], identity: r.identity };
      });
      const result = this.world.step(proposals);
      if (!result.accepted || JSON.stringify(result.outcomes) !== JSON.stringify(entry.outcomes) || JSON.stringify(result.events) !== JSON.stringify(entry.events)) throw Error(`replay_outcome_mismatch:${this.index}`);
    } else throw Error('unknown_record_entry');
    if (stateHash(this.world.snapshot()) !== entry.afterHash) throw Error(`replay_after_mismatch:${this.index}`);
    this.index++;
    if (this.index === this.recording.entries.length && JSON.stringify(this.world.snapshot()) !== JSON.stringify(this.recording.final)) throw Error('replay_final_mismatch');
    if (entry.kind === 'round') {
      this.lastEvidence = copy(entry);
      if (entry.learning) {
        this.lastLearning = copy(entry.learning.receipt);
        for (const update of entry.learning.receipt.updates) this.lastUpdates.set(update.agentId, copy(update));
      }
    }
    return true;
  }
}
