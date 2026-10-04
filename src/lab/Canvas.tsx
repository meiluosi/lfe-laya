import { useEffect, useRef, useState } from 'react';
import { Application, Container, Graphics } from 'pixi.js';
import type { Snapshot } from '../../packages/sim/ecology.ts';
export type Tool = 'observe' | 'nutrient' | 'obstacle' | 'erase';
type Props = { snapshot: Snapshot; selected: string | null; following: boolean; resources: boolean; reduceMotion: boolean; zoom: number; fitKey: number; tool: Tool;
  onSelect: (id: string) => void; onPan: () => void; onZoom: (delta: number) => void; onPlace: (x: number, y: number) => void; onFrame: (ms: number) => void };
const colors = [0xadd6b3, 0x90c9d8, 0xd7c493];
export function EcologyCanvas(props: Props) {
  const host = useRef<HTMLDivElement>(null), latest = useRef(props); latest.current = props;
  const [error, setError] = useState('');
  useEffect(() => {
    const app = new Application(); let disposed = false, cleanup = () => {};
    (async () => {
      const node = host.current!;
      await app.init({ resizeTo: node, backgroundAlpha: 0, antialias: true, resolution: Math.min(devicePixelRatio, 2), autoDensity: true, preference: 'webgl' });
      if (disposed) { app.destroy(true); return; }
      node.appendChild(app.canvas);
      const root = new Container(), g = new Graphics(); root.addChild(g); app.stage.addChild(root);
      let pan = { x: 0, y: 0 }, down = { x: 0, y: 0 }, dragging = false, moved = false, fitKey = -1;
      let frameSum = 0, frames = 0;
      const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
      let lastSnapshot = latest.current.snapshot, previousAgents = new Map(lastSnapshot.agents.map(a => [a.id, a])), changedAt = performance.now();
      const draw = () => {
        const started = performance.now(), p = latest.current, s = p.snapshot, c = s.config;
        if (s !== lastSnapshot) {
          previousAgents = new Map((s.config.runId === lastSnapshot.config.runId && s.tick > lastSnapshot.tick ? lastSnapshot.agents : s.agents).map(a => [a.id, a]));
          lastSnapshot = s; changedAt = started;
        }
        const blend = p.reduceMotion || reducedMotion.matches ? 1 : Math.min(1, (started - changedAt) / 180);
        const shownAgents = s.agents.map(a => { const old = previousAgents.get(a.id) ?? a; return { ...a, x: old.x + (a.x - old.x) * blend, y: old.y + (a.y - old.y) * blend }; });
        const visualTick = p.reduceMotion || reducedMotion.matches ? 0 : s.tick;
        if (fitKey !== p.fitKey) { pan = { x: 0, y: 0 }; fitKey = p.fitKey; }
        const selected = shownAgents.find(a => a.id === p.selected);
        const scale = Math.min((app.screen.width - 48) / c.width, (app.screen.height - 48) / c.height) * p.zoom;
        const focus = p.following && selected ? selected : { x: c.width / 2, y: c.height / 2 };
        root.scale.set(scale); root.position.set(app.screen.width / 2 - focus.x * scale + pan.x, app.screen.height / 2 - focus.y * scale + pan.y);
        g.clear(); g.roundRect(0, 0, c.width, c.height, .7).fill(0x102427).stroke({ color: 0x53746d, alpha: .5, width: 1 / scale });
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
          const index = y * c.width + x;
          if (s.obstacles[index]) g.roundRect(x + .06, y + .06, .88, .88, .12).fill(0x435453).stroke({ color: 0x78908a, width: .025 });
          else if (p.resources && s.food[index] > .03) {
            const density = Math.min(1, s.food[index] / 5), r = .045 + density * .12;
            g.circle(x + .5, y + .5, r * 1.65).fill({ color: 0xafbf7d, alpha: .025 + density * .06 });
            g.circle(x + .5, y + .5, r).fill({ color: 0xc4cb86, alpha: .12 + density * .48 });
            if (s.food[index] > 1) g.circle(x + .34, y + .35, .045).fill({ color: 0xe6dfa3, alpha: .6 });
          } else g.circle(x + .5, y + .5, .013).fill({ color: 0x819b93, alpha: .22 });
        }
        for (const a of shownAgents) {
          const r = .36 * a.traits.size, color = colors[a.shape], energy = a.energy / (c.capacity * a.traits.size);
          const cos = Math.cos(a.heading), sin = Math.sin(a.heading), pt = (x: number, y: number) => ({ x: a.x + x * cos - y * sin, y: a.y + x * sin + y * cos });
          if (a.id === p.selected) {
            g.circle(a.x, a.y, r * 2).stroke({ color: 0xf3f1d6, alpha: .75, width: 1.1 / scale });
            g.circle(a.x, a.y, a.traits.perception).stroke({ color, alpha: .14, width: .7 / scale });
          }
          g.circle(a.x, a.y, r * 1.7).fill({ color, alpha: .035 });
          if (a.shape === 0) {
            for (let i = 0; i < 18; i++) {
              const angle = i / 18 * Math.PI * 2, size = r * (1 + Math.sin(angle * 3 + Number(a.id.slice(5))) * .12), point = pt(Math.cos(angle) * size, Math.sin(angle) * size);
              if (i === 0) g.moveTo(point.x, point.y); else g.lineTo(point.x, point.y);
            }
            g.closePath().fill({ color, alpha: .2 + energy * .2 }).stroke({ color, alpha: .85, width: .027 });
          } else if (a.shape === 1) {
            const left = pt(-r, 0), tip = pt(r * 1.2, 0), top = pt(0, -r * .8), bottom = pt(0, r * .8);
            g.moveTo(left.x, left.y).quadraticCurveTo(top.x, top.y, tip.x, tip.y).quadraticCurveTo(bottom.x, bottom.y, left.x, left.y).fill({ color, alpha: .35 }).stroke({ color, alpha: .85, width: .025 });
            const end = pt(-r * 2.8, .1 * Math.sin(visualTick / 5)), bend = pt(-r * 1.9, -.15);
            g.moveTo(left.x, left.y).quadraticCurveTo(bend.x, bend.y, end.x, end.y).stroke({ color, alpha: .65, width: .035 });
          } else {
            for (let i = 3; i >= 0; i--) {
              const p = pt(r * .5 - i * r * .55, Math.sin(visualTick / 8 - i) * .045);
              g.circle(p.x, p.y, r * (.75 - i * .1)).fill({ color, alpha: .25 + .03 * i }).stroke({ color, alpha: .8, width: .025 });
            }
          }
          const nucleus = pt(r * .15, 0); g.circle(nucleus.x, nucleus.y, r * .3).fill({ color, alpha: .5 + energy * .35 });
          if (a.lastAction === 'eat') g.circle(a.x, a.y, r * 1.35).stroke({ color: 0xf0d695, alpha: .55, width: .025 });
          if (energy < .25) { const point = pt(0, -r * 1.8); g.moveTo(point.x, point.y - .12).lineTo(point.x, point.y + .04).stroke({ color: 0xf0ad90, width: .06 }); }
        }
        frameSum += performance.now() - started; frames++;
        if (frames === 120) { latest.current.onFrame(frameSum / frames); frameSum = 0; frames = 0; }
      };
      app.ticker.add(draw);
      const local = (e: PointerEvent) => { const b = app.canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
      const pointerDown = (e: PointerEvent) => { down = local(e); moved = false; dragging = true; app.canvas.setPointerCapture(e.pointerId); };
      const pointerMove = (e: PointerEvent) => {
        if (!dragging || latest.current.tool !== 'observe') return;
        const point = local(e); if (Math.hypot(point.x - down.x, point.y - down.y) > 3) moved = true;
        if (moved) { latest.current.onPan(); pan.x += point.x - down.x; pan.y += point.y - down.y; down = point; }
      };
      const pointerUp = (e: PointerEvent) => {
        if (!dragging) return; dragging = false; if (moved) return;
        const point = local(e), x = (point.x - root.x) / root.scale.x, y = (point.y - root.y) / root.scale.y, p = latest.current;
        if (p.tool !== 'observe') { p.onPlace(x, y); return; }
        const nearby = p.snapshot.agents.map(a => ({ a, distance: Math.hypot(a.x - x, a.y - y) })).sort((a, b) => a.distance - b.distance)[0];
        if (nearby && nearby.distance < .8) p.onSelect(nearby.a.id);
      };
      const wheel = (e: WheelEvent) => { e.preventDefault(); latest.current.onZoom(e.deltaY < 0 ? .15 : -.15); };
      const cancel = () => { dragging = false; };
      app.canvas.addEventListener('pointerdown', pointerDown); app.canvas.addEventListener('pointermove', pointerMove); app.canvas.addEventListener('pointerup', pointerUp); app.canvas.addEventListener('pointercancel', cancel); app.canvas.addEventListener('wheel', wheel, { passive: false });
      cleanup = () => {
        app.canvas.removeEventListener('pointerdown', pointerDown); app.canvas.removeEventListener('pointermove', pointerMove); app.canvas.removeEventListener('pointerup', pointerUp); app.canvas.removeEventListener('pointercancel', cancel); app.canvas.removeEventListener('wheel', wheel); app.destroy(true, { children: true });
      };
    })().catch(error => { if (!disposed) setError(String(error)); });
    return () => { disposed = true; cleanup(); };
  }, []);
  return <div className="ecology-canvas" ref={host} role="img" aria-label="真实生态画布：点击生命选择，拖动平移，滚轮缩放；也可使用个体列表选择。">{error && <p role="alert">画布初始化失败：{error}</p>}</div>;
}
