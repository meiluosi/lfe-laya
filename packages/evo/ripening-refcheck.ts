// 预注册 10 逐世界参照输出（仅用于等价性验证，不属于任何协议）：
// 按显式给定的 spec 列表跑一轮单进程，输出 fitness / toxicBites / survival，
// 用于与 packages/evo/ripening-eval-shard.ts 逐世界比对。
// 用法：node packages/evo/ripening-refcheck.ts <spec列表.json> <输出.json>
// spec 列表格式：[{ pool, p, s, cues, inv, seq, base, K?, harmCap?, season?, poolLimit? }]
import { readFileSync, writeFileSync } from 'node:fs';
import { runSemanticWorld, type SemanticFactory } from './semantic-run.ts';
import { registerPools, loadLayaPriors, vaderPrior, type Priors } from './pools.ts';
import { structuredCohort } from './structured.ts';

const [specFile, outFile] = process.argv.slice(2);
const specs = JSON.parse(readFileSync(specFile, 'utf8')) as { pool: string; p: string; s: number; cues: string; inv: number; seq: number; base: number; K?: number; harmCap?: number; season?: number; poolLimit?: number }[];
registerPools();
const pools = [...new Set(specs.map(x => x.pool))];
const priorT: Record<string, Record<string, Priors>> = {};
for (const pool of pools) priorT[pool] = { laya: loadLayaPriors(pool as 'test'), none: new Map<string, number>(), vader: vaderPrior() };
const out: Record<string, { fitness: number; toxicBites: number; survival: number }> = {};
for (const x of specs) {
  const g: number[] = JSON.parse(readFileSync(`experiments/evo/f10-${x.p}-${x.s}/final.json`, 'utf8')).innate;
  const f: SemanticFactory = () => structuredCohort(g, x.p === 'none' ? 'none' : 'laya', priorT[x.pool][x.p]);
  const r = runSemanticWorld({ seed: x.base + x.seq + (x.inv === 0.4 ? 10000 : 0), options: { split: 'test', pool: x.pool, sensible: x.K ?? 16, harmCap: x.harmCap ?? 4, inversion: x.inv, ripening: { seasonTicks: x.season ?? 300, cues: x.cues as 'language' | 'off' | 'shuffled', phrases: 'B' as const, poolLimit: x.poolLimit ?? 1000 } } }, f);
  out[`${x.pool}|${x.p}-${x.s}|${x.cues}|${x.inv}|${x.seq}`] = { fitness: r.fitness, toxicBites: r.toxicBites, survival: r.survival };
}
writeFileSync(outFile, JSON.stringify(out));
console.log(`参照 ${Object.keys(out).length} 个世界 → ${outFile}`);
