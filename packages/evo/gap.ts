// 差距拆解：在手写探索型控制器上逐项替换信息来源或机制，量化“Laya 先验 + 个体经验”这条路各个方向的上限。
// 用法：node packages/evo/gap.ts <新输出目录> [--seeds N]。oracle* 与 share 仅为诊断，不是个体可用的信息/机制。
import { mkdirSync, writeFileSync } from 'node:fs';
import { runSemanticWorld, loadPriors, layaRule, explorerRule, oracleRule, type SemanticFactory } from './semantic-run.ts';
const out = process.argv[2]; if (!out) throw Error('Usage: node packages/evo/gap.ts <new-output-directory> [--seeds N]');
const N = Number(process.argv[process.argv.indexOf('--seeds') + 1]) || 24; mkdirSync(out, { recursive: false });
const priors = loadPriors(), mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
let rs = 7; const rand = () => { rs = (rs + 0x6D2B79F5) >>> 0; let t = rs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ci = (a: number[], b: number[]) => { const d = a.map((x, i) => x - b[i]), bs = Array.from({ length: 2000 }, () => mean(d.map(() => d[Math.floor(rand() * d.length)]))).sort((x, y) => x - y); return `${mean(d) >= 0 ? '+' : ''}${mean(d).toFixed(3)} [${bs[50].toFixed(3)}, ${bs[1949].toFixed(3)}]`; };
const variants: Record<string, SemanticFactory> = {
  'laya-rule（不学习）': layaRule(priors),
  'explorer（基线：Laya + 个体经验）': explorerRule(priors),
  'explorer，只对“模糊”试吃 → 全部先试（badAt=0）': explorerRule(priors, { badAt: 0 }),
  'explorer，不信 Laya 的“好”（goodAt=badAt=0.9：几乎都要先试）': explorerRule(priors, { goodAt: .9, badAt: .9 }),
  '【诊断】无语义词的真值已知（只需 Laya + 学习其余）': explorerRule(priors, { prior: 'oracleNonsense' }),
  '【诊断】有语义词的真值已知（无语义词靠试）': explorerRule(priors, { prior: 'oracleSensible' }),
  '【诊断·另一种机制】队列内共享经验（社会学习上限）': explorerRule(priors, { share: true }),
  'explorer，带遗忘（forget=0.1）': explorerRule(priors, { forget: .1 }),
  'oracle（全部真值）': oracleRule,
};
const result: Record<string, unknown> = { purpose: '差距拆解（开发评估，测试划分新描述词）。【诊断】项使用隐藏真值或共享经验，不是个体可用的。', seeds: N };
for (const inversion of [0, .25]) {
  const specs = Array.from({ length: N }, (_, i) => ({ seed: 60000 + i + (inversion ? 1000 : 0), options: { split: 'test' as const, inversion } }));
  const runs = Object.fromEntries(Object.entries(variants).map(([k, f]) => [k, specs.map(s => runSemanticWorld(s, f))])), base = runs['explorer（基线：Laya + 个体经验）'].map(r => r.fitness);
  const table = Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, { fitness: +mean(v.map(r => r.fitness)).toFixed(3), toxicBites: +mean(v.map(r => r.toxicBites)).toFixed(0), survival: +mean(v.map(r => r.survival)).toFixed(3), vsExplorer: ci(v.map(r => r.fitness), base) }]));
  result[String(inversion)] = table; console.log('inversion', inversion); for (const [k, v] of Object.entries(table)) console.log('  ', k.padEnd(60), JSON.stringify(v));
}
writeFileSync(`${out}/results.json`, JSON.stringify(result, null, 2));
