// 舞台渲染器：只读消费快照。相机、营养热度纹理、生命、选中叠加、指针交互。
// 不持有也不修改世界状态；放置营养/障碍只通过 onPlace 回调交给 Worker 命令。
import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Snapshot } from '../../packages/sim/ecology.ts';
import { DIRECTIONS, type Action } from '../../packages/protocol/ecology.ts';
import { kindStyle } from './kinds';

export type Tool = 'observe' | 'nutrient' | 'obstacle' | 'erase';
/** 选中个体最近一次已执行决策的可视化所需部分（来自记录，不含推测）。 */
export type StageDecision = { agentId: string; chosen: Action; distribution?: Partial<Record<Action, number>> };
export type StageProps = {
  decision: StageDecision | null;
  /** 对照分支在同一模拟时刻的位置（只读幽灵）；null 表示不对照。 */
  ghosts: { id: string; x: number; y: number; shape: number; heading: number }[] | null;
  /** 仅在世界实际运行时为 true：装饰性连续摆动只在此时播放，暂停/回看时画面静止。 */
  animate: boolean;
  snapshot: Snapshot; selected: string | null; following: boolean; resources: boolean; trails: boolean; reduceMotion: boolean; tool: Tool;
  /** 画布四周被浮层占用的像素，适配视野时避开。 */
  insets: { top: number; bottom: number; left: number; right: number };
  fitKey: number;
  /** 观察者信息：个体 id → 先天类型序号（色环）；null 表示没有分类型 */
  innate?: Record<string, number> | null;
};
export type StageEvents = { onSelect: (id: string | null) => void; onPlace: (x: number, y: number) => void; onUserCamera: () => void; onFrame: (ms: number, zoom: number) => void;
  /** 每帧报告选中个体的屏幕位置（像素，相对画布）；未选中或不在场时 visible=false。 */
  onAnchor: (x: number, y: number, radius: number, visible: boolean) => void };

/** 语义缩放阈值（每世界单位的像素数）：低于 FAR 只画简化标记，高于 NEAR 显示决策箭头。 */
export const FAR = 26, NEAR = 56;
export const TYPE_RING = [0xf0b35a, 0x8fd0ff];
export const SHAPE_COLORS = [0xadd6b3, 0x90c9d8, 0xd7c493];
/** 营养参考上限（单格）：固定值，使不同时刻/不同分支的颜色可比。 */
export const FIELD_REF = 5;
const FIELD_STOPS: [number, [number, number, number]][] = [[0, [10, 24, 28]], [0.3, [22, 54, 54]], [0.62, [86, 120, 84]], [1, [214, 196, 124]]];
function fieldColor(t: number): [number, number, number] {
  for (let i = 1; i < FIELD_STOPS.length; i++) {
    const [t1, c1] = FIELD_STOPS[i]; if (t <= t1) {
      const [t0, c0] = FIELD_STOPS[i - 1], k = (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return FIELD_STOPS.at(-1)![1];
}
/** 等高线层级（单格营养量）。 */
const CONTOURS = [0.5, 1.5, 3.5];
type Segment = [number, number, number, number];
/** 行进方块法：在格心网格上提取等值线段，线性插值。网格很小，仅在快照变化时计算一次。 */
function contourSegments(food: number[], w: number, h: number, blocked: boolean[], level: number): Segment[] {
  const out: Segment[] = [], v = (x: number, y: number) => blocked[y * w + x] ? 0 : food[y * w + x];
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const a = v(x, y), b = v(x + 1, y), c = v(x + 1, y + 1), d = v(x, y + 1);
    const code = (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (d >= level ? 8 : 0);
    if (code === 0 || code === 15) continue;
    const t = (p: number, q: number) => (level - p) / (q - p || 1e-9);
    const top: [number, number] = [x + .5 + t(a, b), y + .5], right: [number, number] = [x + 1.5, y + .5 + t(b, c)];
    const bottom: [number, number] = [x + .5 + t(d, c), y + 1.5], left: [number, number] = [x + .5, y + .5 + t(a, d)];
    const E: Record<string, [number, number][]> = { top: [top], right: [right], bottom: [bottom], left: [left] };
    const pairs: [keyof typeof E, keyof typeof E][] = ({ 1: [['left', 'top']], 2: [['top', 'right']], 3: [['left', 'right']], 4: [['right', 'bottom']], 5: [['left', 'top'], ['right', 'bottom']], 6: [['top', 'bottom']], 7: [['left', 'bottom']],
      8: [['left', 'bottom']], 9: [['top', 'bottom']], 10: [['left', 'bottom'], ['top', 'right']], 11: [['right', 'bottom']], 12: [['left', 'right']], 13: [['top', 'right']], 14: [['left', 'top']] } as Record<number, [keyof typeof E, keyof typeof E][]>)[code];
    for (const [p, q] of pairs) out.push([E[p][0][0], E[p][0][1], E[q][0][0], E[q][0][1]]);
  }
  return out;
}

export class StageRenderer {
  private app = new Application();
  private world = new Container();
  private field = new Sprite();
  private fieldCanvas = document.createElement('canvas');
  private fieldTexture: Texture | null = null;
  private fieldSource: Snapshot | null = null;
  private overlay = new Graphics();
  private bodies = new Graphics();
  private props: StageProps;
  private ready = false;
  private disposed = false;
  private cam = { x: 0, y: 0, zoom: 1 }; // x,y：世界坐标中的视野中心；zoom：相对适配比例
  private fitKey = -1;
  private last: Snapshot;
  private previous = new Map<string, { x: number; y: number }>();
  private changedAt = 0;
  private trailPoints = new Map<string, { x: number; y: number }[]>();
  private trailRun = '';
  private ghosts: { x: number; y: number; shape: number; at: number }[] = [];
  private frameSum = 0; private frames = 0; private reportedZoom = 1;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private cleanup: (() => void)[] = [];

  constructor(private host: HTMLElement, props: StageProps, private events: StageEvents) { this.props = props; this.last = props.snapshot; }

  async init() {
    await this.app.init({ resizeTo: this.host, backgroundAlpha: 0, antialias: true, resolution: Math.min(devicePixelRatio, 2), autoDensity: true, preference: 'webgl' });
    if (this.disposed) { this.app.destroy(true); return; }
    this.host.appendChild(this.app.canvas);
    this.world.addChild(this.field, this.overlay, this.bodies); this.app.stage.addChild(this.world);
    this.app.ticker.add(() => this.draw());
    const canvas = this.app.canvas, local = (e: PointerEvent | WheelEvent) => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
    const down = (e: PointerEvent) => { const p = local(e); this.drag = { x: p.x, y: p.y, moved: false }; canvas.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (!this.drag || this.props.tool !== 'observe') return;
      const p = local(e), dx = p.x - this.drag.x, dy = p.y - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) < 4) return;
      this.drag.moved = true; this.events.onUserCamera();
      const s = this.scale(); this.cam.x -= dx / s; this.cam.y -= dy / s; this.drag.x = p.x; this.drag.y = p.y;
    };
    const up = (e: PointerEvent) => {
      const d = this.drag; this.drag = null; if (!d || d.moved) return;
      const p = local(e), w = this.toWorld(p.x, p.y);
      if (this.props.tool !== 'observe') { this.events.onPlace(w.x, w.y); return; }
      const near = this.props.snapshot.agents.map(a => ({ a, d: Math.hypot(a.x - w.x, a.y - w.y) })).sort((x, y) => x.d - y.d)[0];
      this.events.onSelect(near && near.d < Math.max(.8, 14 / this.scale()) ? near.a.id : null);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault(); const p = local(e), before = this.toWorld(p.x, p.y);
      this.cam.zoom = Math.max(.5, Math.min(12, this.cam.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const after = this.toWorld(p.x, p.y); this.cam.x += before.x - after.x; this.cam.y += before.y - after.y; this.events.onUserCamera();
    };
    const cancel = () => { this.drag = null; };
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', cancel); canvas.addEventListener('wheel', wheel, { passive: false });
    this.cleanup.push(() => { canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', cancel); canvas.removeEventListener('wheel', wheel); });
    this.ready = true;
  }
  update(props: StageProps) { if (props.resources !== this.props.resources) this.fieldSource = null; this.props = props; }
  /** 缩放比例：每个世界单位对应的像素数（适配比例 × 用户缩放）。 */
  scale(): number {
    const { width, height } = this.app.screen, c = this.props.snapshot.config, i = this.props.insets;
    return Math.min(Math.max(80, width - i.left - i.right) / c.width, Math.max(80, height - i.top - i.bottom) / c.height) * this.cam.zoom;
  }
  private center() { const { width, height } = this.app.screen, i = this.props.insets; return { x: i.left + (width - i.left - i.right) / 2, y: i.top + (height - i.top - i.bottom) / 2 }; }
  private toWorld(px: number, py: number) { const s = this.scale(), c = this.center(); return { x: this.cam.x + (px - c.x) / s, y: this.cam.y + (py - c.y) / s }; }
  fit() { const c = this.props.snapshot.config; this.cam = { x: c.width / 2, y: c.height / 2, zoom: 1 }; }
  zoomBy(factor: number) { this.cam.zoom = Math.max(.5, Math.min(12, this.cam.zoom * factor)); }
  get zoom() { return this.cam.zoom; }

  private contours: { level: number; segments: Segment[] }[] = [];
  private refreshField(s: Snapshot) {
    const c = s.config, K = 6, W = c.width * K, H = c.height * K;
    if (!this.fieldTexture || this.fieldCanvas.width !== W || this.fieldCanvas.height !== H) {
      this.fieldCanvas.width = W; this.fieldCanvas.height = H;
      this.fieldTexture?.destroy(true); this.fieldTexture = Texture.from(this.fieldCanvas); this.fieldTexture.source.scaleMode = 'linear'; this.field.texture = this.fieldTexture;
    }
    const ctx = this.fieldCanvas.getContext('2d')!, image = ctx.createImageData(W, H), show = this.props.resources;
    const at = (x: number, y: number) => { const cx = Math.max(0, Math.min(c.width - 1, x)), cy = Math.max(0, Math.min(c.height - 1, y)), i = cy * c.width + cx; return s.obstacles[i] ? 0 : s.food[i]; };
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      const gx = (px + .5) / K - .5, gy = (py + .5) / K - .5, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
      const f = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
      const [r, g, b] = fieldColor(show ? Math.min(1, Math.sqrt(f / FIELD_REF)) : 0);
      image.data.set([r, g, b, 255], (py * W + px) * 4);
    }
    ctx.putImageData(image, 0, 0); this.fieldTexture.source.update(); this.fieldSource = s;
    this.field.width = c.width; this.field.height = c.height;
    this.contours = CONTOURS.map(level => ({ level, segments: contourSegments(s.food, c.width, c.height, s.obstacles, level) }));
  }

  private draw() {
    if (!this.ready) return;
    const started = performance.now(), p = this.props, s = p.snapshot, c = s.config, reduce = p.reduceMotion || this.reduced.matches;
    if (s !== this.last) {
      if (s.config.runId !== this.last.config.runId || s.tick < this.last.tick) { this.trailPoints.clear(); this.ghosts = []; this.previous = new Map(s.agents.map(a => [a.id, a])); }
      else {
        this.previous = new Map(this.last.agents.map(a => [a.id, a]));
        // 连续推进时消失的个体：在其最后位置留下淡出的痕迹（来自相邻快照的差异，不是新事件）。
        if (s.tick - this.last.tick <= 40) { const alive = new Set(s.agents.map(a => a.id)); for (const o of this.last.agents) if (!alive.has(o.id)) this.ghosts.push({ x: o.x, y: o.y, shape: o.shape, at: started }); }
      }
      this.last = s; this.changedAt = started;
      if (p.trails) for (const a of s.agents) { const t = this.trailPoints.get(a.id) ?? []; t.push({ x: a.x, y: a.y }); if (t.length > 40) t.shift(); this.trailPoints.set(a.id, t); }
    }
    if (this.fitKey !== p.fitKey) { this.fit(); this.fitKey = p.fitKey; }
    if (this.fieldSource !== s || !this.fieldTexture) this.refreshField(s);
    const blend = reduce ? 1 : Math.min(1, (started - this.changedAt) / 180);
    const agents = s.agents.map(a => { const o = this.previous.get(a.id) ?? a; return { ...a, x: o.x + (a.x - o.x) * blend, y: o.y + (a.y - o.y) * blend }; });
    const sel = agents.find(a => a.id === p.selected);
    if (p.following && sel) { this.cam.x += (sel.x - this.cam.x) * .2; this.cam.y += (sel.y - this.cam.y) * .2; }
    const scale = this.scale(), ctr = this.center();
    this.world.scale.set(scale); this.world.position.set(ctr.x - this.cam.x * scale, ctr.y - this.cam.y * scale);

    const g = this.overlay; g.clear();
    g.roundRect(-.15, -.15, c.width + .3, c.height + .3, .3).stroke({ color: 0x4f7770, alpha: .55, width: 1.2 / scale });
    if (p.resources) this.contours.forEach((layer, i) => { for (const [x1, y1, x2, y2] of layer.segments) g.moveTo(x1, y1).lineTo(x2, y2); g.stroke({ color: 0xe9e2b0, alpha: .10 + i * .07, width: 1 / scale }); });
    const nowMs = performance.now(); this.ghosts = this.ghosts.filter(gh => nowMs - gh.at < 4000);
    for (const gh of this.ghosts) { const k = (nowMs - gh.at) / 4000; g.circle(gh.x, gh.y, .3 + k * .5).stroke({ color: 0xe49a8a, alpha: .6 * (1 - k), width: 1.4 / scale }); }
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (s.obstacles[y * c.width + x]) g.roundRect(x + .05, y + .05, .9, .9, .14).fill(0x3a4b4a).stroke({ color: 0x86a39b, width: 1.1 / scale });
    if (p.resources && s.kinds) for (let i = 0; i < s.kinds.length; i++) {
      const k = s.kinds[i]; if (k < 0 || s.food[i] <= .05 || s.obstacles[i]) continue;
      const st = kindStyle(k), cx = i % c.width + .5, cy = Math.floor(i / c.width) + .5, r = .1 + Math.min(.24, Math.sqrt(s.food[i]) * .09);
      if (st.shape === 'circle') g.circle(cx, cy, r); else if (st.shape === 'square') g.rect(cx - r, cy - r, r * 2, r * 2);
      else if (st.shape === 'diamond') g.poly([cx, cy - r * 1.3, cx + r * 1.3, cy, cx, cy + r * 1.3, cx - r * 1.3, cy]); else g.poly([cx, cy - r * 1.3, cx + r * 1.2, cy + r, cx - r * 1.2, cy + r]);
      g.fill({ color: st.color, alpha: .9 }).stroke({ color: 0x0b1619, alpha: .6, width: 1 / scale });
    }
    if (p.trails) for (const a of agents) { const t = this.trailPoints.get(a.id); if (!t || t.length < 2) continue; g.moveTo(t[0].x, t[0].y); for (const q of t.slice(1)) g.lineTo(q.x, q.y); g.stroke({ color: SHAPE_COLORS[a.shape], alpha: .22, width: 1.4 / scale }); }
    const b = this.bodies; b.clear();
    if (p.ghosts) {
      const now = new Map(agents.map(a => [a.id, a]));
      for (const gh of p.ghosts) {
        const live = now.get(gh.id), r = .4;
        if (live && Math.hypot(live.x - gh.x, live.y - gh.y) > .15) b.moveTo(gh.x, gh.y).lineTo(live.x, live.y).stroke({ color: 0xc9b7e6, alpha: .35, width: 1 / scale });
        b.circle(gh.x, gh.y, r).stroke({ color: 0xc9b7e6, alpha: .8, width: 1.4 / scale });
        const hx = gh.x + Math.cos(gh.heading) * r * 1.5, hy = gh.y + Math.sin(gh.heading) * r * 1.5; b.moveTo(gh.x, gh.y).lineTo(hx, hy).stroke({ color: 0xc9b7e6, alpha: .7, width: 1.2 / scale });
      }
    }
    for (const a of agents) {
      if (scale < FAR) this.drawMarker(b, a, scale, a.id === p.selected);
      else this.drawAgent(b, a, s, reduce || !p.animate ? 0 : performance.now() / 60, a.id === p.selected, scale);
      const ty = p.innate?.[a.id]; if (ty !== undefined) b.circle(a.x, a.y, scale < FAR ? Math.max(.22, 5 / scale) * 1.7 : .44 * a.traits.size * 1.35).stroke({ color: TYPE_RING[ty] ?? 0xffffff, alpha: .95, width: 2 / scale });
    }
    if (sel) this.drawAnnotations(b, sel, s, scale, p.decision?.agentId === sel.id ? p.decision : null);
    if (sel) this.events.onAnchor(ctr.x + (sel.x - this.cam.x) * scale, ctr.y + (sel.y - this.cam.y) * scale, .36 * sel.traits.size * scale, true);
    else this.events.onAnchor(0, 0, 0, false);
    if (!s.agents.length) { /* 灭绝：保留空水域，提示由 HUD 负责 */ }
    this.frameSum += performance.now() - started; this.frames++;
    if (this.frames === 90 || this.cam.zoom !== this.reportedZoom) { this.reportedZoom = this.cam.zoom; this.events.onFrame(this.frameSum / Math.max(1, this.frames), this.cam.zoom); this.frameSum = 0; this.frames = 0; }
  }

  /** 远景：体型用形状区分（圆 / 三角 / 圆角条），颜色表示体型家族；不画细节。 */
  private drawMarker(g: Graphics, a: Snapshot['agents'][number], scale: number, selected: boolean) {
    const color = SHAPE_COLORS[a.shape], r = Math.max(.22, 5 / scale), cos = Math.cos(a.heading), sin = Math.sin(a.heading);
    const pt = (x: number, y: number) => ({ x: a.x + x * cos - y * sin, y: a.y + x * sin + y * cos });
    if (selected) g.circle(a.x, a.y, r * 2.2).stroke({ color: 0xf3f1d6, alpha: .85, width: 1.4 / scale });
    if (a.shape === 0) g.circle(a.x, a.y, r).fill({ color, alpha: .85 });
    else if (a.shape === 1) { const t = pt(r * 1.5, 0), l = pt(-r, -r * .9), m = pt(-r, r * .9); g.poly([t.x, t.y, l.x, l.y, m.x, m.y]).fill({ color, alpha: .85 }); }
    else { const c1 = pt(-r * .9, 0), c2 = pt(r * .9, 0); g.moveTo(c1.x, c1.y).lineTo(c2.x, c2.y).stroke({ color, alpha: .9, width: r * 1.6, cap: 'round' }); }
  }

  /** 近景标注：记忆点、视野内食物、动作倾向箭头。只用快照与记录里的内容。 */
  private drawAnnotations(g: Graphics, a: Snapshot['agents'][number], s: Snapshot, scale: number, decision: StageDecision | null) {
    const c = s.config, per = a.traits.perception;
    // 记忆点：空心菱形，越旧越淡
    for (const m of a.memory) {
      const age = Math.min(1, (s.tick - m.tick) / c.memoryTtl), r = .16;
      g.moveTo(m.x, m.y - r).lineTo(m.x + r, m.y).lineTo(m.x, m.y + r).lineTo(m.x - r, m.y).closePath().stroke({ color: 0xe6d29a, alpha: .85 - .6 * age, width: 1.2 / scale });
    }
    if (scale < NEAR * .75) return;
    // 视野内有食物的格子：细环
    for (let y = Math.max(0, Math.floor(a.y - per)); y <= Math.min(c.height - 1, Math.ceil(a.y + per)); y++) for (let x = Math.max(0, Math.floor(a.x - per)); x <= Math.min(c.width - 1, Math.ceil(a.x + per)); x++) {
      const i = y * c.width + x; if (s.obstacles[i] || s.food[i] < .05 || Math.hypot(x + .5 - a.x, y + .5 - a.y) > per) continue;
      g.circle(x + .5, y + .5, .22).stroke({ color: 0xdfe6a0, alpha: .55, width: 1 / scale });
    }
    if (!decision) return;
    // 动作倾向：四向箭头，长度随执行策略概率；实际选择加粗高亮。无概率（规则/随机）时只画实际选择。
    const moves: Action[] = ['north', 'east', 'south', 'west'];
    for (const act of moves) {
      const p = decision.distribution?.[act]; const chosen = decision.chosen === act;
      if (p === undefined && !chosen) continue;
      const len = .45 + (p ?? .5) * 1.6, [dx, dy] = DIRECTIONS[act], ex = a.x + dx * len, ey = a.y + dy * len;
      g.moveTo(a.x + dx * .45, a.y + dy * .45).lineTo(ex, ey).stroke({ color: chosen ? 0xf3f1d6 : 0xa9cbb4, alpha: chosen ? .95 : .45, width: (chosen ? 2.6 : 1.4) / scale });
      g.poly([ex + dx * .14, ey + dy * .14, ex - dy * .09, ey + dx * .09, ex + dy * .09, ey - dx * .09]).fill({ color: chosen ? 0xf3f1d6 : 0xa9cbb4, alpha: chosen ? .95 : .5 });
    }
  }

  private drawAgent(g: Graphics, a: Snapshot['agents'][number], s: Snapshot, tick: number, selected: boolean, scale: number) {
    const c = s.config, r = .44 * a.traits.size, color = SHAPE_COLORS[a.shape], energy = a.energy / (c.capacity * a.traits.size);
    const cos = Math.cos(a.heading), sin = Math.sin(a.heading), pt = (x: number, y: number) => ({ x: a.x + x * cos - y * sin, y: a.y + x * sin + y * cos });
    if (selected) {
      g.circle(a.x, a.y, a.traits.perception).stroke({ color, alpha: .35, width: 1.2 / scale }).fill({ color, alpha: .04 });
      g.circle(a.x, a.y, r * 2.1).stroke({ color: 0xf3f1d6, alpha: .85, width: 1.4 / scale });
    }
    g.circle(a.x, a.y, r * 1.9).fill({ color, alpha: .06 });
    // 能量弧：与体型无关的统一编码（弧长=能量占容量比例，低能量转暖色）
    const arcStart = -Math.PI / 2, arcEnd = arcStart + Math.PI * 2 * Math.max(.02, Math.min(1, energy));
    g.moveTo(a.x + Math.cos(arcStart) * r * 1.55, a.y + Math.sin(arcStart) * r * 1.55).arc(a.x, a.y, r * 1.55, arcStart, arcEnd).stroke({ color: energy < .25 ? 0xf0ad90 : 0xcfe3c8, alpha: .55, width: 1.6 / scale });
    if (a.shape === 0) {
      for (let i = 0; i < 18; i++) {
        const ang = i / 18 * Math.PI * 2, size = r * (1 + Math.sin(ang * 3 + Number(a.id.slice(5)) + tick / 30) * .12), q = pt(Math.cos(ang) * size, Math.sin(ang) * size);
        if (i === 0) g.moveTo(q.x, q.y); else g.lineTo(q.x, q.y);
      }
      g.closePath().fill({ color, alpha: .22 + energy * .22 }).stroke({ color, alpha: .9, width: 1.5 / scale });
    } else if (a.shape === 1) {
      const left = pt(-r, 0), tip = pt(r * 1.25, 0), top = pt(0, -r * .8), bottom = pt(0, r * .8);
      g.moveTo(left.x, left.y).quadraticCurveTo(top.x, top.y, tip.x, tip.y).quadraticCurveTo(bottom.x, bottom.y, left.x, left.y).fill({ color, alpha: .38 }).stroke({ color, alpha: .9, width: 1.5 / scale });
      const end = pt(-r * 2.8, .12 * Math.sin(tick / 4)), bend = pt(-r * 1.9, -.15 * Math.sin(tick / 4 + 1));
      g.moveTo(left.x, left.y).quadraticCurveTo(bend.x, bend.y, end.x, end.y).stroke({ color, alpha: .7, width: 2 / scale });
    } else {
      for (let i = 3; i >= 0; i--) { const q = pt(r * .5 - i * r * .55, Math.sin(tick / 6 - i) * .05); g.circle(q.x, q.y, r * (.75 - i * .1)).fill({ color, alpha: .25 + .03 * i }).stroke({ color, alpha: .85, width: 1.4 / scale }); }
    }
    const n = pt(r * .15, 0); g.circle(n.x, n.y, r * .3).fill({ color, alpha: .5 + energy * .4 });
    if (a.lastAction === 'eat') g.circle(a.x, a.y, r * 1.4).stroke({ color: 0xf0d695, alpha: .6, width: 1.4 / scale });
  }

  destroy() {
    this.disposed = true; this.cleanup.forEach(f => f());
    if (this.ready) { this.app.destroy(true, { children: true }); this.ready = false; }
  }
}
