// 预注册 09 评估的合并 / 统计：读入各分片的逐世界结果，按 social-eval.ts 的同一公式重建
// 单元均值、三条假设、符号翻转精确检验与 Holm 逐步检验，写出与单进程版本同结构的 results.json。
// 用法：node packages/evo/social-eval-merge.ts <输出目录>
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const out = process.argv.slice(2)[0];
if (!out) throw Error('Usage: node packages/evo/social-eval-merge.ts <output-dir>');
const dir = `${out}/shards`;
const files = readdirSync(dir).filter(f => /^shard-\d+-of-\d+\.json$/.test(f));
if (!files.length) throw Error(`no_shards:${dir}`);

type Row = { pool: string; key: string; cues: string; inv: number; seq: number; fitness: number; toxicBites: number; survival: number };
const seen = new Set<string>(), rows: Row[] = [];
let expected = 0, dup = 0;
for (const f of files) {
  const j = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as { shard: number; shards: number; rows: Row[] };
  expected = Math.max(expected, j.shards);
  for (const r of j.rows) {
    const id = `${r.pool}|${r.key}|${r.cues}|${r.inv}|${r.seq}`;
    if (seen.has(id)) { dup++; continue; }
    seen.add(id); rows.push(r);
  }
}
// 逐世界重放顺序：与单进程版一致地按 seq 恢复每个单元内部的顺序（每个世界由 seed 决定，互不影响）
rows.sort((a, b) => a.pool.localeCompare(b.pool) || a.key.localeCompare(b.key) || a.cues.localeCompare(b.cues) || a.inv - b.inv || a.seq - b.seq);

// ---- 与 packages/evo/social-eval.ts 相同的冻结常量与公式 ----
const PRIORS = ['laya', 'none', 'vader'] as const, CUES = ['language', 'off', 'shuffled'] as const, INVERSIONS = [.25, .4];
const T_H1 = 0.02, T_H2 = 0.05, T_H3 = 0.01;
// 池与种子从数据里推断，使同一份代码既能合并正式评估（heldout + factual，种子 41–48）
// 也能合并开发空跑（test，种子 41–42）；正式评估的完整性检查仍要求 2 池 × 8 种子 × 32 世界。
const POOL_IDS = [...new Set(rows.map(r => r.pool))].sort() as string[];
const SEEDS = [...new Set(rows.map(r => Number(r.key.split('-').pop())))].sort((a, b) => a - b);
const mainPool = POOL_IDS.includes('heldout') ? 'heldout' : POOL_IDS[0];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function signFlipP(d: number[]) { const obs = mean(d), n = d.length; let ge = 0; for (let m = 0; m < 1 << n; m++) { let s = 0; for (let i = 0; i < n; i++) s += (m >> i & 1) ? -d[i] : d[i]; if (s / n >= obs - 1e-12) ge++; } return ge / (1 << n); }
const r4 = (x: number) => +x.toFixed(4);
const fits: Record<string, Record<string, Record<string, Row[]>>> = {};
for (const pool of POOL_IDS) fits[pool] = {};
for (const r of rows) { fits[r.pool] ??= {}; fits[r.pool][r.key] ??= {}; (fits[r.pool][r.key][`${r.cues}|${r.inv}`] ??= []).push(r); }
const score = (pool: string, key: string, cues: string) => mean(INVERSIONS.flatMap(i => (fits[pool]?.[key]?.[`${cues}|${i}`] ?? []).map(r => r.fitness)));
const gain = (pool: string, p: string, s: number) => score(pool, `${p}-${s}`, 'language') - score(pool, `${p}-${s}`, 'off');
const main = mainPool;
const dH1 = SEEDS.map(s => gain(main, 'laya', s));
const dH2 = SEEDS.map(s => score(main, `laya-${s}`, 'off') - score(main, `laya-${s}`, 'shuffled'));
const dH3 = SEEDS.map(s => gain(main, 'laya', s) - gain(main, 'vader', s));
const hyps = [
  { id: 'H1', claim: `laya 个体：真实外观线索比不显示线索至少高 ${T_H1}`, d: dH1, thr: T_H1 },
  { id: 'H2', claim: `laya 个体：不显示线索比错配线索至少高 ${T_H2}（错误的社会信息有代价）`, d: dH2, thr: T_H2 },
  { id: 'H3', claim: `社会信息的收益（真实 − 不显示）：laya 比 vader 至少多 ${T_H3}`, d: dH3, thr: T_H3 },
].map(h => ({ ...h, stat: mean(h.d), p: signFlipP(h.d) }));
const sorted = hyps.slice().sort((a, b) => a.p - b.p || a.id.localeCompare(b.id)), reject = new Map<string, boolean>(); let stop = false;
sorted.forEach((h, i) => { const r = !stop && h.p < 0.05 / (sorted.length - i); if (!r) stop = true; reject.set(h.id, r); });
const verdicts = hyps.map(h => ({ id: h.id, claim: h.claim, statistic: r4(h.stat), threshold: h.thr, effectOk: h.stat >= h.thr, p: r4(h.p), holmReject: reject.get(h.id)!, supported: reject.get(h.id)! && h.stat >= h.thr, perSeed: h.d.map(r4) }));

// 世界覆盖完整性检查：每单元应有 8 种子 × 32 世界 = 256 条，且 seq 为完整 0..31
const coverage: Record<string, unknown> = {}; const problems: string[] = [];
for (const pool of POOL_IDS) for (const p of PRIORS) for (const s of SEEDS) for (const c of CUES) for (const inv of INVERSIONS) {
  const cell = fits[pool]?.[`${p}-${s}`]?.[`${c}|${inv}`] ?? [];
  const seqs = new Set(cell.map(r => r.seq));
  if (cell.length !== 32 || seqs.size !== 32) problems.push(`${pool}|${p}-${s}|${c}|${inv}: n=${cell.length}, seq=${seqs.size}`);
}
coverage.expectedCells = POOL_IDS.length * PRIORS.length * SEEDS.length * CUES.length * INVERSIONS.length;
coverage.expectedWorlds = coverage.expectedCells * 32;
coverage.observedWorlds = rows.length;
coverage.duplicatesDropped = dup;
coverage.problems = problems;
coverage.shardFiles = files.length;
coverage.shardsExpected = expected;

const secondary = Object.fromEntries(POOL_IDS.map(pool => [pool, {
  meanFitness: Object.fromEntries(PRIORS.flatMap(p => CUES.map(c => [`${p}|${c}`, r4(mean(SEEDS.map(s => score(pool, `${p}-${s}`, c))))]))),
  gainLanguageMinusOff: Object.fromEntries(PRIORS.map(p => [p, SEEDS.map(s => r4(gain(pool, p, s)))])),
  layaMinusNoneLanguage: SEEDS.map(s => r4(score(pool, `laya-${s}`, 'language') - score(pool, `none-${s}`, 'language'))),
  toxicBites: Object.fromEntries(PRIORS.flatMap(p => CUES.map(c => [`${p}|${c}`, +mean(SEEDS.flatMap(s => INVERSIONS.flatMap(i => (fits[pool][`${p}-${s}`][`${c}|${i}`] ?? []).map(r => r.toxicBites)))).toFixed(0)]))),
  survival: Object.fromEntries(PRIORS.flatMap(p => CUES.map(c => [`${p}|${c}`, r4(mean(SEEDS.flatMap(s => INVERSIONS.flatMap(i => (fits[pool][`${p}-${s}`][`${c}|${i}`] ?? []).map(r => r.survival)))))]))),
}]));

writeFileSync(`${out}/results.json`, JSON.stringify({ protocol: 'docs/PREREGISTRATION_09.md', sharded: { shards: expected, files: files.length }, worldsPerCell: 32, K: 32, harmCap: 4, inversions: INVERSIONS, seeds: SEEDS, pools: POOL_IDS, coverage, primary: verdicts, secondary }, null, 2));
console.log(JSON.stringify({ coverage, primary: verdicts }, null, 1));
