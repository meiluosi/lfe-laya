// 漂移世界里的“持续适应”：手写探索型控制器 × 遗忘 × 重新试探 × 软先验，对 Laya 先验规则与时间感知的预言机。
// 用法：node packages/evo/drift.ts <新输出目录> [--seeds N]。世界：每 1200 步切换一次阶段（A/B/A），半数种类的真实影响在 B 阶段取反。
import { mkdirSync, writeFileSync } from 'node:fs';
import { runSemanticWorld, loadPriors, layaRule, explorerRule, oracleRule, blindRule, type SemanticFactory } from './semantic-run.ts';
const out = process.argv[2]; if (!out) throw Error('Usage: node packages/evo/drift.ts <new-output-directory> [--seeds N]');
const N = Number(process.argv[process.argv.indexOf('--seeds') + 1]) || 24; mkdirSync(out, { recursive: false });
const priors = loadPriors(), mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
let rs = 7; const rand = () => { rs = (rs + 0x6D2B79F5) >>> 0; let t = rs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ci = (a: number[], b: number[]) => { const d = a.map((x, i) => x - b[i]), bs = Array.from({ length: 2000 }, () => mean(d.map(() => d[Math.floor(rand() * d.length)]))).sort((x, y) => x - y); return `${mean(d) >= 0 ? '+' : ''}${mean(d).toFixed(3)} [${bs[50].toFixed(3)}, ${bs[1949].toFixed(3)}]`; };
const soft = { badAt: 0 };
const variants: Record<string, SemanticFactory> = {
  'blind-rule': blindRule, 'laya-rule（不学习）': layaRule(priors),
  'explorer（无遗忘，无重试）': explorerRule(priors),
  'explorer，遗忘 0.15': explorerRule(priors, { forget: .15 }),
  'explorer，重试 0.02': explorerRule(priors, { retry: .02 }),
  'explorer，遗忘 0.15 + 重试 0.02': explorerRule(priors, { forget: .15, retry: .02 }),
  'explorer，遗忘 0.15 + 重试 0.05': explorerRule(priors, { forget: .15, retry: .05 }),
  '软先验（全部先试）+ 遗忘 0.15 + 重试 0.02': explorerRule(priors, { ...soft, forget: .15, retry: .02 }),
  'oracle（时间感知真值）': oracleRule,
};
const result: Record<string, unknown> = { purpose: '漂移世界（每 1200 步切换，半数种类影响取反）的持续适应。开发评估，测试划分新描述词；oracle 读取隐藏真值，仅度量上限。', seeds: N };
for (const inversion of [0, .25]) {
  const specs = Array.from({ length: N }, (_, i) => ({ seed: 60000 + i + (inversion ? 1000 : 0), options: { split: 'test' as const, inversion, drift: { everyTicks: 1200, fraction: .5 } } }));
  const runs = Object.fromEntries(Object.entries(variants).map(([k, f]) => [k, specs.map(s => runSemanticWorld(s, f))])), base = runs['explorer（无遗忘，无重试）'].map(r => r.fitness);
  const table = Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, { fitness: +mean(v.map(r => r.fitness)).toFixed(3), toxicBites: +mean(v.map(r => r.toxicBites)).toFixed(0), survival: +mean(v.map(r => r.survival)).toFixed(3), vsPlainExplorer: ci(v.map(r => r.fitness), base) }]));
  result[String(inversion)] = table; console.log('inversion', inversion); for (const [k, v] of Object.entries(table)) console.log('  ', k.padEnd(48), JSON.stringify(v));
}
writeFileSync(`${out}/results.json`, JSON.stringify(result, null, 2));
