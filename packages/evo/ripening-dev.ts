// W7 开发期预实验（非确认性）：评估 w7dev 里训练的个体，在成熟周期世界（评估措辞 B，留出方言前 1000 条）里的表现。
// 用法：node packages/evo/ripening-dev.ts <基因组目录前缀目录> [--worlds N]
import { readFileSync } from 'node:fs';
import { registerPools, loadLayaPriors, type Priors } from './pools.ts';
import { runSemanticWorld, oracleRule, blindRule, type SemanticFactory } from './semantic-run.ts';
import { structuredCohort, decodeGenes } from './structured.ts';
const dir = process.argv[2], N = process.argv.includes('--worlds') ? Number(process.argv[process.argv.indexOf('--worlds') + 1]) : 24;
registerPools(); const laya = loadLayaPriors('heldout'), none: Priors = new Map();
const genome = (p: string, c: string) => JSON.parse(readFileSync(`${dir}/${p}-${c}/final.json`, 'utf8')).innate as number[];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const systems: Record<string, SemanticFactory> = { blind: blindRule, oracle: oracleRule };
for (const p of ['laya', 'none']) for (const c of ['language', 'off']) { const g = genome(p, c); systems[`${p}/trained:${c}`] = () => structuredCohort(g, p === 'none' ? 'none' : 'laya', p === 'laya' ? laya : none); }
const rows: Record<string, Record<string, number>> = {};
for (const cues of ['language', 'off', 'shuffled'] as const) for (const [name, f] of Object.entries(systems)) {
  const rs = [.25, .4].flatMap((inv, ci) => Array.from({ length: N }, (_, i) => runSemanticWorld({ seed: 400000 + i + ci * 1000, options: { split: 'test', pool: 'heldout', sensible: 32, harmCap: 4, inversion: inv, ripening: { seasonTicks: 200, cues, phrases: 'B', poolLimit: 1000 } } }, f)));
  (rows[name] ??= {})[`eval:${cues}`] = +mean(rs.map(r => r.fitness)).toFixed(3);
}
console.table(rows); for (const p of ['laya', 'none']) for (const c of ['language', 'off']) console.log(p, c, 'genes', decodeGenes(genome(p, c)));
