// 预注册 09 评估的分片驱动：把冻结协议的 27648 个世界切成分片并行跑，保证与
// packages/evo/social-eval.ts 单进程版本产生【完全相同】的 spec 序列与逐世界结果。
// 每个分片负责每个单元中 seq % shards === shard 的世界，逐世界按 (pool,key,cues,inv,seq) 落盘，可断点续跑。
// 用法：node packages/evo/social-eval-shard.ts <输出目录> --shard i --shards n [--dry] [--seeds N] [--dir 前缀]
// 合并：node packages/evo/social-eval-merge.ts <输出目录>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runSemanticWorld, type SemanticFactory } from './semantic-run.ts';
import { registerPools, loadLayaPriors, vaderPrior, type Priors } from './pools.ts';
import { structuredSocialCohort } from './structured-social.ts';

const args = process.argv.slice(2), out = args[0];
if (!out) throw Error('Usage: node packages/evo/social-eval-shard.ts <output-dir> --shard i --shards n');
const val = (n: string, d: number) => { const i = args.indexOf(`--${n}`); return i >= 0 ? Number(args[i + 1]) : d; };
const SHARD = val('shard', 0), SHARDS = val('shards', 1), PERSIST_EVERY = val('persistEvery', 8);
const dry = args.includes('--dry'), N = val('seeds', 32);

// ---- 冻结协议常量：与 docs/PREREGISTRATION_09.md 及 packages/evo/social-eval.ts 逐项一致 ----
const K = 32, HARM_CAP = 4, INVERSIONS = [.25, .4], PRIORS = ['laya', 'none', 'vader'] as const, CUES = ['language', 'off', 'shuffled'] as const;
const RUN_IDS = dry ? [41, 42] : [41, 42, 43, 44, 45, 46, 47, 48];
const POOLS: { id: 'heldout' | 'factual' | 'test'; base: number }[] = dry ? [{ id: 'test', base: 330000 }] : [{ id: 'heldout', base: 240000 }, { id: 'factual', base: 250000 }];
const dirOf = (p: string, s: number) => `${args.includes('--dir') ? args[args.indexOf('--dir') + 1] : 'experiments/evo/f9'}-${p}-${s}`;
const keys = PRIORS.flatMap(p => RUN_IDS.map(s => ({ p, s, key: `${p}-${s}` })));

mkdirSync(`${out}/shards`, { recursive: true });
const frozen = dry ? null : JSON.parse(readFileSync('experiments/prereg/genome-hashes-09.json', 'utf8')) as Record<string, string>;
if (frozen) for (const k of keys) {
  const h = createHash('sha256').update(readFileSync(`${dirOf(k.p, k.s)}/final.json`)).digest('hex');
  if (frozen[k.key] !== h) throw Error(`genome_hash_mismatch:${k.key}`);
}

type Row = { pool: string; key: string; cues: string; inv: number; seq: number; fitness: number; toxicBites: number; survival: number };
const shardFile = `${out}/shards/shard-${String(SHARD).padStart(2, '0')}-of-${SHARDS}.json`;
const done = new Set<string>();
const rows: Row[] = [];
if (existsSync(shardFile)) {                                    // 断点续跑
  const prev = JSON.parse(readFileSync(shardFile, 'utf8')) as { rows: Row[]; doneCells: string[] };
  rows.push(...prev.rows); prev.doneCells.forEach(c => done.add(c));
  console.log(`[shard ${SHARD}] 复用已有结果 ${rows.length} 行、${done.size} 个已完成单元`);
}
const persist = () => writeFileSync(shardFile, JSON.stringify({ shard: SHARD, shards: SHARDS, protocol: 'docs/PREREGISTRATION_09.md', rows, doneCells: [...done] }));
const registered = registerPools() as Record<string, unknown[] | undefined>;
let sinceWrite = 0;

for (const pool of POOLS) {
  if (!registered[pool.id]) throw Error(`pool_missing:${pool.id}`);
  const priorT: Record<string, Priors> = { laya: loadLayaPriors(pool.id as 'test'), none: new Map<string, number>(), vader: vaderPrior() };
  for (const k of keys) {
    const g: number[] = JSON.parse(readFileSync(`${dirOf(k.p, k.s)}/final.json`, 'utf8')).innate;
    const f: SemanticFactory = () => structuredSocialCohort(g, k.p === 'none' ? 'none' : 'laya', priorT[k.p]);
    for (const cues of CUES) for (let ci = 0; ci < INVERSIONS.length; ci++) {
      const inv = INVERSIONS[ci], cell = `${pool.id}|${k.key}|${cues}|${inv}`;
      if (done.has(cell)) continue;
      const t0 = Date.now(), before = rows.length;
      for (let i = 0; i < N; i++) {
        if (i % SHARDS !== SHARD) continue;
        const r = runSemanticWorld({ seed: pool.base + i + ci * 10000, options: { split: 'test', pool: pool.id, sensible: K, harmCap: HARM_CAP, inversion: inv, social: { cues, phrases: 'B' as const } } }, f);
        rows.push({ pool: pool.id, key: k.key, cues, inv, seq: i, fitness: r.fitness, toxicBites: r.toxicBites, survival: r.survival });
        if (++sinceWrite >= PERSIST_EVERY) { sinceWrite = 0; persist(); }
      }
      done.add(cell); persist();
      console.log(`[shard ${SHARD}] ${cell} 本分片 ${rows.length - before} 世界，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s，累计 ${rows.length}`);
    }
  }
}
persist();
console.log(`[shard ${SHARD}] 完成：${rows.length} 行 → ${shardFile}`);
