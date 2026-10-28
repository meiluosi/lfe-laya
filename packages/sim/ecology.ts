import { ACTIONS, DIRECTIONS, ECOLOGY_PROTOCOL, validateProposal } from '../protocol/ecology.ts';
import type { Action, Observation, Proposal, Request, Traits } from '../protocol/ecology.ts';

export const ECOLOGY_VERSION = 'ecology-v1';
export type Config = {
  seed: number; runId: string; width: number; height: number; initialAgents: number;
  ticksPerSecond: number; decisionTicks: number; horizon: number; phaseTicks: number;
  capacity: number; initialEnergy: number; metabolism: number; moveCost: number; bite: number;
  initialFood: number; supplyEvery: number; supplyAmount: number; foodDecay: number; diffusion: number; cellCapacity: number;
  reproduction: boolean; mutation: boolean; birthEnergy: number; birthCost: number;
  birthThreshold: number; birthCooldown: number; maxAge: number; deathReturn: number;
  maxAgents: number; maxLineage: number; maxEvents: number; memorySize: number; memoryTtl: number;
  /** 仅语义世界存在；缺省时世界与历史版本逐位一致。 */
  semantic?: SemanticConfig;
  obstacles: number[];
};
export const DEFAULT_CONFIG: Config = {
  seed: 1, runId: 'ecology', width: 24, height: 16, initialAgents: 8,
  ticksPerSecond: 10, decisionTicks: 10, horizon: 18000, phaseTicks: 600,
  capacity: 40, initialEnergy: 24, metabolism: .025, moveCost: .18, bite: .6,
  initialFood: 160, supplyEvery: 10, supplyAmount: 8, foodDecay: .001, diffusion: .015, cellCapacity: 20,
  reproduction: true, mutation: true, birthEnergy: 12, birthCost: 2, birthThreshold: 32,
  birthCooldown: 150, maxAge: 1800, deathReturn: .65,
  maxAgents: 64, maxLineage: 8192, maxEvents: 512, memorySize: 8, memoryTtl: 300, obstacles: [],
};
/** 语义食物（可选）：每格食物带一个“种类”，其自然语言描述对个体可见，对能量的真实影响（factor）只有模拟器知道。 */
export type SemanticKind = { description: string; factor: number };
/** 漂移（可选）：按 everyTicks 分阶段，奇数阶段里 flip 中的种类真实影响取反（A/B/A）。个体只能从自己的经历里察觉。 */
export type SemanticDrift = { everyTicks: number; flip: number[];
  /** 可选的多状态日程：states[s] 是状态 s 里取反的种类；schedule[p] 是第 p 个阶段（⌊tick/everyTicks⌋，超出则取最后一个）所处的状态。例如 A/B/A：states=[[],全部]，schedule=[0,1,0]；A/B/C：states=[[],全部,一半]，schedule=[0,1,2]。缺省回到奇偶交替。 */
  states?: number[][]; schedule?: number[];
  /** 可选的环境线索：以观测里的 season 句子出现。mode 'true'：状态 s 显示 texts[s]（同一状态总是同一句）；'random'：每个阶段随机一句，与状态无关；'off'：不显示。 */
  cue?: { texts: string[]; mode: 'true' | 'off' | 'random' | 'paraphrase'; /** paraphrase：每个状态的一组不同措辞；同一状态每次出现换一句（不与该状态此前用过的重复），字面标签因此不再可靠 */ variants?: string[][] };
  /** 可选（默认关闭）：反转后原本有益的种类造成的伤害系数（正数，如 4 = 每口损失 4×食量的能量，受能量封顶）；缺省为 1（普通取反）。用来让“反转后没及时调整”要命。 */
  flipHarm?: number };
/** 延迟（可选）：吃下后，营养/毒性在 ticks 个模拟步之后才作用于个体；其间这部分能量记为“在途”。个体生效时会有一句自身感受的语言描述。 */
/** 延迟后果。spread 缺省为固定延迟；mode 'jitter'：每一口的延迟在 ticks±spread 内均匀取整（由 个体、时刻、种类 的哈希决定，不消耗随机数源）；mode 'kind'：每个种类固定为 ticks−spread 或 ticks+spread（由种类序号的哈希决定）。 */
export type SemanticDelay = { ticks: number; spread?: number; mode?: 'jitter' | 'kind' };
/** 成熟周期（W7，可选）：季节 s(t)=⌊t/seasonTicks⌋ mod 4；种类 k 的阶段 = (s + offsets[k]) mod 4（0 青涩 1 成熟 2 过熟 3 腐败）。
 *  perishable 的种类，结算因子 = 种类因子 × multipliers[阶段]（隐藏真值）；其余种类不随阶段变化。cues 控制语言线索：language 显示真实的阶段短语与季节提示，
 *  shuffled 显示错配的（阶段 +2），off 不显示任何线索（价值仍随阶段变化）。阶段完全由 tick 决定，不增加状态。 */
export type SemanticRipening = { seasonTicks: number; offsets: number[]; perishable: boolean[]; multipliers: number[]; cues: 'language' | 'shuffled' | 'off'; stageText: string[]; seasonText: string[][] };
/** 社会观察（W8b，可选）：视野内邻居的可见状态以语言描述（look）出现，并列出它最近吃过的东西（ate，可见的行为）。不共享参数、信念或内部经验。
 *  look 由邻居最近一次明显的后果（≥0.3 能量的收益或伤害，约半口的强度；延迟世界里在生效时）决定，持续 lookTicks；否则为平静的描述。cues：language 真实，shuffled 把受害与受益互换，off 不显示。 */
const LOOK_THRESHOLD = 0.3;
export type SemanticSocial = { cues: 'language' | 'shuffled' | 'off'; window: number; lookTicks: number; harmText: string[]; boostText: string[]; calmText: string[] };
export type SemanticConfig = { kinds: SemanticKind[]; drift?: SemanticDrift; delay?: SemanticDelay; ripening?: SemanticRipening; social?: SemanticSocial };
export type Memory = { x: number; y: number; food: number; tick: number; desc?: string };
export type Agent = {
  id: string; parentId: string | null; generation: number; born: number; x: number; y: number;
  heading: number; energy: number; traits: Traits; shape: number; lastBirth: number;
  memory: Memory[]; lastAction: Action; lastRejected: boolean;
  /** 仅延迟世界：尚未生效的效果（amount>0 为在途收益，<0 为将要承受的伤害）与当前的自身感受。 */
  pending?: { due: number; amount: number }[]; felt?: { until: number; text: string };
  /** 仅社会观察世界：最近吃过的东西（显示的描述与时间）与最近一次明显后果的外观。 */
  social?: { ate: { desc: string; tick: number }[]; look?: { until: number; kind: 'harm' | 'boost' } };
};
export type Event = { seq: number; tick: number; kind: string; agentId?: string; targetId?: string; amount?: number; reason?: string };
export type Lineage = { id: string; parentId: string | null; generation: number; born: number; died: number | null; shape: number };
export type Snapshot = {
  version: string; config: Config; tick: number; epoch: number;
  rng: { environment: number; placement: number; genetics: number };
  food: number[]; /** 语义世界：每格食物种类下标（-1 为空）；缺省时不存在 */ kinds?: number[]; obstacles: boolean[]; agents: Agent[]; nextId: number;
  lineage: Lineage[]; events: Event[]; nextEvent: number;
  ledger: { initial: number; supplied: number; metabolism: number; movement: number; decay: number; reproduction: number; deathLoss: number; overflow: number; /** 语义世界：食物消化损失与毒性损害 */ semanticLoss?: number };
  metrics: { births: number; deaths: number; eaten: number; distance: number; rejected: number; lowEnergyTicks: number; agentTicks: number; populationCapHits: number; lineageCapHits: number };
};
export type Outcome = {
  agentId: string; action: Action; startTick: number; endTick: number;
  energyBefore: number; energyAfter: number; reward: number; rewards: number[];
  terminated: boolean; truncated: boolean; rejected: boolean;
};
export type StepResult = {
  accepted: boolean; reason?: string; requests?: Request[]; proposals?: Proposal[];
  outcomes?: Outcome[]; events?: Event[]; beforeHash?: string; afterHash?: string; snapshot?: Snapshot;
};
export type Intervention = { kind: 'nutrient'; x: number; y: number; amount: number } | { kind: 'obstacle'; x: number; y: number; blocked: boolean };
const clone = <T>(x: T): T => structuredClone(x);
const clamp = (x: number, min: number, max: number) => Math.max(min, Math.min(max, x));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const traitBounds: Record<keyof Traits, readonly [number, number]> = { size: [.8, 1.2], speed: [.75, 1.25], perception: [2, 4], metabolism: [.8, 1.2] };

/** Stable diagnostic hash; exports additionally use file SHA-256. Never a security boundary. */
export function stateHash(state: unknown): string {
  let a = 2166136261, b = 5381;
  const text = JSON.stringify(state);
  // 与 `for (const char of text)` + `char.charCodeAt(0)` 逐位等价（代理对只取高位代码单元），但不为每个字符分配字符串。
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619); b = Math.imul(b, 33) ^ c;
    if (c >= 0xD800 && c <= 0xDBFF) { const d = text.charCodeAt(i + 1); if (d >= 0xDC00 && d <= 0xDFFF) i++; }
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
function validateSocial(r: SemanticSocial): void {
  const bank = (a: unknown) => Array.isArray(a) && a.length >= 1 && a.length <= 4 && a.every(t => typeof t === 'string' && /^[ -~]{1,80}$/.test(t));
  if (!r || typeof r !== 'object' || Object.keys(r).sort().join() !== 'boostText,calmText,cues,harmText,lookTicks,window') throw Error('invalid_semantic_social');
  if (!['language', 'shuffled', 'off'].includes(r.cues) || !Number.isInteger(r.window) || r.window < 20 || r.window > 2000 || !Number.isInteger(r.lookTicks) || r.lookTicks < 10 || r.lookTicks > 500 || !bank(r.harmText) || !bank(r.boostText) || !bank(r.calmText)) throw Error('invalid_semantic_social');
}
function validateRipening(sem: SemanticConfig): void {
  const r = sem.ripening!, n = sem.kinds.length, text = (s: unknown, max: number) => typeof s === 'string' && s.length >= 1 && s.length <= max && /^[ -~]+$/.test(s);
  if (!r || typeof r !== 'object' || Object.keys(r).sort().join() !== 'cues,multipliers,offsets,perishable,seasonText,seasonTicks,stageText') throw Error('invalid_semantic_ripening');
  if (!Number.isInteger(r.seasonTicks) || r.seasonTicks < 50 || r.seasonTicks > 5000 || !['language', 'shuffled', 'off'].includes(r.cues)) throw Error('invalid_semantic_ripening');
  if (!Array.isArray(r.offsets) || r.offsets.length !== n || r.offsets.some(o => !Number.isInteger(o) || o < 0 || o > 3)) throw Error('invalid_semantic_ripening');
  if (!Array.isArray(r.perishable) || r.perishable.length !== n || r.perishable.some(p => typeof p !== 'boolean')) throw Error('invalid_semantic_ripening');
  if (!Array.isArray(r.multipliers) || r.multipliers.length !== 4 || r.multipliers.some(m => !Number.isFinite(m) || m < -8 || m > 1)) throw Error('invalid_semantic_ripening');
  if (!Array.isArray(r.stageText) || r.stageText.length !== 4 || r.stageText.some(t => !text(t, 40))) throw Error('invalid_semantic_ripening');
  if (!Array.isArray(r.seasonText) || r.seasonText.length !== 4 || r.seasonText.some(a => !Array.isArray(a) || a.length < 1 || a.length > 4 || a.some(t => !text(t, 120)))) throw Error('invalid_semantic_ripening');
  if (sem.kinds.some(k => k.description.length + 1 + 40 > 240)) throw Error('invalid_semantic_ripening');   // 描述 + 阶段短语必须仍在 240 个 ASCII 字符以内
}
function validateSemantic(c: Config): void {
  const sem = c.semantic!;
  if (!sem || typeof sem !== 'object' || !Array.isArray(sem.kinds) || sem.kinds.length < 1 || sem.kinds.length > 64 || Object.keys(sem).some(k => k !== 'kinds' && k !== 'drift' && k !== 'delay' && k !== 'ripening' && k !== 'social')) throw Error('invalid_semantic');
  if (sem.social !== undefined) validateSocial(sem.social);
  if (sem.ripening !== undefined) validateRipening(sem);
  if (sem.delay !== undefined && (!sem.delay || Object.keys(sem.delay).some(k => k !== 'ticks' && k !== 'spread' && k !== 'mode') || !Number.isInteger(sem.delay.ticks) || sem.delay.ticks < 1 || sem.delay.ticks > 600 || (sem.delay.spread === undefined) !== (sem.delay.mode === undefined) || (sem.delay.spread !== undefined && (!Number.isInteger(sem.delay.spread) || sem.delay.spread < 1 || sem.delay.spread >= sem.delay.ticks || sem.delay.ticks + sem.delay.spread > 600 || (sem.delay.mode !== 'jitter' && sem.delay.mode !== 'kind'))))) throw Error('invalid_semantic_delay');
  if (sem.drift !== undefined) {
    const d = sem.drift;
    if (!d || Object.keys(d).some(k => !['everyTicks', 'flip', 'states', 'schedule', 'cue', 'flipHarm'].includes(k)) || (d.flipHarm !== undefined && !(Number.isFinite(d.flipHarm) && d.flipHarm >= 1 && d.flipHarm <= 8)) || !Number.isInteger(d.everyTicks) || d.everyTicks < 100 || !Array.isArray(d.flip) || d.flip.length < 1 || new Set(d.flip).size !== d.flip.length || d.flip.some(i => !Number.isInteger(i) || i < 0 || i >= sem.kinds.length)) throw Error('invalid_semantic_drift');
    const okSet = (a: unknown) => Array.isArray(a) && new Set(a).size === a.length && a.every(i => Number.isInteger(i) && i >= 0 && i < sem.kinds.length);
    if ((d.states === undefined) !== (d.schedule === undefined)) throw Error('invalid_semantic_drift');
    if (d.states !== undefined && (!Array.isArray(d.states) || d.states.length < 2 || d.states.length > 8 || !d.states.every(okSet) || !Array.isArray(d.schedule) || d.schedule.length < 1 || d.schedule.length > 64 || d.schedule.some(i => !Number.isInteger(i) || i < 0 || i >= d.states!.length))) throw Error('invalid_semantic_drift');
    if (d.cue !== undefined && (d.states === undefined || !d.cue || Object.keys(d.cue).sort().join() !== (d.cue.mode === 'paraphrase' ? 'mode,texts,variants' : 'mode,texts') || !['true', 'off', 'random', 'paraphrase'].includes(d.cue.mode) || (d.cue.mode === 'paraphrase' && (!Array.isArray(d.cue.variants) || d.cue.variants.length !== d.states.length || d.cue.variants.some(v => !Array.isArray(v) || v.length < 2 || v.length > 24 || new Set(v).size !== v.length || v.some(t => typeof t !== 'string' || !/^[ -~]{1,120}$/.test(t))))) || !Array.isArray(d.cue.texts) || d.cue.texts.length < d.states.length || d.cue.texts.length > 8 || d.cue.texts.some(t => typeof t !== 'string' || !/^[ -~]{1,120}$/.test(t)) || new Set(d.cue.texts).size !== d.cue.texts.length)) throw Error('invalid_semantic_drift');
    if (d.cue !== undefined && sem.ripening !== undefined) throw Error('invalid_semantic_drift');
  }
  if (new Set(sem.kinds.map(k => k.description)).size !== sem.kinds.length) throw Error('invalid_semantic_duplicate');
  for (const k of sem.kinds) if (!k || Object.keys(k).length !== 2 || typeof k.description !== 'string' || !/^[ -~]{1,240}$/.test(k.description) || !Number.isFinite(k.factor) || k.factor < -8 || k.factor > 1) throw Error('invalid_semantic_kind');   // 负得越多越毒；< -1 的种类可以一口致命
  // 种类按格记录，扩散会混合不同种类；死亡返还的能量没有对应种类，所以两者都必须关闭。
  if (c.diffusion !== 0 || c.deathReturn !== 0) throw Error('semantic_requires_no_diffusion_or_death_return');
}
export function validateConfig(c: Config): void {
  if (!c || typeof c.runId !== 'string' || !c.runId || c.runId.length > 120) throw Error('invalid_run_id');
  if (Object.keys(c).filter(k => k !== 'semantic').length !== Object.keys(DEFAULT_CONFIG).length || Object.keys(DEFAULT_CONFIG).some(key => !(key in c)) || Object.keys(c).some(k => k !== 'semantic' && !(k in DEFAULT_CONFIG))) throw Error('config_schema');
  if (c.semantic !== undefined) validateSemantic(c);
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) if (typeof value === 'number' && typeof c[key as keyof Config] !== 'number') throw Error(`invalid_config_${key}`);
  for (const [key, value] of Object.entries(c)) if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) throw Error(`invalid_config_${key}`);
  for (const key of ['seed', 'width', 'height', 'initialAgents', 'ticksPerSecond', 'decisionTicks', 'horizon', 'phaseTicks', 'supplyEvery', 'birthCooldown', 'maxAge', 'maxAgents', 'maxLineage', 'maxEvents', 'memorySize', 'memoryTtl'] as const)
    if (!Number.isInteger(c[key]) || c[key] < 1) throw Error(`invalid_config_${key}`);
  if (c.seed > 0xffffffff || c.width < 5 || c.height < 5 || c.width > 64 || c.height > 64 || c.initialAgents > c.maxAgents || c.maxAgents > 256 || c.maxLineage < c.initialAgents || c.maxLineage > 65536 || c.maxEvents > 8192 || c.memorySize > 16 || c.decisionTicks > 100 || c.ticksPerSecond > 100 || c.horizon > 10_000_000 || c.initialAgents > c.width * c.height || c.initialFood > 100000 || c.supplyAmount > 10000) throw Error('config_budget');
  if (c.capacity <= 0 || c.initialEnergy <= 0 || c.initialEnergy > c.capacity || c.birthEnergy <= 0 || c.birthEnergy > c.capacity * .8 || c.birthThreshold < c.birthEnergy + c.birthCost || c.birthThreshold > c.capacity * .8 || c.cellCapacity <= 0 || c.bite <= 0 || c.foodDecay > 1 || c.diffusion > .25 || c.deathReturn > 1) throw Error('config_energy');
  if (typeof c.reproduction !== 'boolean' || typeof c.mutation !== 'boolean' || !Array.isArray(c.obstacles) || new Set(c.obstacles).size !== c.obstacles.length || c.obstacles.some(i => !Number.isInteger(i) || i < 0 || i >= c.width * c.height) || c.width * c.height - c.obstacles.length < c.initialAgents) throw Error('config_obstacles');
}

export class Ecology {
  private state: Snapshot;
  /** 当前模拟步（只读；评估代码按时间窗口统计时使用） */
  get tick(): number { return this.state.tick; }
  private pending: Request[] | null = null;
  private attempts = new Map<string, number>();
  private generation = 0;
  private roundEvents: Event[] | null = null;
  constructor(config: Partial<Config> = {}) {
    const c = clone({ ...DEFAULT_CONFIG, ...config }); validateConfig(c);
    this.state = {
      version: ECOLOGY_VERSION, config: c, tick: 0, epoch: 0,
      rng: { environment: c.seed, placement: (c.seed ^ 0x9e3779b9) >>> 0 || 1, genetics: (c.seed ^ 0x85ebca6b) >>> 0 || 1 },
      food: Array(c.width * c.height).fill(0), obstacles: Array(c.width * c.height).fill(false), agents: [], nextId: 0,
      lineage: [], events: [], nextEvent: 0,
      ...(c.semantic ? { kinds: Array(c.width * c.height).fill(-1) } : {}),
      ledger: { initial: c.initialAgents * c.initialEnergy + c.initialFood, supplied: 0, metabolism: 0, movement: 0, decay: 0, reproduction: 0, deathLoss: 0, overflow: 0, ...(c.semantic ? { semanticLoss: 0 } : {}) },
      metrics: { births: 0, deaths: 0, eaten: 0, distance: 0, rejected: 0, lowEnergyTicks: 0, agentTicks: 0, populationCapHits: 0, lineageCapHits: 0 },
    };
    for (const i of c.obstacles) this.state.obstacles[i] = true;
    const open = this.openCells();
    for (let i = 0; i < c.initialAgents; i++) {
      const at = Math.floor(this.random('placement') * open.length), cell = open.splice(at, 1)[0];
      this.addAgent(cell % c.width + .5, Math.floor(cell / c.width) + .5, c.initialEnergy, null);
    }
    this.spawnFood(c.initialFood);
    this.refreshMemories(); this.assertValid();
  }
  private random(stream: keyof Snapshot['rng']): number {
    let x = this.state.rng[stream]; x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.state.rng[stream] = x >>> 0; return (x >>> 0) / 4294967296;
  }
  private openCells(): number[] { return this.state.obstacles.flatMap((blocked, i) => blocked ? [] : [i]); }
  private cell(x: number, y: number): number { return Math.floor(y) * this.state.config.width + Math.floor(x); }
  private blocked(x: number, y: number): boolean {
    const c = this.state.config;
    return x < 0 || y < 0 || x >= c.width || y >= c.height || this.state.obstacles[this.cell(x, y)];
  }
  private clearPath(x: number, y: number, tx: number, ty: number, allowTargetWall = false): boolean {
    const steps = Math.max(1, Math.ceil(Math.hypot(tx - x, ty - y) * 12));
    const targetCell = this.cell(tx, ty);
    for (let i = 1; i <= steps; i++) {
      const px = x + (tx - x) * i / steps, py = y + (ty - y) * i / steps;
      if (this.blocked(px, py) && !(allowTargetWall && this.cell(px, py) === targetCell)) return false;
    }
    return true;
  }
  private emit(kind: string, data: Omit<Event, 'seq' | 'tick' | 'kind'> = {}): void {
    const s = this.state; s.events.push({ seq: s.nextEvent++, tick: s.tick, kind, ...data });
    if (this.roundEvents) this.roundEvents.push(clone(s.events[s.events.length - 1]));
    if (s.events.length > s.config.maxEvents) s.events.splice(0, s.events.length - s.config.maxEvents);
  }
  private addAgent(x: number, y: number, energy: number, parent: Agent | null): Agent {
    const s = this.state, traits: Traits = parent ? clone(parent.traits) : { size: 1, speed: 1, perception: 3, metabolism: 1 };
    if (parent && s.config.mutation) for (const key of Object.keys(traits) as (keyof Traits)[]) {
      const [lo, hi] = traitBounds[key]; traits[key] = clamp(traits[key] + (this.random('genetics') - .5) * (hi - lo) * .15, lo, hi);
    }
    const agent: Agent = { id: `life-${s.nextId++}`, parentId: parent?.id ?? null, generation: parent ? parent.generation + 1 : 0,
      born: s.tick, x, y, energy, traits, shape: parent?.shape ?? (s.nextId - 1) % 3, heading: parent?.heading ?? 0,
      lastBirth: s.tick, memory: [], lastAction: 'rest', lastRejected: false, ...(s.config.semantic?.delay ? { pending: [] } : {}), ...(s.config.semantic?.social ? { social: { ate: [] } } : {}) };
    s.agents.push(agent); s.lineage.push({ id: agent.id, parentId: agent.parentId, generation: agent.generation, born: s.tick, died: null, shape: agent.shape });
    return agent;
  }
  capacity(a: Agent): number { return this.state.config.capacity * a.traits.size; }
  /** 向一格添加食物并返回实际接收量；语义世界里，空格会随机获得一个种类（只用环境随机流）。 */
  private addFood(cell: number, amount: number): number {
    const s = this.state, received = Math.min(amount, s.config.cellCapacity - s.food[cell]);
    if (received > 0 && s.kinds && s.kinds[cell] < 0) s.kinds[cell] = Math.floor(this.random('environment') * s.config.semantic!.kinds.length);
    s.food[cell] += received; return received;
  }
  private spawnFood(amount: number): void {
    const s = this.state, c = s.config, phase = Math.floor(s.tick / c.phaseTicks) % 3;
    const cells = this.openCells().filter(i => phase === 1 || i % c.width < Math.ceil(c.width / 2));
    if (!cells.length) { s.ledger.overflow += amount; return; }
    // 每份最多 2 能量，外部预算固定；饱和处的溢出明确记作损失，不转移给个体。
    for (let remaining = amount; remaining > 1e-10;) {
      const chunk = Math.min(2, remaining), cell = cells[Math.floor(this.random('environment') * cells.length)];
      const received = this.addFood(cell, chunk);
      s.ledger.overflow += chunk - received; remaining -= chunk;
    }
  }
  /** 成熟周期：当前季节（0–3）与种类 idx 的阶段。无 ripening 时阶段恒为 1（成熟）且不影响任何结算。 */
  private season(): number { const r = this.state.config.semantic?.ripening; return r ? Math.floor(this.state.tick / r.seasonTicks) % 4 : 0; }
  private stage(idx: number): number { const r = this.state.config.semantic!.ripening!; return (this.season() + r.offsets[idx]) % 4; }
  private describe(idx: number): string {
    const sem = this.state.config.semantic!, r = sem.ripening, base = sem.kinds[idx].description;
    if (!r || r.cues === 'off') return base;
    return `${base} ${r.stageText[(this.stage(idx) + (r.cues === 'shuffled' ? 2 : 0)) % 4]}`;
  }
  /** 漂移：种类 idx 此刻的影响是否取反（多状态日程优先，否则奇偶交替）。 */
  private driftFlipped(idx: number): boolean {
    const d = this.state.config.semantic?.drift; if (!d) return false;
    const phase = Math.floor(this.state.tick / d.everyTicks);
    return d.schedule ? d.states![d.schedule[Math.min(phase, d.schedule.length - 1)]].includes(idx) : phase % 2 === 1 && d.flip.includes(idx);
  }
  private seasonCue(): string | undefined {
    const dr = this.state.config.semantic?.drift;
    if (dr?.cue) {
      if (dr.cue.mode === 'off') return undefined;
      const phase = Math.floor(this.state.tick / dr.everyTicks);
      if (dr.cue.mode === 'true') return dr.cue.texts[dr.schedule![Math.min(phase, dr.schedule!.length - 1)]];
      if (dr.cue.mode === 'paraphrase') {   // 每个阶段换一句同状态的不同措辞；同一状态再次出现时不重复此前用过的句子
        const used = new Map<number, Set<number>>(); let out = '';
        for (let p = 0; p <= phase; p++) { const st = dr.schedule![Math.min(p, dr.schedule!.length - 1)], vs = dr.cue.variants![st], u = used.get(st) ?? new Set<number>(); let x = 2166136261; for (const ch of `${this.state.config.runId}:para:${p}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619); let k = (x >>> 0) % vs.length; while (u.has(k) && u.size < vs.length) k = (k + 1) % vs.length; u.add(k); used.set(st, u); out = vs[k]; }
        return out;
      }
      let x = 2166136261; for (const ch of `${this.state.config.runId}:cue:${phase}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
      return dr.cue.texts[(x >>> 0) % dr.cue.texts.length];
    }
    const r = this.state.config.semantic?.ripening; if (!r || r.cues === 'off') return undefined;
    const s = (this.season() + (r.cues === 'shuffled' ? 2 : 0)) % 4, alts = r.seasonText[s]; let x = 2166136261;
    for (const ch of `${this.state.config.runId}:${Math.floor(this.state.tick / r.seasonTicks)}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
    return alts[(x >>> 0) % alts.length];
  }
  /** 社会观察：邻居 b 的可见外观与最近吃过的东西。 */
  private seen(b: Agent): { look?: string; ate?: string[] } {
    const soc = this.state.config.semantic?.social; if (!soc || soc.cues === 'off' || !b.social) return {};
    const t = this.state.tick; let kind: 'harm' | 'boost' | 'calm' = b.social.look && b.social.look.until > t ? b.social.look.kind : 'calm';
    if (soc.cues === 'shuffled' && kind !== 'calm') kind = kind === 'harm' ? 'boost' : 'harm';
    const bank = kind === 'harm' ? soc.harmText : kind === 'boost' ? soc.boostText : soc.calmText; let x = 2166136261;
    for (const ch of `${this.state.config.runId}:${b.id}:${Math.floor(t / soc.lookTicks)}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
    const ate = b.social.ate.filter(m => t - m.tick <= soc.window).slice(-3).reverse().map(m => m.desc);
    return { look: bank[(x >>> 0) % bank.length], ...(ate.length ? { ate } : {}) };
  }
  private noteEffect(a: Agent, effect: number): void {   // 明显的后果（收益或伤害 ≥ LOOK_THRESHOLD 能量，约半口的强度）改变外观
    const soc = this.state.config.semantic?.social; if (!soc || !a.social || Math.abs(effect) < LOOK_THRESHOLD) return;
    a.social.look = { until: this.state.tick + soc.lookTicks, kind: effect > 0 ? 'boost' : 'harm' };
  }
  private local(a: Agent): Observation['local'] {
    const s = this.state, c = s.config, r = Math.floor(a.traits.perception), cells: Observation['local'] = [];
    const cx = Math.floor(a.x), cy = Math.floor(a.y);
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (Math.abs(x + .5 - a.x) + Math.abs(y + .5 - a.y) > a.traits.perception + 1e-9 || !this.clearPath(a.x, a.y, x + .5, y + .5, true)) continue;
      const wall = this.blocked(x + .5, y + .5);
      const idx = y * c.width + x, cell: Observation['local'][number] = { dx: x + .5 - a.x, dy: y + .5 - a.y, blocked: wall, food: wall ? 0 : s.food[idx] };
      if (s.kinds && !wall && s.food[idx] > .05 && s.kinds[idx] >= 0) cell.desc = this.describe(s.kinds[idx]);
      cells.push(cell);
    }
    return cells;
  }
  private refreshMemories(): void {
    const s = this.state, c = s.config;
    for (const a of s.agents) {
      for (const cell of this.local(a)) {
        if (cell.blocked) continue;
        const x = Math.round((a.x + cell.dx) * 2) / 2, y = Math.round((a.y + cell.dy) * 2) / 2;
        a.memory = a.memory.filter(m => m.x !== x || m.y !== y);
        if (cell.food > .05) a.memory.push({ x, y, food: cell.food, tick: s.tick, ...(cell.desc ? { desc: cell.desc } : {}) });
      }
      a.memory = a.memory.filter(m => s.tick - m.tick <= c.memoryTtl).slice(-c.memorySize);
    }
  }
  private childPlace(a: Agent): [number, number] | null {
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const x = a.x + dx * .65, y = a.y + dy * .65;
      if (!this.blocked(x, y) && this.clearPath(a.x, a.y, x, y) && !this.state.agents.some(b => Math.hypot(b.x - x, b.y - y) < .35)) return [x, y];
    }
    return null;
  }
  private canReproduce(a: Agent): boolean {
    const s = this.state, c = s.config;
    return c.reproduction && a.energy >= c.birthThreshold && s.tick - a.lastBirth >= c.birthCooldown && s.agents.length < c.maxAgents && s.lineage.length < c.maxLineage && !!this.childPlace(a);
  }
  private inspectAgent(a: Agent, hash: string): Request {
    const s = this.state, c = s.config;
    const candidates: Request['candidates'] = [];
    for (const action of ACTIONS) {
      const [dx, dy] = DIRECTIONS[action], distance = a.traits.speed * c.decisionTicks / c.ticksPerSecond;
      if ((dx || dy) && !this.clearPath(a.x, a.y, a.x + dx * distance, a.y + dy * distance)) continue;
      if (action === 'eat' && (s.food[this.cell(a.x, a.y)] <= 1e-8 || a.energy >= this.capacity(a))) continue;
      if (action === 'reproduce' && !this.canReproduce(a)) continue;
      const description = action === 'eat' ? 'Eat food at your current location.' : action === 'rest' ? 'Stay here, paying resting metabolism; this does not restore energy.' : action === 'reproduce' ? `Create one offspring, transferring ${c.birthEnergy} energy and spending ${c.birthCost} additional energy.` : `Move ${distance.toFixed(2)} units ${action}.`;
      candidates.push({ id: action, dx: dx * distance, dy: dy * distance, description });
    }
    return { identity: { protocol: ECOLOGY_PROTOCOL, runId: c.runId, generation: this.generation, epoch: s.epoch, tick: s.tick,
      snapshotId: hash, agentId: a.id, decisionId: `${c.runId}:${s.epoch}:${s.tick}:${a.id}`, attemptId: `try-${this.attempts.get(a.id) ?? 0}` },
      observation: { energy: a.energy, capacity: this.capacity(a), age: s.tick - a.born, traits: clone(a.traits),
        heading: a.heading, lastAction: a.lastAction, lastRejected: a.lastRejected,
        costs: { metabolismPerTick: this.metabolism(a), movementPerUnit: c.moveCost * a.traits.size, decisionTicks: c.decisionTicks, bitePerTick: c.bite },
        local: this.local(a), neighbors: s.agents.filter(b => b.id !== a.id && Math.hypot(b.x - a.x, b.y - a.y) <= a.traits.perception && this.clearPath(a.x, a.y, b.x, b.y)).slice(0, 8).map(b => ({ dx: b.x - a.x, dy: b.y - a.y, shape: b.shape, ...this.seen(b) })),
        memory: a.memory.map(m => ({ dx: m.x - a.x, dy: m.y - a.y, food: m.food, stepsAgo: s.tick - m.tick, ...(m.desc ? { desc: m.desc } : {}) })),
        ...(a.felt && a.felt.until > s.tick ? { sensation: a.felt.text } : {}), ...(this.seasonCue() ? { season: this.seasonCue()! } : {}) }, candidates };
  }
  /** 精简模式（仅供进化 / 评估等只读 outcomes 与 events 的调用方）：不计算整个状态的哈希（snapshotId 改为 lean:<epoch>:<tick>，每轮唯一），
   *  requests() 直接返回内部数组（调用方不得修改），step() 只返回 accepted / outcomes / events。世界动力学与随机数序列与默认模式完全一致（tests/lean.test.mjs 逐世界核对）。 */
  lean = false;
  inspect(): Request[] { const hash = this.lean ? `lean:${this.state.epoch}:${this.state.tick}` : stateHash(this.state); return this.state.agents.map(a => this.inspectAgent(a, hash)); }
  requests(): Request[] {
    if (this.done()) throw Error('world_done');
    if (!this.pending) this.pending = this.inspect();
    return this.lean ? this.pending : clone(this.pending);
  }
  retry(agentId?: string): Request[] {
    const requests = this.requests();
    if (agentId && !requests.some(r => r.identity.agentId === agentId)) throw Error('unknown_agent');
    for (const r of requests) if (!agentId || r.identity.agentId === agentId) this.attempts.set(r.identity.agentId, (this.attempts.get(r.identity.agentId) ?? 0) + 1);
    this.pending = this.inspect(); return clone(this.pending);
  }
  cancel(): void { this.state.epoch++; this.pending = null; this.attempts.clear(); }
  done(): boolean { return this.state.tick >= this.state.config.horizon || !this.state.agents.length; }
  snapshot(): Snapshot { return clone(this.state); }
  private metabolism(a: Agent): number {
    return this.state.config.metabolism * a.traits.metabolism * a.traits.size * (1 + .1 * (a.traits.perception - 2));
  }
  private spend(a: Agent, amount: number, kind: 'metabolism' | 'movement' | 'reproduction'): void {
    const spent = Math.min(a.energy, amount); a.energy -= spent; this.state.ledger[kind] += spent;
  }
  private environment(): void {
    const s = this.state, c = s.config;
    if (s.tick % c.supplyEvery === 0) { this.spawnFood(c.supplyAmount); s.ledger.supplied += c.supplyAmount; }
    for (let i = 0; i < s.food.length; i++) { const lost = s.food[i] * c.foodDecay; s.food[i] -= lost; s.ledger.decay += lost; }
    if (s.kinds) for (let i = 0; i < s.food.length; i++) if (s.kinds[i] >= 0 && s.food[i] < 1e-6) { s.ledger.decay += s.food[i]; s.food[i] = 0; s.kinds[i] = -1; }
    if (c.diffusion > 0) {
      const before = s.food.slice();
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const i = y * c.width + x; if (s.obstacles[i]) continue;
        for (const j of [x + 1 < c.width ? i + 1 : -1, y + 1 < c.height ? i + c.width : -1]) {
          if (j < 0 || s.obstacles[j]) continue;
          const flow = (before[i] - before[j]) * c.diffusion;
          s.food[i] -= flow; s.food[j] += flow;
        }
      }
    }
  }
  /** 把到期的延迟效果作用于个体：收益受容量限制（溢出记损耗），伤害受剩余能量限制；并更新自身感受。 */
  /** 一口的延迟（步数）：固定，或按 spread/mode 由确定性哈希决定（不使用随机数源，回放不受影响）。 */
  private delayOf(a: Agent, idx: number): number {
    const d = this.state.config.semantic!.delay!; if (d.spread === undefined) return d.ticks;
    let x = 2166136261; for (const ch of d.mode === 'kind' ? `kind:${idx}` : `${a.id}:${this.state.tick}:${idx}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
    x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; const u = (x >>> 0) / 4294967296;
    return d.mode === 'kind' ? d.ticks + (u < .5 ? -d.spread : d.spread) : d.ticks - d.spread + Math.floor(u * (2 * d.spread + 1));
  }
  private settle(a: Agent): void {
    const s = this.state; if (!a.pending?.length) return;
    const due = a.pending.filter(p => p.due <= s.tick); if (!due.length) return;
    a.pending = a.pending.filter(p => p.due > s.tick);
    for (const p of due) {
      if (p.amount > 0) { const got = Math.min(p.amount, this.capacity(a) - a.energy); a.energy += got; s.ledger.overflow += p.amount - got; s.metrics.eaten += got; a.felt = { until: s.tick + 30, text: 'a warm wave of strength spreads through your body' }; this.noteEffect(a, got); }
      else {
        const harm = Math.min(a.energy, -p.amount), share = -p.amount / this.capacity(a); a.energy -= harm; s.ledger.semanticLoss! += harm; this.noteEffect(a, -harm);
        a.felt = { until: s.tick + 30, text: share < .1 ? 'a dull ache stirs in your belly' : share < .3 ? 'sharp cramps twist your stomach and your skin turns clammy' : 'your vision swims and your legs give way beneath you' };
      }
    }
  }
  private die(a: Agent, reason: string): void {
    const s = this.state, cell = this.cell(a.x, a.y), returned = a.energy * s.config.deathReturn;
    const stored = Math.min(returned, s.config.cellCapacity - s.food[cell]);
    s.food[cell] += stored; s.ledger.deathLoss += a.energy - stored; a.energy = 0;
    if (a.pending) { for (const p of a.pending) if (p.amount > 0) s.ledger.deathLoss += p.amount; a.pending = []; }   // 在途收益随死亡丢失
    s.metrics.deaths++; s.lineage.find(l => l.id === a.id)!.died = s.tick;
    this.emit('died', { agentId: a.id, reason, amount: stored });
  }
  /** 同一模拟器中的暂存执行，直到学习反馈确认才发布到当前世界。 */
  previewStep(proposals: Proposal[]): StepResult {
    const staged = new Ecology(this.state.config);
    staged.state = clone(this.state); staged.generation = this.generation;
    staged.pending = clone(this.pending); staged.attempts = new Map(this.attempts);
    return staged.step(proposals);
  }
  step(proposals: Proposal[]): StepResult {
    if (!this.pending) return { accepted: false, reason: 'no_pending_round' };
    if (!Array.isArray(proposals) || proposals.length !== this.pending.length || new Set(proposals.map(p => p?.identity?.agentId)).size !== proposals.length) return { accepted: false, reason: 'incomplete_barrier' };
    const byId = new Map(proposals.map(p => [p?.identity?.agentId, p]));
    for (const request of this.pending) {
      const reason = validateProposal(request, byId.get(request.identity.agentId)!);
      if (reason) return { accepted: false, reason };
    }
    const s = this.state, c = s.config, beforeHash = this.lean ? '' : stateHash(s), requests = this.lean ? this.pending : clone(this.pending), startTick = s.tick;
    this.roundEvents = [];
    const outcomes: Outcome[] = s.agents.map(a => ({ agentId: a.id, action: byId.get(a.id)!.action, startTick: s.tick, endTick: s.tick,
      energyBefore: a.energy, energyAfter: a.energy, reward: 0, rewards: [], terminated: false, truncated: false, rejected: false }));
    const resultById = new Map(outcomes.map(o => [o.agentId, o]));
    const actions = new Map<string, Action>();
    for (const a of s.agents) { a.lastAction = byId.get(a.id)!.action; a.lastRejected = false; actions.set(a.id, a.lastAction); }
    const end = Math.min(c.horizon, s.tick + c.decisionTicks);
    while (s.tick < end) {
      s.tick++; this.environment();
      const aliveAtStart = s.agents.slice().sort((a, b) => Number(a.id.slice(5)) - Number(b.id.slice(5)));
      const beforeEnergy = new Map(aliveAtStart.map(a => [a.id, a.energy]));
      for (const a of aliveAtStart) {
        const action = actions.get(a.id) ?? 'rest', [dx, dy] = DIRECTIONS[action];
        if (dx || dy) {
          const distance = a.traits.speed / c.ticksPerSecond, x = a.x + dx * distance, y = a.y + dy * distance;
          if (!this.clearPath(a.x, a.y, x, y)) { this.reject(a, 'blocked', resultById); actions.set(a.id, 'rest'); }
          else { a.x = x; a.y = y; a.heading = Math.atan2(dy, dx); this.spend(a, c.moveCost * distance * a.traits.size, 'movement'); s.metrics.distance += distance; }
        }
        if (action === 'eat') {
          const cell = this.cell(a.x, a.y), amount = Math.min(s.food[cell], c.bite, this.capacity(a) - a.energy);
          if (amount <= 1e-10) { this.reject(a, 'food_gone_or_full', resultById); actions.set(a.id, 'rest'); }
          else if (s.kinds && s.kinds[cell] >= 0) {
            // 语义食物：真实影响由模拟器按种类结算。吃下的食物量一律从场中消失；个体得到 amount*factor（可为负）。
            const idx = s.kinds[cell], drift = c.semantic!.drift, flipped = this.driftFlipped(idx);
            const rip = c.semantic!.ripening; let factor = c.semantic!.kinds[idx].factor * (rip && rip.perishable[idx] ? rip.multipliers[this.stage(idx)] : 1) * (flipped ? -1 : 1); s.food[cell] -= amount;
            if (flipped && drift?.flipHarm && c.semantic!.kinds[idx].factor > 0) factor = -drift.flipHarm;
            if (factor > 1) factor = 1;   // 漂移把有害种类（|factor| 可达 harmCap）翻成有益时，食物提供的能量不得多于食物本身（否则凭空造能、超出容量）
            if (a.social) { const d = this.describe(idx), last = a.social.ate[a.social.ate.length - 1]; if (last && last.desc === d) last.tick = s.tick; else { a.social.ate.push({ desc: d, tick: s.tick }); if (a.social.ate.length > 6) a.social.ate.shift(); } }   // 一次决策里连续的几口算同一餐
            if (a.pending) {
              // 延迟世界：食物立即从场中消失；效果在 delay.ticks 之后才作用于个体，其间收益记为“在途”。
              const due = s.tick + this.delayOf(a, idx);
              if (factor >= 0) { a.pending.push({ due, amount: amount * factor }); s.ledger.semanticLoss! += amount * (1 - factor); this.emit('ate', { agentId: a.id, amount: amount * factor }); }
              else { a.pending.push({ due, amount: -(amount * -factor) }); s.ledger.semanticLoss! += amount; this.emit('ate', { agentId: a.id, amount: amount * -factor, reason: 'toxic' }); }
            }
            else if (factor >= 0) { a.energy += amount * factor; s.ledger.semanticLoss! += amount * (1 - factor); s.metrics.eaten += amount * factor; this.noteEffect(a, amount * factor); this.emit('ate', { agentId: a.id, amount: amount * factor }); }
            else { const harm = Math.min(a.energy, amount * -factor); a.energy -= harm; s.ledger.semanticLoss! += amount + harm; this.noteEffect(a, -harm); this.emit('ate', { agentId: a.id, amount: harm, reason: 'toxic' }); }
          }
          else { s.food[cell] -= amount; a.energy += amount; s.metrics.eaten += amount; this.emit('ate', { agentId: a.id, amount }); }
        }
        if (a.pending) this.settle(a);
        this.spend(a, this.metabolism(a), 'metabolism');
        s.metrics.agentTicks++; if (a.energy < this.capacity(a) * .25) s.metrics.lowEnergyTicks++;
        if (a.energy <= 1e-10 || s.tick - a.born >= c.maxAge) this.die(a, a.energy <= 1e-10 ? 'starvation' : 'age');
      }
      s.agents = s.agents.filter(a => s.lineage.find(l => l.id === a.id)!.died === null);
      // 一次性提案仅在第一个子步结算；出生体从下一个子步起支付代谢。
      if (s.tick === startTick + 1) {
        for (const a of aliveAtStart) if (actions.get(a.id) === 'reproduce' && s.agents.includes(a)) {
          const place = this.childPlace(a);
          if (this.canReproduce(a) && place) {
            a.energy -= c.birthEnergy; this.spend(a, c.birthCost, 'reproduction'); a.lastBirth = s.tick;
            const child = this.addAgent(place[0], place[1], c.birthEnergy, a); s.metrics.births++;
            this.emit('born', { agentId: child.id, targetId: a.id, amount: c.birthEnergy });
          } else {
            if (s.agents.length >= c.maxAgents) s.metrics.populationCapHits++;
            if (s.lineage.length >= c.maxLineage) s.metrics.lineageCapHits++;
            this.reject(a, 'reproduction_conditions_changed', resultById);
          }
          actions.set(a.id, 'rest');
        }
      }
      for (const a of aliveAtStart) {
        const outcome = resultById.get(a.id); if (!outcome || outcome.terminated) continue;
        const died = !s.agents.includes(a), reward = (a.energy - beforeEnergy.get(a.id)!) / 10 - (died ? 1 : 0);
        outcome.rewards.push(reward); outcome.reward += reward; outcome.energyAfter = a.energy; outcome.endTick = s.tick; outcome.terminated = died;
      }
    }
    for (const o of outcomes) o.truncated = !o.terminated && s.tick >= c.horizon;
    this.refreshMemories(); this.pending = null; this.attempts.clear(); this.assertValid();
    const events = this.roundEvents; this.roundEvents = null;
    if (this.lean) return { accepted: true, outcomes, events };
    return { accepted: true, requests, proposals: requests.map(r => clone(byId.get(r.identity.agentId)!)), outcomes,
      events, beforeHash, afterHash: stateHash(s), snapshot: this.snapshot() };
  }
  private reject(a: Agent, reason: string, outcomes: Map<string, Outcome>): void {
    if (a.lastRejected) return;
    a.lastRejected = true; const result = outcomes.get(a.id); if (result) result.rejected = true;
    this.state.metrics.rejected++; this.emit('rejected', { agentId: a.id, reason });
  }
  intervene(command: Intervention): void {
    const s = this.state, c = s.config;
    if (!command || !Number.isFinite(command.x) || !Number.isFinite(command.y) || command.x < 0 || command.y < 0 || command.x >= c.width || command.y >= c.height) throw Error('invalid_intervention');
    const cell = this.cell(command.x, command.y);
    if (command.kind === 'nutrient') {
      if (!Number.isFinite(command.amount) || command.amount <= 0 || command.amount > 10000 || s.obstacles[cell]) throw Error('invalid_nutrient');
      const received = this.addFood(cell, command.amount);
      s.ledger.supplied += command.amount; s.ledger.overflow += command.amount - received; this.emit('nutrient', { amount: received });
    } else if (command.kind === 'obstacle') {
      if (typeof command.blocked !== 'boolean' || (command.blocked && s.agents.some(a => this.cell(a.x, a.y) === cell))) throw Error('occupied_obstacle');
      if (command.blocked) { s.ledger.overflow += s.food[cell]; s.food[cell] = 0; if (s.kinds) s.kinds[cell] = -1; }
      s.obstacles[cell] = command.blocked; this.emit(command.blocked ? 'obstacle_added' : 'obstacle_removed');
    } else throw Error('unknown_intervention');
    this.cancel(); this.refreshMemories(); this.assertValid();
  }
  restore(snapshot: Snapshot): void {
    if (!snapshot || snapshot.version !== ECOLOGY_VERSION) throw Error('snapshot_version');
    validateConfig(snapshot.config);
    const old = this.state; this.state = clone(snapshot);
    try { this.assertValid(); } catch (error) { this.state = old; throw error; }
    this.generation++; this.pending = null; this.attempts.clear();
  }
  assertValid(): void {
    const s = this.state, c = s.config;
    if (s.food.length !== c.width * c.height || s.obstacles.length !== s.food.length || s.obstacles.some(b => typeof b !== 'boolean') || s.food.some((n, i) => !Number.isFinite(n) || n < -1e-9 || n > c.cellCapacity + 1e-8 || (s.obstacles[i] && n !== 0))) throw Error('invalid_field');
    if (!Number.isInteger(s.tick) || s.tick < 0 || s.tick > c.horizon || !Number.isInteger(s.epoch) || s.epoch < 0 || !Number.isInteger(s.nextId) || s.nextId < c.initialAgents || s.nextId !== s.lineage.length || !Number.isInteger(s.nextEvent) || s.nextEvent < 0) throw Error('invalid_clock_or_identity');
    if (Object.keys(s.rng).sort().join() !== 'environment,genetics,placement' || Object.values(s.rng).some(n => !Number.isInteger(n) || n < 1 || n > 0xffffffff)) throw Error('invalid_rng');
    if (s.agents.length > c.maxAgents || s.lineage.length > c.maxLineage || s.events.length > c.maxEvents || new Set(s.agents.map(a => a.id)).size !== s.agents.length || new Set(s.lineage.map(l => l.id)).size !== s.lineage.length) throw Error('identity_or_capacity');
    if (c.semantic ? !Array.isArray(s.kinds) || s.kinds.length !== s.food.length || s.kinds.some((k, i) => !Number.isInteger(k) || k < -1 || k >= c.semantic!.kinds.length || (k < 0 && s.food[i] > 1e-6)) : s.kinds !== undefined) throw Error('invalid_semantic_state');
    const lineage = new Map(s.lineage.map(l => [l.id, l]));
    for (let i = 0; i < s.lineage.length; i++) {
      const l = s.lineage[i], parent = l.parentId ? lineage.get(l.parentId) : undefined;
      if (l.id !== `life-${i}` || !Number.isInteger(l.born) || l.born < 0 || l.born > s.tick || (l.died !== null && (!Number.isInteger(l.died) || l.died < l.born || l.died > s.tick)) || (l.parentId && (!parent || parent.born > l.born || l.generation !== parent.generation + 1)) || (!l.parentId && l.generation !== 0) || ![0, 1, 2].includes(l.shape)) throw Error('invalid_lineage');
    }
    for (const a of s.agents) {
      const l = lineage.get(a.id);
      if (!l || l.died !== null || l.born !== a.born || l.parentId !== a.parentId || l.generation !== a.generation || l.shape !== a.shape || !Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(a.heading) || this.blocked(a.x, a.y) || !Number.isFinite(a.energy) || a.energy <= 0 || a.energy > this.capacity(a) + 1e-8 || !Number.isInteger(a.lastBirth) || a.lastBirth < a.born || a.lastBirth > s.tick || !ACTIONS.includes(a.lastAction) || typeof a.lastRejected !== 'boolean') throw Error('invalid_agent');
      for (const key of Object.keys(traitBounds) as (keyof Traits)[]) if (!Number.isFinite(a.traits[key]) || a.traits[key] < traitBounds[key][0] || a.traits[key] > traitBounds[key][1]) throw Error('invalid_trait');
      if (a.memory.length > c.memorySize || a.memory.some(m => !Number.isFinite(m.x) || !Number.isFinite(m.y) || m.x < 0 || m.y < 0 || m.x >= c.width || m.y >= c.height || !Number.isFinite(m.food) || m.food < 0 || m.food > c.cellCapacity + 1e-8 || !Number.isInteger(m.tick) || m.tick < a.born || m.tick > s.tick || s.tick - m.tick > c.memoryTtl)) throw Error('invalid_memory');
    }
    if (s.lineage.filter(l => l.died === null).length !== s.agents.length || s.metrics.births !== s.lineage.length - c.initialAgents || s.metrics.deaths !== s.lineage.filter(l => l.died !== null).length) throw Error('invalid_population_metrics');
    if (s.events.some((e, i) => !Number.isInteger(e.seq) || e.seq !== s.nextEvent - s.events.length + i || !Number.isInteger(e.tick) || e.tick < 0 || e.tick > s.tick || typeof e.kind !== 'string' || (e.amount !== undefined && (!Number.isFinite(e.amount) || e.amount < 0)))) throw Error('invalid_events');
    if (Object.keys(s.ledger).sort().join() !== (c.semantic ? 'deathLoss,decay,initial,metabolism,movement,overflow,reproduction,semanticLoss,supplied' : 'deathLoss,decay,initial,metabolism,movement,overflow,reproduction,supplied') || Object.keys(s.metrics).sort().join() !== 'agentTicks,births,deaths,distance,eaten,lineageCapHits,lowEnergyTicks,populationCapHits,rejected' || Object.values(s.ledger).some(n => !Number.isFinite(n) || n < -1e-8) || Object.values(s.metrics).some(n => !Number.isFinite(n) || n < 0)) throw Error('invalid_accounting');
    const { initial, supplied, ...losses } = s.ledger;
    const inTransit = sum(s.agents.map(a => sum((a.pending ?? []).filter(p => p.amount > 0).map(p => p.amount))));
    const error = sum(s.food) + sum(s.agents.map(a => a.energy)) + inTransit + sum(Object.values(losses)) - initial - supplied;
    if (Math.abs(error) > 1e-7 * Math.max(1, initial + supplied)) throw Error(`energy_ledger:${error}`);
  }
}
