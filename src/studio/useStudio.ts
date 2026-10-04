// 观察台与模拟 Worker 的连接。世界状态只存在于 Worker；这里只持有最新视图、带子索引和提示。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TapeMark, Recording } from '../../packages/sim/session.ts';
import type { View } from '../lab/labels';
import { listRecordings, loadRecording, saveRecording, type SavedRun } from '../lab/storage';

export function useStudio() {
  const worker = useRef<Worker | null>(null), serial = useRef(0), viewRef = useRef<View | null>(null);
  const [view, setView] = useState<View | null>(null), [tape, setTape] = useState<TapeMark[]>([]);
  const [compareTape, setCompareTape] = useState<{ runId: string | null; marks: TapeMark[]; initialTick: number; initialLiving: number }>({ runId: null, marks: [], initialTick: 0, initialLiving: 0 });
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [saved, setSaved] = useState<SavedRun[]>([]);
  const [checkpointId, setCheckpointId] = useState(() => { try { return localStorage.getItem('lfe-learning-checkpoint') ?? ''; } catch { return ''; } });
  // 拖动带子时只保留最新目标，等上一次跳转回复后再发，避免排队堆积。
  const seekPending = useRef<number | null>(null), seekInFlight = useRef<number | null>(null);

  const post = useCallback((kind: string, fields: object = {}) => { const id = ++serial.current; worker.current?.postMessage({ kind, id, ...fields }); return id; }, []);
  const send = useCallback((kind: string, fields: object = {}) => { setError(''); setNotice(''); return post(kind, fields); }, [post]);
  const flushSeek = useCallback(() => {
    if (seekInFlight.current !== null || seekPending.current === null) return;
    const target = seekPending.current; seekPending.current = null;
    if (!viewRef.current?.replay) post('scrub-open');
    seekInFlight.current = post('seek', { value: target });
  }, [post]);
  const seek = useCallback((index: number) => { seekPending.current = index; flushSeek(); }, [flushSeek]);

  useEffect(() => {
    const w = new Worker(new URL('../lab/world.worker.ts', import.meta.url), { type: 'module' }); worker.current = w;
    w.onmessage = async event => {
      const d = event.data;
      if (d.kind === 'state') {
        viewRef.current = d; setView(d); if (d.error) setError(d.error);
        if (d.reply !== undefined && d.reply === seekInFlight.current) { seekInFlight.current = null; flushSeek(); }
      } else if (d.kind === 'tape') setTape(prev => d.from === 0 ? d.marks : [...prev.slice(0, d.from), ...d.marks]);
      else if (d.kind === 'compare-tape') setCompareTape({ runId: d.runId, marks: d.marks, initialTick: d.initialTick, initialLiving: d.initialLiving });
      else if (d.kind === 'notice') setNotice(d.text);
      else if (d.kind === 'verified') setNotice(`回放校验通过：${d.count} 条记录，终态 ${d.hash}`);
      else if (d.kind === 'learning-checkpoint') { setCheckpointId(d.checkpoint_id); try { localStorage.setItem('lfe-learning-checkpoint', d.checkpoint_id); } catch { /* 无存储时只影响“恢复最近” */ } setNotice(`完整学习状态已保存，${(d.bytes / 1048576).toFixed(2)} MiB。`); }
      else if (d.kind === 'comparison') download(d.data, 'lfe-comparison.json');
      else if (d.kind === 'recording') {
        try {
          if (d.purpose === 'save') { const row = await saveRecording(d.recording); setSaved(await listRecordings()); setNotice(`已保存：${row.name}`); }
          else if (d.purpose === 'download') { download(d.recording, `lfe-${d.recording.final.config.runId}-${d.recording.final.tick}.json`); setNotice('已导出动作回放；此文件不含可继续训练的学习状态。'); }
        } catch (e) { setError(String(e)); }
      }
    };
    w.onerror = e => setError(e.message);
    listRecordings().then(setSaved).catch(e => setError(`本地存储不可用：${e}`));
    return () => { w.terminate(); worker.current = null; };
  }, [flushSeek]);

  const openSaved = useCallback(async (id: string, verify: boolean) => {
    try { const recording: Recording = await loadRecording(id); send(verify ? 'verify' : 'replay', { recording }); } catch (e) { setError(String(e)); }
  }, [send]);
  const importFile = useCallback(async (file?: File) => {
    if (!file) return;
    try { if (file.size > 80 * 1024 * 1024) throw Error('文件超过 80 MiB 上限'); send('replay', { recording: JSON.parse(await file.text()) }); } catch (e) { setError(`导入失败：${e}`); }
  }, [send]);
  const importLearning = useCallback(async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 256 * 1048576) throw Error('检查点超过 256 MiB');
      const response = await fetch('/api/learning/import', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      if (!response.ok) throw Error(await response.text());
      const result = await response.json(); setCheckpointId(result.checkpoint_id);
      try { localStorage.setItem('lfe-learning-checkpoint', result.checkpoint_id); } catch { /* 无存储时只影响“恢复最近” */ }
      setNotice(`已导入完整学习检查点 ${String(result.checkpoint_id).slice(0, 12)}…`);
    } catch (e) { setError(String(e)); }
  }, [setError, setNotice]);
  return { view, tape, compareTape, importLearning, error, setError, notice, setNotice, saved, checkpointId, send, seek, serial, openSaved, importFile };
}

function download(data: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
