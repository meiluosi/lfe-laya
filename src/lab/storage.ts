import Dexie, { type Table } from 'dexie';
import type { Recording } from '../../packages/sim/session.ts';
export type SavedRun = { id: string; created: number; name: string; tick: number; mode: string; bytes: number };
class Archive extends Dexie {
  runs!: Table<SavedRun, string>;
  recordings!: Table<{ id: string; recording: Recording }, string>;
  constructor() { super('lfe-ecology-v1'); this.version(1).stores({ runs: 'id,created', recordings: 'id' }); }
}
const archive = new Archive();
export async function saveRecording(recording: Recording): Promise<SavedRun> {
  const bytes = new TextEncoder().encode(JSON.stringify(recording)).length;
  const run = { id: crypto.randomUUID(), created: Date.now(), name: `${recording.final.config.runId} · ${(recording.final.tick / recording.final.config.ticksPerSecond).toFixed(1)}s`, tick: recording.final.tick, mode: recording.mode, bytes };
  await archive.transaction('rw', archive.runs, archive.recordings, async () => {
    const saved = await archive.runs.toArray();
    if (saved.length >= 32 || saved.reduce((n, r) => n + r.bytes, 0) + bytes > 256 * 1024 * 1024) throw Error('本地存储达到 32 条或 256 MiB 上限；仍可导出文件。');
    await archive.runs.add(run); await archive.recordings.add({ id: run.id, recording });
  });
  return run;
}
export const listRecordings = () => archive.runs.orderBy('created').reverse().toArray();
export async function loadRecording(id: string): Promise<Recording> {
  const row = await archive.recordings.get(id); if (!row) throw Error('保存记录不存在'); return row.recording;
}
