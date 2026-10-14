// W8b 开发期预实验（非确认性）：评估 social 个体在带邻居外观的世界里的表现（评估措辞 B，留出方言）。
// 用法：node packages/evo/social-dev.ts <基因组目录> [--worlds N]；目录下为 <先验>-s<种子>/final.json
import { readFileSync, readdirSync } from 'node:fs';
import { registerPools, loadLayaPriors, vaderPrior, type Priors } from './pools.ts';
import { runSemanticWorld, oracleRule, blindRule, type SemanticFactory } from './semantic-run.ts';
import { structuredSocialCohort, decodeSocialGenes } from './structured-social.ts';
const dir = process.argv[2], N = process.argv.includes('--worlds') ? Number(process.argv[process.argv.indexOf('--worlds') + 1]) : 16;
registerPools(); const priors: Record<string, Priors> = { laya: loadLayaPriors('heldout'), none: new Map(), vader: vaderPrior() };
const names = readdirSync(dir).filter(n => /^(laya|none|vader)-s\d+$/.test(n)).sort();
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const systems: Record<string, SemanticFactory> = { blind: blindRule, oracle: oracleRule };
for (const n of names) { const g = JSON.parse(readFileSync(`${dir}/${n}/final.json`, 'utf8')).innate as number[], p = n.split('-')[0]; systems[n] = () => structuredSocialCohort(g, p === 'none' ? 'none' : 'laya', priors[p]); }
const rows: Record<string, Record<string, number>> = {}, tox: Record<string, Record<string, number>> = {};
for (const cues of ['language', 'off', 'shuffled'] as const) for (const [name, f] of Object.entries(systems)) {
  const rs = [.25, .4].flatMap((inv, ci) => Array.from({ length: N }, (_, i) => runSemanticWorld({ seed: 500000 + i + ci * 1000, options: { split: 'test', pool: 'heldout', sensible: 32, harmCap: 4, inversion: inv, social: { cues, phrases: 'B' } } }, f)));
  (rows[name] ??= {})[`eval:${cues}`] = +mean(rs.map(r => r.fitness)).toFixed(3); (tox[name] ??= {})[`eval:${cues}`] = +mean(rs.map(r => r.toxicBites)).toFixed(0);
}
console.log('fitness'); console.table(rows); console.log('toxic bites'); console.table(tox);
for (const n of names) console.log(n, 'social weight', +decodeSocialGenes(JSON.parse(readFileSync(`${dir}/${n}/final.json`, 'utf8')).innate).social.toFixed(2));
