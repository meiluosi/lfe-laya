// W7 开发期预实验（非确认性，第三轮）：K 与季节长度可配置；个体命名 <先验>-<训练线索>-s<种子>。评估措辞 B，留出方言前 1000 条。
// 用法：node packages/evo/ripening-dev3.ts <基因组目录> [--worlds N] [--K 16] [--season 300]
import { readFileSync, readdirSync } from 'node:fs';
import { registerPools, loadLayaPriors, vaderPrior, type Priors } from './pools.ts';
import { runSemanticWorld, oracleRule, blindRule, type SemanticFactory } from './semantic-run.ts';
import { structuredCohort, decodeGenes } from './structured.ts';
const a = process.argv, dir = a[2], opt = (n: string, d: number) => a.includes(n) ? Number(a[a.indexOf(n) + 1]) : d, N = opt('--worlds', 12), K = opt('--K', 16), SEASON = opt('--season', 300);
registerPools(); const priors: Record<string, Priors> = { laya: loadLayaPriors('heldout'), none: new Map(), vader: vaderPrior() };
const names = readdirSync(dir).filter(n => /^(laya|none|vader)-(language|off)-s\d+$/.test(n)).sort();
const mean = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length;
const systems: Record<string, SemanticFactory> = { blind: blindRule, oracle: oracleRule };
for (const n of names) { const g = JSON.parse(readFileSync(`${dir}/${n}/final.json`, 'utf8')).innate as number[], p = n.split('-')[0]; systems[n] = () => structuredCohort(g, p === 'none' ? 'none' : 'laya', priors[p]); }
const rows: Record<string, Record<string, number>> = {}, tox: Record<string, Record<string, number>> = {};
for (const cues of ['language', 'off', 'shuffled'] as const) for (const [name, f] of Object.entries(systems)) {
  const rs = [.25, .4].flatMap((inv, ci) => Array.from({ length: N }, (_, i) => runSemanticWorld({ seed: 400000 + i + ci * 1000, options: { split: 'test', pool: 'heldout', sensible: K, harmCap: 4, inversion: inv, ripening: { seasonTicks: SEASON, cues, phrases: 'B', poolLimit: 1000 } } }, f)));
  (rows[name] ??= {})[`eval:${cues}`] = +mean(rs.map(r => r.fitness)).toFixed(3); (tox[name] ??= {})[`eval:${cues}`] = +mean(rs.map(r => r.toxicBites)).toFixed(0);
}
console.log('fitness'); console.table(rows); console.log('toxic bites'); console.table(tox);
for (const n of names) { const d = decodeGenes(JSON.parse(readFileSync(`${dir}/${n}/final.json`, 'utf8')).innate); console.log(n, JSON.stringify(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, +v.toFixed(2)])))); }
