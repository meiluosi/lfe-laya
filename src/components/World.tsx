import { useEffect, useRef, useState } from "react";
import { Application, Container, Graphics } from "pixi.js";
import { organisms, positionOf, type Point, type DemoState } from "../demo";
export type WorldProps = {
  tick: number;
  shifted: boolean;
  selected: number | null;
  onSelect: (id: number) => void;
  zoom: number;
  following: boolean;
  resources: boolean;
  state: DemoState;
  tool: "observe" | "nutrient" | "obstacle";
  pending: Point[];
  applied: (Point & { kind: string })[];
  onPlace: (p: Point) => void;
  onPan: () => void;
  onZoom: (delta: number) => void;
  resetKey: number;
};
export function World(props: WorldProps) {
  const host = useRef<HTMLDivElement>(null),
    latest = useRef(props);
  latest.current = props;
  const [error, setError] = useState(false);
  useEffect(() => {
    let stopped = false;
    const app = new Application();
    const node = host.current!;
    const pan = { x: 0, y: 0 };
    let lastReset = props.resetKey,
      dragging = false,
      moved = false,
      down = { x: 0, y: 0 };
    let clean = () => {};
    (async () => {
      await app.init({
        resizeTo: node,
        backgroundAlpha: 0,
        antialias: true,
        resolution: Math.min(devicePixelRatio, 2),
        autoDensity: true,
        preference: "webgl",
      });
      if (stopped) {
        app.destroy(true);
        return;
      }
      node.appendChild(app.canvas);
      const root = new Container(),
        graphics = new Graphics();
      root.addChild(graphics);
      app.stage.addChild(root);
      const transform = () => {
        const p = latest.current;
        if (lastReset !== p.resetKey) {
          pan.x = 0;
          pan.y = 0;
          lastReset = p.resetKey;
        }
        const scale =
          Math.min(app.screen.width / 1020, app.screen.height / 660) * p.zoom;
        let focus = { x: 510, y: 330 };
        if (
          p.following &&
          p.selected &&
          !(p.state === "dead" && p.selected === 17) &&
          p.state !== "extinct"
        )
          focus = positionOf(organisms[p.selected - 1], p.tick);
        root.scale.set(scale);
        root.position.set(
          app.screen.width / 2 - focus.x * scale + pan.x,
          app.screen.height / 2 - focus.y * scale + pan.y,
        );
        return scale;
      };
      const draw = () => {
        const p = latest.current;
        transform();
        graphics.clear();
        graphics
          .roundRect(22, 22, 976, 616, 180)
          .fill({ color: 0x0e2524, alpha: 0.35 })
          .stroke({ color: 0x789b85, alpha: 0.11, width: 1 });
        for (let i = 0; i < 190; i++) {
          graphics
            .circle(
              45 + ((i * 137) % 930),
              45 + ((i * 83) % 570),
              i % 9 === 0 ? 1.7 : 0.75,
            )
            .fill({ color: 0xb5d4c4, alpha: 0.1 + (i % 4) * 0.035 });
        }
        if (p.resources) {
          for (const patch of p.shifted
            ? [
                { x: 775, y: 210 },
                { x: 800, y: 440 },
                { x: 650, y: 120 },
              ]
            : [
                { x: 230, y: 215 },
                { x: 200, y: 440 },
                { x: 350, y: 115 },
              ]) {
            for (let ring = 4; ring > 0; ring--)
              graphics
                .ellipse(patch.x, patch.y, 37 + ring * 15, 23 + ring * 12)
                .fill({ color: 0x819763, alpha: 0.017 });
            for (let j = 0; j < 32; j++)
              graphics
                .circle(
                  patch.x + Math.sin(j * 2.4) * (j * 2.1),
                  patch.y + Math.cos(j * 2.4) * j * 1.2,
                  1.8 + (j % 3),
                )
                .fill({ color: 0xbbbd7c, alpha: 0.18 + (j % 4) * 0.07 });
          }
        }
        for (const point of p.applied) {
          if (point.kind === "obstacle")
            graphics
              .roundRect(point.x - 20, point.y - 8, 40, 16, 7)
              .fill(0x586d65)
              .stroke({ color: 0x99aaa1, width: 1 });
          else {
            graphics
              .circle(point.x, point.y, 33)
              .fill({ color: 0xc5d984, alpha: 0.12 });
            for (let j = 0; j < 12; j++)
              graphics
                .circle(
                  point.x + Math.cos(j * 2) * 20,
                  point.y + Math.sin(j * 2) * 20,
                  2.5,
                )
                .fill({ color: 0xc8d28d, alpha: 0.7 });
          }
        }
        for (const point of p.pending)
          graphics
            .circle(point.x, point.y, 32)
            .fill({ color: 0xd5dfa5, alpha: 0.12 })
            .stroke({ color: 0xd5dfa5, width: 1.5, alpha: 0.8 });
        if (p.state === "extinct") return;
        for (const o of organisms) {
          if (p.state === "dead" && o.id === 17) continue;
          const { x, y } = positionOf(o, p.tick),
            r = o.size;
          if (o.id === p.selected) {
            graphics
              .circle(x, y, o.id === 17 ? 76 : 40 + o.size)
              .fill({ color: 0xbadea7, alpha: 0.025 })
              .stroke({ color: 0xbadea7, alpha: 0.16, width: 1 });
            graphics
              .circle(x, y, r + 14)
              .stroke({ color: 0xd3eabc, alpha: 0.65, width: 1 });
            graphics
              .moveTo(x + r + 20, y)
              .lineTo(x + r + 34, y)
              .stroke({ color: 0xcbe5b6, alpha: 0.7, width: 1 });
          }
          graphics
            .ellipse(x, y, r * 1.8, r * 1.5)
            .fill({ color: o.color, alpha: 0.025 });
          graphics
            .ellipse(x, y, r * 1.22, r)
            .fill({ color: o.color, alpha: 0.09 })
            .stroke({ color: o.color, alpha: 0.35, width: 1.2 });
          graphics
            .ellipse(x - 1, y - 1, r, r * 0.8)
            .fill({ color: o.color, alpha: 0.1 })
            .stroke({ color: o.color, alpha: 0.14, width: 1 });
          graphics
            .circle(x - r * 0.2, y + r * 0.05, r * 0.36)
            .fill({ color: o.color, alpha: 0.4 })
            .stroke({ color: o.color, alpha: 0.55, width: 0.6 });
          for (let k = 0; k < 5; k++)
            graphics
              .circle(
                x + Math.cos(k * 2 + o.id) * r * 0.65,
                y + Math.sin(k * 2 + o.id) * r * 0.5,
                1.2 + (k % 3),
              )
              .fill({ color: o.color, alpha: 0.28 });
          graphics
            .moveTo(x - r * 1.15, y + 2)
            .quadraticCurveTo(
              x - r * 1.8,
              y + 15,
              x - r * 2.2,
              y + 7 + Math.sin(p.tick / 7 + o.id) * 4,
            )
            .stroke({ color: o.color, width: 0.8, alpha: 0.22 });
        }
      };
      app.ticker.add(draw);
      const local = (e: PointerEvent) => {
        const rect = app.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
      };
      const pointerDown = (e: PointerEvent) => {
        down = local(e);
        dragging = true;
        moved = false;
        app.canvas.setPointerCapture(e.pointerId);
      };
      const pointerMove = (e: PointerEvent) => {
        if (!dragging || latest.current.tool !== "observe") return;
        const at = local(e);
        if (Math.hypot(at.x - down.x, at.y - down.y) > 3) moved = true;
        if (moved) {
          latest.current.onPan();
          pan.x += at.x - down.x;
          pan.y += at.y - down.y;
          down = at;
        }
      };
      const pointerUp = (e: PointerEvent) => {
        if (!dragging) return;
        dragging = false;
        if (moved) return;
        const pt = local(e),
          p = latest.current;
        const point = {
          x: (pt.x - root.x) / root.scale.x,
          y: (pt.y - root.y) / root.scale.y,
        };
        if (p.tool !== "observe") {
          if (point.x > 30 && point.x < 990 && point.y > 30 && point.y < 630)
            p.onPlace(point);
          return;
        }
        if (p.state === "extinct") return;
        const found = organisms
          .filter((o) => !(p.state === "dead" && o.id === 17))
          .map((o) => ({
            o,
            d: Math.hypot(
              positionOf(o, p.tick).x - point.x,
              positionOf(o, p.tick).y - point.y,
            ),
          }))
          .sort((a, b) => a.d - b.d)[0];
        if (found && found.d < found.o.size + 20) p.onSelect(found.o.id);
      };
      const wheel = (e: WheelEvent) => {
        e.preventDefault();
        latest.current.onZoom(e.deltaY < 0 ? 0.15 : -0.15);
      };
      const cancel = () => {
        dragging = false;
      };
      app.canvas.addEventListener("pointerdown", pointerDown);
      app.canvas.addEventListener("pointermove", pointerMove);
      app.canvas.addEventListener("pointerup", pointerUp);
      app.canvas.addEventListener("pointercancel", cancel);
      app.canvas.addEventListener("wheel", wheel, { passive: false });
      clean = () => {
        app.canvas.removeEventListener("pointerdown", pointerDown);
        app.canvas.removeEventListener("pointermove", pointerMove);
        app.canvas.removeEventListener("pointerup", pointerUp);
        app.canvas.removeEventListener("pointercancel", cancel);
        app.canvas.removeEventListener("wheel", wheel);
        app.destroy(true, { children: true });
      };
    })().catch(() => {
      if (!stopped) setError(true);
    });
    return () => {
      stopped = true;
      clean();
    };
  }, []);
  return (
    <div
      className={`world-canvas ${props.tool !== "observe" ? "brush" : ""}`}
      ref={host}
      role="img"
      aria-label="示例生态画布；点击生命可选择，拖动移动镜头，滚轮缩放。也可使用右侧生命选择列表。"
    >
      {error && (
        <p className="canvas-error">
          画布初始化失败，请刷新或使用支持 WebGL 的浏览器。
        </p>
      )}
    </div>
  );
}
