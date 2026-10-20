// 先天线性头开发期预实验（非确认性）：比较 f7（d40、无头）的 laya / none 个体与带先天头的个体，匹配延迟 40，留出方言与事实方言。
// 用法：node packages/evo/head-dev.ts <头基因组目录> [--worlds N]；目录下为 <none|laya>-head-s<种子>/final.json
import { readFileSync, readdirSync } from 'node:fs';
import { registerPools, loadLayaPriors, loadEmbeddings, type Priors } from './pools.ts';
import { runSemanticWorld, type SemanticFactory } from './semantic-run.ts';
import { structuredCohort } from './structured.ts';
import { structuredHeadCohort, decodeHeadGenes } from './structured-head.ts';
const dir = process.argv[2], N = process.argv.includes('--worlds') ? Number(process.argv[process.argv.indexOf('--worlds') + 1]) : 16;
registerPools(); const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const heads = readdirSync(dir).filter(n => /^(none|laya)-head-s\d+$/.test(n)).sort();
for (const pool of ['heldout', 'factual'] as const) {
  const laya = loadLayaPriors(pool), emb = loadEmbeddings(pool), none: Priors = new Map(), systems: Record<string, SemanticFactory> = {};
  for (const s of [31, 32]) for (const p of ['laya', 'none'] as const) { const g = JSON.parse(readFileSync(`experiments/evo/f7-${p}-d40-${s}/final.json`, 'utf8')).innate as number[]; systems[`f7-${p}-d40-${s}（无头）`] = () => structuredCohort(g, p === 'none' ? 'none' : 'laya', p === 'laya' ? laya : none); }
  for (const n of heads) { const g = JSON.parse(readFileSync(`${dir}/${n}/final.json`, 'utf8')).innate as number[], p = n.split('-')[0] as 'none' | 'laya'; systems[n] = () => structuredHeadCohort(g, p === 'none' ? 'none' : 'laya', p === 'laya' ? laya : none, emb); }
  const rows: Record<string, { fitness: number; toxic: number; survival: number }> = {};
  for (const [name, f] of Object.entries(systems)) { const rs = [.25, .4].flatMap((inv, ci) => Array.from({ length: N }, (_, i) => runSemanticWorld({ seed: 600000 + i + ci * 1000, options: { split: 'test', pool, sensible: 32, harmCap: 4, inversion: inv, delay: 40 } }, f))); rows[name] = { fitness: +mean(rs.map(r => r.fitness)).toFixed(3), toxic: +mean(rs.map(r => r.toxicBites)).toFixed(0), survival: +mean(rs.map(r => r.survival)).toFixed(3) }; }
  console.log(`== ${pool}`); console.table(rows);
}
for (const n of heads) { const d = decodeHeadGenes(JSON.parse(readFileSync(`${dir}/${n}/final.json`, 'utf8')).innate); console.log(n, 'trust', +d.trust.toFixed(2), 'scale', +d.scale.toFixed(2), 'credit', d.credit, '|w|', +Math.hypot(...d.w).toFixed(2), 'b', +d.b.toFixed(2)); }
