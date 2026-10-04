import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StageRenderer, type StageEvents, type StageProps } from './stageRenderer';

export type StageHandle = { fit: () => void; zoomBy: (factor: number) => void };
export const Stage = forwardRef<StageHandle, StageProps & StageEvents>(function Stage(props, ref) {
  const host = useRef<HTMLDivElement>(null), renderer = useRef<StageRenderer | null>(null), latest = useRef(props); latest.current = props;
  const [error, setError] = useState('');
  useImperativeHandle(ref, () => ({ fit: () => renderer.current?.fit(), zoomBy: f => renderer.current?.zoomBy(f) }), []);
  useEffect(() => {
    const r = new StageRenderer(host.current!, latest.current, {
      onSelect: id => latest.current.onSelect(id), onPlace: (x, y) => latest.current.onPlace(x, y),
      onUserCamera: () => latest.current.onUserCamera(), onFrame: (ms, z) => latest.current.onFrame(ms, z),
      onAnchor: (x, y, r, v) => latest.current.onAnchor(x, y, r, v),
    });
    renderer.current = r; r.init().catch(e => setError(String(e)));
    return () => { r.destroy(); renderer.current = null; };
  }, []);
  useEffect(() => { renderer.current?.update(props); });
  return <div className="stage" ref={host} role="img" aria-label="真实生态画布：点击生命选择，拖动平移，滚轮缩放。也可从命令面板选择个体。">{error && <p role="alert" className="stage-error">画布初始化失败（需要 WebGL）：{error}</p>}</div>;
});
