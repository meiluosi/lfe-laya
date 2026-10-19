// 预注册 11 评估的合并 / 统计：读入各分片的逐世界结果，按 docs/PREREGISTRATION_11.md §5 的
// 冻结公式重建单元均值、三条假设、符号翻转精确检验与 Holm 逐步检验，写出 results.json。
// 用法：node packages/evo/ripening11-eval-merge.ts <输出目录> [--full]
//   --full：按协议网格（3 先验 × 8 种子 × 3 线索 × 2 欺骗 × 32 世界 = 4608）逐格校验，不完整即报错退出。
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const out = process.argv.slice(2)[0];
if (!out) throw Error('Usage: node packages/evo/ripening11-eval-merge.ts <output-dir> [--full]');
const dir = `${out}/shards`;
const files = readdirSync(dir).filter(f => /^shard-\d+-of-\d+\.json$/.test(f));
if (!files.length) throw Error(`no_shards:${dir}`);

type Row = { key: string; cues: string; inv: number; seq: number; fitness: number; toxicBites: number; survival: number };
const seen = new Set<string>(), rows: Row[] = [];
let shards = 0, dup = 0;
for (const f of files) {
  const j = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as { shards: number; rows: Row[] };
  shards = Math.max(shards, j.shards);
  for (const r of j.rows) {
    const id = `${r.key}|${r.cues}|${r.inv}|${r.seq}`;
    if (seen.has(id)) { dup++; continue; }
    seen.add(id); rows.push(r);
  }
}
rows.sort((a, b) => a.key.localeCompare(b.key) || a.cues.localeCompare(b.cues) || a.inv - b.inv || a.seq - b.seq);

// ---- 与 docs/PREREGISTRATION_11.md §4–§5 相同的冻结常量与公式 ----
const PRIORS = ['laya', 'none', 'vader'] as const, CUES = ['language', 'off', 'shuffled'] as const, INVERSIONS = [.25, .4];
const T_H1 = 0.03, T_H2 = 0.05, T_H3 = 0.01, NEVER_EAT_GATE = 0.25;
const FULL = process.argv.includes('--full');
const FULL_SEEDS = [61, 62, 63, 64, 65, 66, 67, 68];
const SEEDS = [...new Set(rows.map(r => Number(r.key.split('-').pop())))].sort((a, b) => a - b);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function signFlipP(d: number[]) { const obs = mean(d), n = d.length; let ge = 0; for (let m = 0; m < 1 << n; m++) { let s = 0; for (let i = 0; i < n; i++) s += (m >> i & 1) ? -d[i] : d[i]; if (s / n >= obs - 1e-12) ge++; } return ge / (1 << n); }
const r4 = (x: number) => +x.toFixed(4);

const fits: Record<string, Record<string, Row[]>> = {};
for (const r of rows) { fits[r.key] ??= {}; (fits[r.key][`${r.cues}|${r.inv}`] ??= []).push(r); }
const score = (key: string, cues: string) => mean(INVERSIONS.flatMap(i => (fits[key]?.[`${cues}|${i}`] ?? []).map(r => r.fitness)));

const dH1 = SEEDS.map(s => score(`laya-${s}`, 'language') - score(`none-${s}`, 'language'));
const dH2 = SEEDS.map(s => score(`laya-${s}`, 'language') - score(`laya-${s}`, 'shuffled'));
const dH3 = SEEDS.map(s => score(`laya-${s}`, 'language') - score(`vader-${s}`, 'language'));
const hyps = [
  { id: 'H1', claim: `真实线索下 laya 优于 none 至少 ${T_H1}`, d: dH1, thr: T_H1 },
  { id: 'H2', claim: `laya 个体：真实线索比错配线索至少高 ${T_H2}（个体在使用阶段线索）`, d: dH2, thr: T_H2 },
  { id: 'H3', claim: `真实线索下 laya 优于 vader 至少 ${T_H3}`, d: dH3, thr: T_H3 },
].map(h => ({ ...h, stat: mean(h.d), p: signFlipP(h.d) }));
const sorted = hyps.slice().sort((a, b) => a.p - b.p || a.id.localeCompare(b.id)), reject = new Map<string, boolean>(); let stop = false;
sorted.forEach((h, i) => { const r = !stop && h.p < 0.05 / (sorted.length - i); if (!r) stop = true; reject.set(h.id, r); });
const verdicts = hyps.map(h => ({ id: h.id, claim: h.claim, statistic: r4(h.stat), threshold: h.thr, effectOk: h.stat >= h.thr, p: r4(h.p), holmReject: reject.get(h.id)!, supported: reject.get(h.id)! && h.stat >= h.thr, perSeed: h.d.map(r4) }));

// 冻结的解释规则：无先验个体的“从不进食”种子占比
const neverEatsShare = Object.fromEntries(PRIORS.map(p => [p, r4(SEEDS.filter(s => INVERSIONS.every(i => (fits[`${p}-${s}`][`language|${i}`] ?? []).every(r => r.toxicBites === 0))).length / SEEDS.length)]));
const interpretation = neverEatsShare.none > NEVER_EAT_GATE
  ? 'H1 只能解释为“读得懂 vs 读不懂”：无先验个体退化比例超过预先声明的 0.25 门槛'
  : '双方都能学：本预注册的 laya − none 可在公平比较下解读（无先验退化比例未超过 0.25 门槛）';

// 覆盖完整性
const checkSeeds = FULL ? FULL_SEEDS : SEEDS;
const problems: string[] = [];
let observed = 0, expectedWorlds = 0;
for (const p of PRIORS) for (const s of checkSeeds) for (const c of CUES) for (const inv of INVERSIONS) {
  expectedWorlds += 32;
  const cell = fits[`${p}-${s}`]?.[`${c}|${inv}`] ?? [];
  const seqs = new Set(cell.map(r => r.seq));
  observed += cell.length;
  if (cell.length !== 32 || seqs.size !== 32) problems.push(`${p}-${s}|${c}|${inv}: n=${cell.length}, 唯一 seq=${seqs.size}`);
}
const coverage = {
  mode: FULL ? 'full' : 'dev',
  expectedWorlds, observedWorlds: observed, duplicatesDropped: dup,
  shardFiles: files.length, shardsExpected: shards,
  ok: problems.length === 0 && dup === 0 && observed === expectedWorlds,
  problems,
};
if (FULL && !coverage.ok) {
  console.error(JSON.stringify({ coverage }, null, 1));
  throw Error(`coverage_incomplete：正式评估要求完整网格，${problems.length} 个单元不完整`);
}

const secondary = {
  meanFitness: Object.fromEntries(PRIORS.flatMap(p => CUES.map(c => [`${p}|${c}`, r4(mean(SEEDS.map(s => score(`${p}-${s}`, c))))]))),
  cueGain: Object.fromEntries(PRIORS.map(p => [p, {
    languageMinusOff: SEEDS.map(s => r4(score(`${p}-${s}`, 'language') - score(`${p}-${s}`, 'off'))),
    offMinusShuffled: SEEDS.map(s => r4(score(`${p}-${s}`, 'off') - score(`${p}-${s}`, 'shuffled'))),
  }])),
  toxicBites: Object.fromEntries(PRIORS.flatMap(p => CUES.map(c => [`${p}|${c}`, +mean(SEEDS.flatMap(s => INVERSIONS.flatMap(i => (fits[`${p}-${s}`][`${c}|${i}`] ?? []).map(r => r.toxicBites)))).toFixed(0)]))),
  survival: Object.fromEntries(PRIORS.flatMap(p => CUES.map(c => [`${p}|${c}`, r4(mean(SEEDS.flatMap(s => INVERSIONS.flatMap(i => (fits[`${p}-${s}`][`${c}|${i}`] ?? []).map(r => r.survival)))))]))),
  neverEatsShare,
};

writeFileSync(`${out}/results.json`, JSON.stringify({
  protocol: 'docs/PREREGISTRATION_11.md', sharded: { shards, files: files.length },
  worldsPerCell: 32, K: 4, harmCap: 4, seasonTicks: 300, poolLimit: 1000, inversions: INVERSIONS, seeds: SEEDS,
  coverage, interpretation, primary: verdicts, secondary,
}, null, 2));
console.log(JSON.stringify({ coverage, interpretation, primary: verdicts }, null, 1));
