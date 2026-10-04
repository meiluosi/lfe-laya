// 观察室与模拟 Worker 的通信：生命周期、消息分发、本机保存列表。世界状态只存在于 Worker。
import { useEffect, useRef, useState } from 'react';
import { listRecordings, saveRecording, type SavedRun } from './storage';
import type { Recording } from '../../packages/sim/session.ts';
import type { View } from './labels';

export function useWorldWorker() {
  const worker = useRef<Worker | null>(null), serial = useRef(0);
  const [view, setView] = useState<View | null>(null), [error, setError] = useState('');
  const [saved, setSaved] = useState<SavedRun[]>([]), [savedId, setSavedId] = useState(''), [notice, setNotice] = useState('');
  const [checkpointId, setCheckpointId] = useState(() => localStorage.getItem('lfe-learning-checkpoint') ?? '');
  const recordingRef = useRef<Recording | null>(null);
  const send = (kind: string, fields = {}) => { setError(''); setNotice(''); worker.current?.postMessage({ kind, id: ++serial.current, ...fields }); };
  useEffect(() => {
    const w = new Worker(new URL('./world.worker.ts', import.meta.url), { type: 'module' }); worker.current = w;
    w.onmessage = async event => {
      const data = event.data;
      if (data.kind === 'state') { setView(data); if (data.error) setError(data.error); }
      else if(data.kind==='comparison') {const url=URL.createObjectURL(new Blob([JSON.stringify(data.data)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='lfe-comparison.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('已导出分支配置、来源、动作记录与结果。');}
      else if (data.kind === 'notice') setNotice(data.text);
      else if (data.kind === 'learning-checkpoint') { setCheckpointId(data.checkpoint_id); localStorage.setItem('lfe-learning-checkpoint',data.checkpoint_id); setNotice(`完整学习状态已保存，${(data.bytes/1048576).toFixed(2)} MiB。`); }
      else if (data.kind === 'verified') setNotice(`回放校验通过：${data.count} 条记录，终态 ${data.hash}`);
      else if (data.kind === 'recording') {
        recordingRef.current = data.recording;
        try {
          if (data.purpose === 'save') { const row = await saveRecording(data.recording); setSaved(await listRecordings()); setSavedId(row.id); setNotice(`已保存：${row.name}`); }
          else if (data.purpose === 'download') {
            const url = URL.createObjectURL(new Blob([JSON.stringify(data.recording)], {type:'application/json'}));
            const link = document.createElement('a'); link.href = url; link.download = `lfe-${data.recording.final.config.runId}-${data.recording.final.tick}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
            setNotice('已导出动作回放文件；此文件不含可继续训练的学习状态。');
          } else if (data.purpose === 'replay') w.postMessage({kind:'replay',id:++serial.current,recording:data.recording});
        } catch (error) { setError(String(error)); }
      }
    };
    listRecordings().then(setSaved).catch(error => setError(`本地存储不可用：${error}`));
    w.onerror = event => setError(event.message);
    return () => { w.terminate(); worker.current = null; };
  }, []);
  return { view, error, setError, notice, setNotice, saved, setSaved, savedId, setSavedId, checkpointId, setCheckpointId, recordingRef, send, serial };
}
