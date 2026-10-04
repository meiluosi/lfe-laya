import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "./components/Icon";
import { World } from "./components/World";
const Chart = lazy(() =>
  import("./components/Chart").then((module) => ({ default: module.Chart })),
);
import { organisms, episodes, type Point, type DemoState } from "./demo";

type ModalName = "start" | "growth" | "compare" | "save" | "guide" | null;
const idLabel = (id: number) => `L-${String(id).padStart(3, "0")}`;
function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const els = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button, a[href], select, input, [tabindex="0"]',
          ) || [],
        ).filter((x) => !x.hasAttribute("disabled"));
        const first = els[0],
          last = els[els.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <header className="modal-head">
          <div>
            <div className="eyebrow">LFE / 交互原型 · 示例数据</div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button
            className="icon-button"
            aria-label="关闭弹窗"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
export default function App() {
  const [modal, setModal] = useState<ModalName>(null);
  const [selected, setSelected] = useState<number | null>(17);
  const [tick, setTick] = useState(1200),
    [paused, setPaused] = useState(false),
    [speed, setSpeed] = useState(1);
  const [learning, setLearning] = useState(true),
    [following, setFollowing] = useState(false);
  const [resources, setResources] = useState(true),
    [zoom, setZoom] = useState(1),
    [resetKey, setResetKey] = useState(0);
  const [demoState, setDemoState] = useState<DemoState>("normal"),
    [mode, setMode] = useState("Laya + 个体学习");
  const [eventIndex, setEventIndex] = useState(0);
  const [episode, setEpisode] = useState(0),
    [tool, setTool] = useState<"observe" | "nutrient" | "obstacle">("observe");
  useEffect(() => {
    setEventIndex(episode);
  }, [episode]);
  const [pending, setPending] = useState<Point[]>([]),
    [applied, setApplied] = useState<(Point & { kind: string })[]>([]);
  const [notice, setNotice] = useState(""),
    [preset, setPreset] = useState("迁徙的绿洲"),
    [branched, setBranched] = useState(false);
  const [tab, setTab] = useState<"experience" | "policy">("experience");
  const closeModal = useRef(() => setModal(null)).current;
  const running =
    !paused &&
    !modal &&
    demoState !== "waiting" &&
    demoState !== "error" &&
    demoState !== "extinct";
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setTick((t) => t + speed), 100);
    return () => clearInterval(timer);
  }, [running, speed]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const agent = selected ? organisms[selected - 1] : null;
  const hasHistory = selected === 17 && demoState !== "empty";
  const current = episodes[episode];
  const story = episodes[eventIndex];
  const deadSelected = demoState === "dead" && selected === 17;
  const time = `${String(Math.floor(tick / 600)).padStart(2, "0")}:${String(Math.floor(tick / 10) % 60).padStart(2, "0")}`;
  const count = demoState === "extinct" ? 0 : demoState === "dead" ? 47 : 48;
  const adjustZoom = (delta: number) =>
    setZoom((z) => Math.max(0.65, Math.min(2.5, z + delta)));
  function reset(nextPreset = preset) {
    setPreset(nextPreset);
    setSelected(17);
    setTick(1200);
    setPaused(false);
    setSpeed(1);
    setLearning(true);
    setFollowing(false);
    setResources(true);
    setZoom(1);
    setResetKey((k) => k + 1);
    setDemoState(nextPreset === "初生世界" ? "empty" : "normal");
    setMode("Laya + 个体学习");
    setEpisode(0);
    setTool("observe");
    setPending([]);
    setApplied([]);
    setBranched(false);
    setTab("experience");
    setEventIndex(0);
    setModal(null);
    setNotice("示例已重置。所有动作和结果均为原型演示。");
  }
  function chooseState(state: DemoState) {
    setDemoState(state);
    setFollowing(false);
    if (state === "dead") setSelected(17);
    if (state === "extinct") setSelected(null);
    if (state === "empty") setEpisode(0);
  }
  function jump(index: number) {
    setEpisode(index);
    setTick([1200, 2000, 2800, 3600][index]);
    setSelected(17);
    setDemoState("normal");
    setNotice("已跳转到预设片段；这不是现场推理或训练。");
  }
  function chooseTool(next: "observe" | "nutrient" | "obstacle") {
    if (pending.length) {
      setNotice("请先应用或取消当前草稿，再切换工具。");
      return;
    }
    setTool(next);
  }
  function applyBrush() {
    setApplied((a) => [...a, ...pending.map((p) => ({ ...p, kind: tool }))]);
    setNotice(
      `已在示例画布添加 ${pending.length} 处${tool === "nutrient" ? "营养" : "障碍"}；不代表生态响应。`,
    );
    setPending([]);
    setTool("observe");
  }
  const statusText =
    demoState === "waiting"
      ? "等待决策"
      : demoState === "error"
        ? "请求失败 · 已停住"
        : demoState === "extinct"
          ? "种群已灭绝"
          : paused
            ? "世界已暂停"
            : modal
              ? "阅读中 · 演示暂停"
              : "演示运行中";
  return (
    <div className="app-shell">
      <div inert={!!modal}>
        <header className="topbar">
          <a
            className="brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setModal("start");
            }}
            aria-label="LFE 选择世界"
          >
            <span className="brand-symbol">◉</span>
            <span>
              LFE<span className="brand-sub">生命观察室</span>
            </span>
          </a>
          <div className="prototype-label">
            <span className="tiny-square" />
            交互原型 <span className="label-divider">/</span> 示例数据 ·
            未连接模型
          </div>
          <div className="top-actions">
            <button className="text-button" onClick={() => setModal("guide")}>
              <Icon name="book" />
              走查指南
            </button>
            <button className="version-pill" onClick={() => setModal("start")}>
              P0 · 01 <Icon name="chevron" size={12} />
            </button>
          </div>
        </header>
        <div className="workspace">
          <nav className="rail" aria-label="工作区">
            <button
              className="rail-button active"
              title="观察世界"
              aria-label="观察世界"
              onClick={() => setModal(null)}
            >
              <Icon name="world" size={22} />
            </button>
            <button
              className={`rail-button ${tool !== "observe" ? "active" : ""}`}
              title="环境干预"
              aria-label="环境干预"
              onClick={() =>
                chooseTool(tool === "observe" ? "nutrient" : "observe")
              }
            >
              <Icon name="leaf" size={22} />
            </button>
            <button
              className="rail-button"
              title="成长与经历"
              aria-label="成长与经历"
              onClick={() => setModal("growth")}
            >
              <Icon name="chart" size={22} />
            </button>
            <button
              className="rail-button"
              title="实验对照"
              aria-label="实验对照"
              onClick={() => setModal("compare")}
            >
              <Icon name="layers" size={22} />
            </button>
            <div className="rail-spacer" />
            <button
              className="rail-button"
              title="存档说明"
              aria-label="存档说明"
              onClick={() => setModal("save")}
            >
              <Icon name="save" size={20} />
            </button>
            <div className="rail-bottom">
              LAB
              <br />
              01
            </div>
          </nav>
          <main className="main-content">
            <div className="page-heading">
              <div>
                <h1>观察室</h1>
              </div>
              <button
                className="outline-button world-select"
                onClick={() => setModal("start")}
              >
                <Icon name="world" />
                {preset}
                <Icon name="chevron" size={14} />
              </button>
            </div>
            <div className="world-layout">
              <section className="world-panel" aria-label="世界工作台">
                <div className="world-toolbar">
                  <div className="status">
                    <span className={`status-dot ${running ? "" : "still"}`} />
                    {statusText}
                  </div>
                  <div className="playback">
                    <button
                      className="icon-button"
                      aria-label={paused ? "继续世界" : "暂停世界"}
                      onClick={() => setPaused((p) => !p)}
                      disabled={["waiting", "error", "extinct"].includes(
                        demoState,
                      )}
                    >
                      <Icon name={paused ? "play" : "pause"} size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="单步推进"
                      disabled={
                        !paused ||
                        ["waiting", "error", "extinct"].includes(demoState)
                      }
                      onClick={() => setTick((t) => t + 1)}
                    >
                      <Icon name="step" size={16} />
                    </button>
                    <select
                      aria-label="演示倍速"
                      value={speed}
                      onChange={(e) => setSpeed(Number(e.target.value))}
                    >
                      {[1, 2, 4].map((s) => (
                        <option key={s} value={s}>
                          {s}×
                        </option>
                      ))}
                    </select>
                    <span className="toolbar-line" />
                    <span className="time" aria-label="演示时间">
                      {time}
                      <small>.{tick % 10}</small>
                    </span>
                    <span className="muted small">演示时间</span>
                  </div>
                </div>
                <div className="world-stage">
                  <World
                    tick={tick}
                    shifted={episode > 0}
                    selected={selected}
                    onSelect={(id) => {
                      setSelected(id);
                      setFollowing(false);
                    }}
                    zoom={zoom}
                    following={following}
                    resources={resources}
                    state={demoState}
                    tool={tool}
                    pending={pending}
                    applied={applied}
                    onPlace={(p) => setPending((a) => [...a.slice(-19), p])}
                    onPan={() => setFollowing(false)}
                    onZoom={adjustZoom}
                    resetKey={resetKey}
                  />
                  <div className="world-caption">
                    <span>
                      变化资源场 · {episode === 0 ? "西侧富集" : "东侧富集"}
                      （剧情示意）
                    </span>
                  </div>
                  {following && selected && (
                    <div className="follow-indicator">
                      跟随 {idLabel(selected)}
                      <button
                        onClick={() => setFollowing(false)}
                        aria-label="停止跟随"
                      >
                        <Icon name="close" size={12} />
                      </button>
                    </div>
                  )}
                  <div className="canvas-legend">
                    <span>
                      <i className="legend-dot mint" />
                      生命
                    </span>
                    <span>
                      <i className="legend-dot sand" />
                      营养
                    </span>
                    <span>
                      <i className="legend-ring" />
                      感知范围
                    </span>
                  </div>
                  <div className="camera-controls">
                    <button
                      aria-label="放大镜头"
                      onClick={() => adjustZoom(0.2)}
                    >
                      <Icon name="plus" size={16} />
                    </button>
                    <span>{Math.round(zoom * 100)}%</span>
                    <button
                      aria-label="缩小镜头"
                      onClick={() => adjustZoom(-0.2)}
                    >
                      <Icon name="minus" size={16} />
                    </button>
                    <button
                      aria-label="重置镜头"
                      onClick={() => {
                        setZoom(1);
                        setFollowing(false);
                        setResetKey((k) => k + 1);
                      }}
                    >
                      <Icon name="target" size={16} />
                    </button>
                  </div>
                  <div className="scale-mark">
                    <span />
                    100 μ · 示意尺度
                  </div>
                  {(demoState === "waiting" ||
                    demoState === "error" ||
                    demoState === "extinct") && (
                    <div className="world-state-card">
                      <Icon
                        name={demoState === "extinct" ? "leaf" : "info"}
                        size={26}
                      />
                      <h3>
                        {demoState === "waiting"
                          ? "等待一个决定"
                          : demoState === "error"
                            ? "决策请求没有完成"
                            : "这一段生命，暂告一段落"}
                      </h3>
                      <p>
                        {demoState === "waiting"
                          ? "等待状态演示。时间停住，镜头和面板仍可操作。"
                          : demoState === "error"
                            ? "失败状态演示。保留现场，没有静默切换大脑。"
                            : "灭绝状态演示。可以查看经历，或重新开始。"}
                      </p>
                      <div className="button-row">
                        {demoState === "error" && (
                          <button
                            className="outline-button"
                            onClick={() => {
                              setMode("规则模式 · 降级演示");
                              setDemoState("normal");
                              setNotice(
                                "已显式切换为规则降级示意；仍是固定示例。",
                              );
                            }}
                          >
                            切换规则示意
                          </button>
                        )}
                        <button
                          className="primary-button"
                          onClick={() =>
                            demoState === "extinct"
                              ? reset()
                              : setDemoState("normal")
                          }
                        >
                          {demoState === "error"
                            ? "演示重试成功"
                            : demoState === "waiting"
                              ? "结束等待演示"
                              : "重新开始"}
                        </button>
                      </div>
                    </div>
                  )}
                  {tool !== "observe" && (
                    <div className="intervention">
                      <div className="intervention-title">
                        <Icon name={tool === "nutrient" ? "drop" : "layers"} />
                        <strong>
                          {tool === "nutrient" ? "投放营养" : "放置障碍"}
                        </strong>
                        <span className="tag">草稿 · {pending.length} 处</span>
                      </div>
                      <p>点击画布预览位置，再应用。示例最多 20 处。</p>
                      <div className="button-row">
                        <button
                          className="outline-button"
                          onClick={() => {
                            setPending([]);
                            setTool("observe");
                          }}
                        >
                          取消草稿
                        </button>
                        <button
                          className="primary-button"
                          disabled={!pending.length}
                          onClick={applyBrush}
                        >
                          应用到示例
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="world-bottom">
                  <div className="stat">
                    <span>生命个体</span>
                    <strong>
                      {count}
                      <small>个</small>
                    </strong>
                  </div>
                  <div className="stat">
                    <span>观察对象</span>
                    <strong>{selected ? idLabel(selected) : "—"}</strong>
                  </div>
                  <div className="stat brain-stat">
                    <span>大脑设计 · 未运行</span>
                    <strong>{mode}</strong>
                  </div>
                  <button
                    className="layer-toggle"
                    aria-pressed={resources}
                    onClick={() => setResources((r) => !r)}
                  >
                    <Icon name="layers" size={16} />
                    营养图层
                    <span className={`switch ${resources ? "on" : ""}`} />
                  </button>
                </div>
              </section>
              <aside className="inspector" aria-label="生命观察面板">
                <div className="section-label">
                  <span>生命档案</span>
                </div>
                <div className="specimen-heading">
                  <div className={`cell-avatar ${deadSelected ? "faded" : ""}`}>
                    <i />
                    <i />
                    <i />
                  </div>
                  <div>
                    <label className="sr-only" htmlFor="agent-select">
                      选择生命
                    </label>
                    <select
                      id="agent-select"
                      value={selected ?? ""}
                      onChange={(e) => {
                        setSelected(
                          e.target.value ? Number(e.target.value) : null,
                        );
                        setFollowing(false);
                      }}
                    >
                      {demoState === "extinct" ? (
                        <option value="">无存活个体</option>
                      ) : (
                        <>
                          <option value="">未选择生命</option>
                          {organisms.map((o) => (
                            <option value={o.id} key={o.id}>
                              {idLabel(o.id)}
                              {demoState === "dead" && o.id === 17
                                ? " · 已死亡"
                                : ""}
                            </option>
                          ))}
                        </>
                      )}
                    </select>
                    <p>
                      {!agent
                        ? "点选生命，开始观察"
                        : deadSelected
                          ? "已死亡 · 经历保留"
                          : "第 3 代 · 苔光谱系"}
                    </p>
                  </div>
                </div>
                {agent ? (
                  <>
                    <div className="agent-status">
                      <span>
                        <i className="legend-dot mint" />
                        {deadSelected
                          ? "生命已结束"
                          : !hasHistory
                            ? "漂游 · 动画示意"
                            : episode === 1
                              ? "寻找旧地点"
                              : episode >= 2
                                ? "探索附近"
                                : "靠近营养"}
                      </span>
                      <span className="tag">示例个体</span>
                    </div>
                    <div className="energy-label">
                      <span>体内能量</span>
                      <span>
                        <b>{deadSelected ? 0 : agent.energy}</b> / 100
                      </span>
                    </div>
                    <div className="energy-meter">
                      <span
                        style={{ width: `${deadSelected ? 0 : agent.energy}%` }}
                      />
                    </div>
                    <details className="quiet-details">
                      <summary>性状与记忆</summary>
                      <div className="traits">
                        <div>
                          <span>感知范围</span>
                          <strong>
                            {selected === 17 ? "76" : 40 + agent.size}{" "}
                            <small>μ</small>
                          </strong>
                        </div>
                        <div>
                          <span>地点记忆</span>
                          <strong>
                            {hasHistory ? "3" : "0"} <small>/ 8</small>
                          </strong>
                        </div>
                        <div>
                          <span>移动倾向</span>
                          <strong>温和</strong>
                        </div>
                        <div>
                          <span>策略版本</span>
                          <strong>
                            {hasHistory ? current.revision : "v0"}{" "}
                            <small>示例</small>
                          </strong>
                        </div>
                      </div>
                    </details>
                    <button
                      className={`follow-button ${following ? "selected" : ""}`}
                      disabled={deadSelected || demoState === "extinct"}
                      onClick={() => setFollowing((f) => !f)}
                    >
                      <Icon name="target" size={16} />
                      {following ? "停止跟随" : "跟随这个生命"}
                      <Icon name="arrow" size={16} />
                    </button>
                    <div className="inspector-section">
                      <div className="section-label">
                        <span>最近的经历</span>
                        <span className="soft-dot" />
                      </div>
                      {hasHistory ? (
                        <button
                          className="experience-card"
                          onClick={() => setModal("growth")}
                        >
                          <span className="eyebrow">
                            {current.time} / {current.tag}
                          </span>
                          <strong>{current.title}</strong>
                          <p>{current.result}</p>
                          <span className="inline-link">
                            查看经历 <Icon name="arrow" size={14} />
                          </span>
                        </button>
                      ) : (
                        <div className="empty-card">
                          还没有经历记录。
                          <br />
                          <span>选择 L-017 可查看预设故事。</span>
                        </div>
                      )}
                    </div>
                    <div className="learning-control">
                      <div>
                        <strong>参数学习</strong>
                        <span>{learning ? "开启" : "已冻结"}</span>
                      </div>
                      <button
                        className={`switch ${learning ? "on" : ""}`}
                        role="switch"
                        aria-checked={learning}
                        aria-label="允许参数学习"
                        onClick={() => setLearning((l) => !l)}
                      />
                    </div>
                    <button
                      className="text-button learning-help"
                      onClick={() => setModal("guide")}
                    >
                      学习说明 <Icon name="info" size={12} />
                    </button>
                  </>
                ) : (
                  <div className="empty-inspector">
                    <Icon name="target" size={30} />
                    <h3>从一个生命开始</h3>
                    <p>点击画布中的生命，或在上方列表中选择。</p>
                    {demoState === "extinct" && (
                      <button
                        className="outline-button"
                        onClick={() => setModal("growth")}
                      >
                        查看留存经历
                      </button>
                    )}
                  </div>
                )}
              </aside>
            </div>
            <details className="journey quiet-details">
              <summary>
                演示片段 <span>4 段</span>
              </summary>
              <div className="episode-grid">
                {episodes.map((e, i) => (
                  <button
                    className={`episode ${episode === i ? "current" : ""}`}
                    key={e.step}
                    onClick={() => jump(i)}
                  >
                    <span className="episode-number">{e.step}</span>
                    <div>
                      <span>
                        {e.tag}
                        <small>{e.time}</small>
                      </span>
                      <strong>{e.title}</strong>
                    </div>
                    <Icon name="chevron" size={15} />
                  </button>
                ))}
              </div>
            </details>
            <footer className="workspace-footer">
              <a className="text-button" href="/m0/index.html" target="_blank" rel="noreferrer">
                真实运行记录 ↗
              </a>
              <a
                className="text-button"
                href="/creature-studies.html"
                target="_blank"
                rel="noreferrer"
              >
                角色动效参考 ↗
              </a>
              <div>
                <button className="text-button" onClick={() => reset()}>
                  <Icon name="reset" size={13} />
                  重置演示
                </button>
                <select
                  aria-label="演示状态"
                  value={demoState}
                  onChange={(e) => chooseState(e.target.value as DemoState)}
                >
                  <option value="normal">状态：正常观察</option>
                  <option value="empty">状态：暂无经历</option>
                  <option value="waiting">状态：等待决策</option>
                  <option value="error">状态：请求失败</option>
                  <option value="dead">状态：个体死亡</option>
                  <option value="extinct">状态：种群灭绝</option>
                </select>
              </div>
            </footer>
          </main>
        </div>
        <div className="floating-tools" aria-label="画布工具">
          <button
            className={tool === "observe" ? "active" : ""}
            onClick={() => chooseTool("observe")}
          >
            <Icon name="target" size={16} />
            <span>观察</span>
          </button>
          <button
            className={tool === "nutrient" ? "active" : ""}
            onClick={() => chooseTool("nutrient")}
          >
            <Icon name="drop" size={16} />
            <span>营养</span>
          </button>
          <button
            className={tool === "obstacle" ? "active" : ""}
            onClick={() => chooseTool("obstacle")}
          >
            <Icon name="layers" size={16} />
            <span>障碍</span>
          </button>
        </div>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Icon name="info" size={16} />
          {notice}
        </div>
      )}
      {modal === "start" && (
        <Modal
          title="选择世界"
          subtitle="固定示例 · 未连接模型"
          onClose={closeModal}
          wide
        >
          <div className="preset-grid">
            <button
              className={`preset ${preset === "迁徙的绿洲" ? "chosen" : ""}`}
              onClick={() => setPreset("迁徙的绿洲")}
            >
              <span className="tag">推荐 · L1</span>
              <h3>迁徙的绿洲</h3>
              <p>资源迁移，旧的经验还有效吗？</p>
              <span>48 个生命 · 四段预设经历</span>
            </button>
            <button
              className={`preset ${preset === "初生世界" ? "chosen" : ""}`}
              onClick={() => setPreset("初生世界")}
            >
              <span className="tag">空状态体验</span>
              <h3>初生世界</h3>
              <p>从尚无经历与策略更新开始。</p>
              <span>相同画布 · 无经历状态</span>
            </button>
          </div>
          <div className="modal-footer">
            <span>示例画布与预设剧情，不运行模型或训练。</span>
            <button className="primary-button" onClick={() => reset(preset)}>
              进入观察室
              <Icon name="arrow" size={17} />
            </button>
          </div>
        </Modal>
      )}
      {modal === "growth" && (
        <Modal
          title={`${selected ? idLabel(selected) : "L-017"} · 经历`}
          subtitle="预设经历 · 示例数据"
          onClose={closeModal}
          wide
        >
          {!hasHistory && selected !== null ? (
            <div className="empty-view">
              <Icon name="book" size={32} />
              <h3>还没有可展示的经历</h3>
              <p>不会用其他个体的记录填充这个生命的档案。</p>
              <button
                className="primary-button"
                onClick={() => {
                  setSelected(17);
                  setDemoState("normal");
                }}
              >
                查看 L-017 示例经历
              </button>
            </div>
          ) : (
            <>
              <div className="tabs">
                <button
                  className={tab === "experience" ? "active" : ""}
                  onClick={() => setTab("experience")}
                >
                  行动经历
                </button>
                <button
                  className={tab === "policy" ? "active" : ""}
                  onClick={() => setTab("policy")}
                >
                  策略前后
                </button>
              </div>
              {tab === "experience" ? (
                <div className="growth-layout">
                  <div className="event-list">
                    {episodes.map((e, i) => (
                      <button
                        className={i === eventIndex ? "active" : ""}
                        onClick={() => setEventIndex(i)}
                        key={e.step}
                      >
                        <span>{e.time}</span>
                        <strong>{e.title}</strong>
                        <small>{e.tag}</small>
                      </button>
                    ))}
                  </div>
                  <div className="event-detail">
                    <span className="tag">
                      {story.tag} · {story.revision}
                    </span>
                    <h3>{story.title}</h3>
                    <p>{story.detail}</p>
                    <div className="decision-line">
                      <span>01 / Laya 偏好</span>
                      <strong>{story.laya}</strong>
                    </div>
                    <div className="decision-line">
                      <span>02 / 最终选择</span>
                      <strong>{story.action}</strong>
                    </div>
                    <div className="decision-line">
                      <span>03 / 执行后果</span>
                      <strong>{story.result}</strong>
                    </div>
                    <p className="fine-print">
                      百分比为预设候选分布，不是生存成功率。未展示或编造模型内心独白。
                    </p>
                  </div>
                </div>
              ) : (
                <div className="policy-view">
                  <div>
                    <span className="eyebrow">
                      SAME OBSERVATION / DIFFERENT POLICY
                    </span>
                    <h3>在同一个问题面前，选择改变了吗？</h3>
                    <p>
                      固定局部观测：原地点没有资源，附近有可探索区域。
                      <br />
                      以下为 v0 与 v1 的人工示例分布。
                    </p>
                  </div>
                  <div className="bar-legend">
                    <span>浅绿 v1</span>
                    <span>灰紫 v0</span>
                  </div>
                  {["返回旧地点", "探索附近", "休眠"].map((label, i) => (
                    <div className="policy-row" key={label}>
                      <span>{label}</span>
                      <div>
                        <div
                          className="policy-bar"
                          style={{ width: `${[24, 66, 10][i]}%` }}
                        >
                          {[24, 66, 10][i]}%
                        </div>
                        <div
                          className="policy-bar before"
                          style={{ width: `${[58, 32, 10][i]}%` }}
                        >
                          {[58, 32, 10][i]}%
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="callout">
                    策略变化 ≠ 学习改善。还需要在相同条件下比较实际后果。
                  </div>
                </div>
              )}
              <div className="modal-footer">
                <span>四段经历是不同时间的演示片段。</span>
                <button
                  className="primary-button"
                  onClick={() => setModal("compare")}
                >
                  看看改变是否有用
                  <Icon name="arrow" size={16} />
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
      {modal === "compare" && (
        <Modal
          title="学习对照"
          subtitle="相同起点 · 预设数据"
          onClose={closeModal}
          wide
        >
          {!branched ? (
            <div className="branch-intro">
              <Icon name="layers" size={34} />
              <h3>从同一份示例快照出发</h3>
              <p>
                相同的个体、环境与初始记忆。
                <br />
                仅让一边继续更新参数，另一边保持冻结。
              </p>
              <div className="compare-conditions">
                <span>
                  共同起点 <b>快照 DEMO-004</b>
                </span>
                <span>
                  记忆规则 <b>两边均允许变化</b>
                </span>
                <span>
                  唯一设计差异 <b>是否更新个体参数</b>
                </span>
              </div>
              <button
                className="primary-button"
                onClick={() => setBranched(true)}
              >
                创建示例对照
                <Icon name="arrow" size={17} />
              </button>
            </div>
          ) : (
            <>
              <div className="comparison-summary">
                <div>
                  <span className="tag">分支 A</span>
                  <h3>继续学习</h3>
                  <p>参数允许更新 · 记忆允许变化</p>
                </div>
                <span className="versus">vs.</span>
                <div>
                  <span className="tag lavender">分支 B</span>
                  <h3>冻结参数</h3>
                  <p>参数保持不变 · 记忆允许变化</p>
                </div>
              </div>
              <Suspense
                fallback={<p className="chart-loading">正在加载图表组件…</p>}
              >
                <Chart />
              </Suspense>
              <div className="callout">
                <strong>这组示例没有提供改善证据。</strong>
                <span>
                  两条曲线接近；单个体、单段预设数据无法证明持续学习有效。真实版本将加入多种子和留出环境评估。
                </span>
              </div>
              <details className="data-table">
                <summary>查看示例数值与条件</summary>
                <p>
                  快照 DEMO-004；无繁殖、无变异；演示时长 120
                  秒；两边均允许记忆变化。
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>分支</th>
                      <th>初始能量</th>
                      <th>结束能量</th>
                      <th>性质</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>继续学习</td>
                      <td>62</td>
                      <td>64</td>
                      <td>人工预设</td>
                    </tr>
                    <tr>
                      <td>冻结参数</td>
                      <td>62</td>
                      <td>63</td>
                      <td>人工预设</td>
                    </tr>
                  </tbody>
                </table>
              </details>
              <div className="modal-footer">
                <span>没有启动训练或复制真实世界。</span>
                <button className="outline-button" onClick={closeModal}>
                  返回世界
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
      {modal === "save" && (
        <Modal
          title="保存什么，决定了能继续什么。"
          subtitle="存档能力说明 · 原型不写入世界存档"
          onClose={closeModal}
        >
          <div className="save-option">
            <Icon name="play" />
            <div>
              <h3>观看回放</h3>
              <p>快照与动作日志，可以重看已发生的过程。不能据此继续训练。</p>
            </div>
            <span className="tag">M3 计划</span>
          </div>
          <div className="save-option">
            <Icon name="save" />
            <div>
              <h3>继续学习</h3>
              <p>还需完整参数、优化器、经验和随机状态，才能恢复学习分支。</p>
            </div>
            <span className="tag">M5 计划</span>
          </div>
          <div className="callout">
            当前仅有可重置示例。刷新页面会重置，不会显示虚假的“保存成功”。
          </div>
        </Modal>
      )}
      {modal === "guide" && (
        <Modal
          title="操作说明"
          subtitle="约 3 分钟 · 核心体验审核"
          onClose={closeModal}
        >
          <ol className="guide-list">
            <li>在画布或档案列表选中 L-017，点击「跟随这个生命」。</li>
            <li>打开最近经历，比较 Laya 偏好、最终选择和后果。</li>
            <li>选择底部「营养」，点击画布预览，再应用或取消。</li>
            <li>
              暂停世界会停住行动与学习；冻结参数仅停止参数更新，记忆仍可变化。
            </li>
            <li>点击旅程片段跳转，查看策略前后，再创建示例对照。</li>
            <li>用底部「演示状态」体验等待、失败、死亡与灭绝。</li>
          </ol>
          <div className="callout">
            所有曲线、经历与动画都用于体验审核。欢迎关注：哪里不清楚、哪里不好用，以及你还想观察什么。
          </div>
        </Modal>
      )}
    </div>
  );
}
