// 预注册 10 评估的分片驱动：把冻结协议的 4608 个世界切成分片并行跑，保证与
// packages/evo/ripening-eval.ts 单进程版本产生【完全相同】的 spec 序列与逐世界结果。
// 每个分片负责每个单元中 seq % shards === shard 的世界，逐世界按 (key,cues,inv,seq) 落盘，可断点续跑。
// 用法：node packages/evo/ripening-eval-shard.ts <输出目录> --shard i --shards n [--dry] [--seeds N] [--dir 前缀]
// 合并：node packages/evo/ripening-eval-merge.ts <输出目录>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runSemanticWorld, type SemanticFactory } from './semantic-run.ts';
import { registerPools, loadLayaPriors, vaderPrior, type Priors } from './pools.ts';
import { structuredCohort } from './structured.ts';

const args = process.argv.slice(2), out = args[0];
if (!out) throw Error('Usage: node packages/evo/ripening-eval-shard.ts <output-dir> --shard i --shards n');
const val = (n: string, d: number) => { const i = args.indexOf(`--${n}`); return i >= 0 ? Number(args[i + 1]) : d; };
const SHARD = val('shard', 0), SHARDS = val('shards', 1), PERSIST_EVERY = val('persistEvery', 8);
const dry = args.includes('--dry'), N = val('seeds', 32);

// ---- 冻结协议常量：与 docs/PREREGISTRATION_10.md §3 及 packages/evo/ripening-eval.ts 逐项一致 ----
const K = 16, HARM_CAP = 4, SEASON = 300, POOL_LIMIT = 1000, INVERSIONS = [.25, .4], PRIORS = ['laya', 'none', 'vader'] as const, CUES = ['language', 'off', 'shuffled'] as const;
const RUN_IDS = dry ? [51, 52] : [51, 52, 53, 54, 55, 56, 57, 58];
const POOL: { id: 'heldout' | 'test'; base: number } = dry ? { id: 'test', base: 340000 } : { id: 'heldout', base: 260000 };
const dirOf = (p: string, s: number) => `${args.includes('--dir') ? args[args.indexOf('--dir') + 1] : 'experiments/evo/f10'}-${p}-${s}`;
const keys = PRIORS.flatMap(p => RUN_IDS.map(s => ({ p, s, key: `${p}-${s}` })));

mkdirSync(`${out}/shards`, { recursive: true });
const frozen = dry ? null : JSON.parse(readFileSync('experiments/prereg/genome-hashes-10.json', 'utf8')) as Record<string, string>;
if (frozen) for (const k of keys) {
  const h = createHash('sha256').update(readFileSync(`${dirOf(k.p, k.s)}/final.json`)).digest('hex');
  if (frozen[k.key] !== h) throw Error(`genome_hash_mismatch:${k.key}`);
}

type Row = { key: string; cues: string; inv: number; seq: number; fitness: number; toxicBites: number; survival: number };
const shardFile = `${out}/shards/shard-${String(SHARD).padStart(2, '0')}-of-${SHARDS}.json`;
const done = new Set<string>();
const rows: Row[] = [];
if (existsSync(shardFile)) {
  const prev = JSON.parse(readFileSync(shardFile, 'utf8')) as { rows: Row[]; doneCells: string[] };
  rows.push(...prev.rows); prev.doneCells.forEach(c => done.add(c));
  console.log(`[shard ${SHARD}] 复用已有结果 ${rows.length} 行、${done.size} 个已完成单元`);
}
const persist = () => writeFileSync(shardFile, JSON.stringify({ shard: SHARD, shards: SHARDS, protocol: 'docs/PREREGISTRATION_10.md', rows, doneCells: [...done] }));
const registered = registerPools() as Record<string, unknown[] | undefined>;
if (!registered[POOL.id]) throw Error(`pool_missing:${POOL.id}`);
const priorT: Record<string, Priors> = { laya: loadLayaPriors(POOL.id), none: new Map<string, number>(), vader: vaderPrior() };
let sinceWrite = 0;

for (const k of keys) {
  const g: number[] = JSON.parse(readFileSync(`${dirOf(k.p, k.s)}/final.json`, 'utf8')).innate;
  const f: SemanticFactory = () => structuredCohort(g, k.p === 'none' ? 'none' : 'laya', priorT[k.p]);
  for (const cues of CUES) for (let ci = 0; ci < INVERSIONS.length; ci++) {
    const inv = INVERSIONS[ci], cell = `${k.key}|${cues}|${inv}`;
    if (done.has(cell)) continue;
    const t0 = Date.now(), before = rows.length;
    for (let i = 0; i < N; i++) {
      if (i % SHARDS !== SHARD) continue;
      const r = runSemanticWorld({ seed: POOL.base + i + ci * 10000, options: { split: 'test', pool: POOL.id, sensible: K, harmCap: HARM_CAP, inversion: inv, ripening: { seasonTicks: SEASON, cues, phrases: 'B' as const, poolLimit: POOL_LIMIT } } }, f);
      rows.push({ key: k.key, cues, inv, seq: i, fitness: r.fitness, toxicBites: r.toxicBites, survival: r.survival });
      if (++sinceWrite >= PERSIST_EVERY) { sinceWrite = 0; persist(); }
    }
    done.add(cell); persist();
    console.log(`[shard ${SHARD}] ${cell} 本分片 ${rows.length - before} 世界，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s，累计 ${rows.length}`);
  }
}
persist();
console.log(`[shard ${SHARD}] 完成：${rows.length} 行 → ${shardFile}`);
