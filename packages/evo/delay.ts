// 延迟后果：朴素即时记录 vs 延迟信用分配（把之后出现的能量冲击归因到最近吃过的种类）。
// 用法：node packages/evo/delay.ts <新输出目录> [--K 16] [--seeds 12]。世界来自测试方言词池；oracle 读取隐藏真值，仅度量上限。
import { mkdirSync, writeFileSync } from 'node:fs';
import { runSemanticWorld, explorerRule, oracleRule, blindRule, type SemanticFactory } from './semantic-run.ts';
import { registerPools, loadLayaPriors } from './pools.ts';
const args = process.argv.slice(2), out = args[0]; if (!out) throw Error('Usage: node packages/evo/delay.ts <new-output-directory> [--K 16] [--seeds 12]');
const opt = (n: string, d: number) => { const i = args.indexOf(`--${n}`); return i >= 0 ? Number(args[i + 1]) : d; };
const K = opt('K', 16), N = opt('seeds', 12); mkdirSync(out, { recursive: false }); registerPools();
const priors = loadLayaPriors('test'), none = new Map<string, number>(), mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const result: Record<string, unknown> = { purpose: '延迟后果下的信用分配（开发评估；测试方言；手写控制器）', K, seeds: N };
for (const delay of [0, 20, 60]) {
  const specs = Array.from({ length: N }, (_, i) => ({ seed: 120000 + i + delay * 100, options: { split: 'test' as const, pool: 'test', sensible: K, delay: delay || undefined } }));
  const W = delay + 30;
  const V: Record<string, SemanticFactory> = { blind: blindRule, '无先验·朴素记录': explorerRule(none, { mode: 'none' }), '无先验·延迟归因': explorerRule(none, { mode: 'none', creditWindow: W }),
    'Laya硬先验·朴素记录': explorerRule(priors, { mode: 'veto' }), 'Laya硬先验·延迟归因': explorerRule(priors, { mode: 'veto', creditWindow: W }), 'Laya自适应·延迟归因': explorerRule(priors, { mode: 'adaptive', creditWindow: W }), oracle: oracleRule };
  const row: Record<string, unknown> = {};
  for (const [name, f] of Object.entries(V)) { const rs = specs.map(s => runSemanticWorld(s, f)); row[name] = { fitness: +mean(rs.map(r => r.fitness)).toFixed(3), toxicBites: +mean(rs.map(r => r.toxicBites)).toFixed(0), survival: +mean(rs.map(r => r.survival)).toFixed(3) }; }
  result[`delay${delay}`] = row; console.log('delay', delay); for (const [k, v] of Object.entries(row)) console.log('  ', k.padEnd(26), JSON.stringify(v));
}
writeFileSync(`${out}/results.json`, JSON.stringify(result, null, 2));
