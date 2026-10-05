// 食物种类数 K 的扫描：先验的价值是否随种类变多而上升？比较 无先验（全试）/ 软先验（只排序）/ 硬先验（否决）/ 盲规则 / 预言机。
// 用法：node packages/evo/ksweep.ts <新输出目录> [--seeds N]。所有控制器为手写规则骨架 + 个体经验；oracle 读取隐藏真值，仅度量上限。
import { mkdirSync, writeFileSync } from 'node:fs';
import { runSemanticWorld, loadPriors, explorerRule, oracleRule, blindRule, type SemanticFactory } from './semantic-run.ts';
const out = process.argv[2]; if (!out) throw Error('Usage: node packages/evo/ksweep.ts <new-output-directory> [--seeds N]');
const N = Number(process.argv[process.argv.indexOf('--seeds') + 1]) || 24, KS = (process.argv.includes('--ks') ? process.argv[process.argv.indexOf('--ks') + 1] : '8,16,32,48').split(',').map(Number); mkdirSync(out, { recursive: false });
const priors = loadPriors(), mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
let rs = 7; const rand = () => { rs = (rs + 0x6D2B79F5) >>> 0; let t = rs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ci = (a: number[], b: number[]) => { const d = a.map((x, i) => x - b[i]), bs = Array.from({ length: 2000 }, () => mean(d.map(() => d[Math.floor(rand() * d.length)]))).sort((x, y) => x - y); return { diff: +mean(d).toFixed(4), lo: +bs[50].toFixed(4), hi: +bs[1949].toFixed(4) }; };
const variants: Record<string, SemanticFactory> = { blind: blindRule, '无先验（全试+经验）': explorerRule(priors, { mode: 'none' }), '软先验（全试，先吃Laya看好的）': explorerRule(priors, { mode: 'soft' }), '硬先验（Laya否决）': explorerRule(priors, { mode: 'veto' }), '自适应信任': explorerRule(priors, { mode: 'adaptive' }), oracle: oracleRule };
const result: Record<string, unknown> = { purpose: '食物种类数 K 扫描（测试划分新描述词；开发评估）。hand-coded 规则骨架 + 个体经验；oracle 仅度量上限。', seeds: N };
for (const inversion of [0, .25]) for (const K of KS) {
  const specs = Array.from({ length: N }, (_, i) => ({ seed: 90000 + i + K * 100 + (inversion ? 50000 : 0), options: { split: 'test' as const, inversion, sensible: K - 2, nonsense: 2 } }));
  const runs = Object.fromEntries(Object.entries(variants).map(([k, f]) => [k, specs.map(s => runSemanticWorld(s, f))])), none = runs['无先验（全试+经验）'].map(r => r.fitness);
  const row = Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, { fitness: +mean(v.map(r => r.fitness)).toFixed(3), toxicBites: +mean(v.map(r => r.toxicBites)).toFixed(0), vsNoPrior: ci(v.map(r => r.fitness), none) }]));
  result[`inv${inversion}-K${K}`] = row; console.log(`inversion ${inversion} K=${K}`); for (const [k, v] of Object.entries(row)) console.log('  ', k.padEnd(28), JSON.stringify(v));
}
writeFileSync(`${out}/results.json`, JSON.stringify(result, null, 2));
