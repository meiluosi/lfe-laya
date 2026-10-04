// 语义世界余量测试：盲规则 / 随机 / 用 Laya 先验的规则 / 预言机，在训练与测试词汇上的表现。
// 用法：node packages/evo/headroom.ts <新输出目录> [--seeds N]
import { mkdirSync, writeFileSync } from 'node:fs';
import { blindRule, randomPolicy, layaRule, oracleRule, loadPriors, runSemanticWorld, type SemanticFactory } from './semantic-run.ts';
const out = process.argv[2]; if (!out) throw Error('Usage: node packages/evo/headroom.ts <new-output-directory> [--seeds N]');
const N = Number(process.argv[process.argv.indexOf('--seeds') + 1]) || 12; mkdirSync(out, { recursive: false });
const priors = loadPriors();
const controllers: Record<string, SemanticFactory> = { random: randomPolicy, 'blind-rule': blindRule, 'laya-rule': layaRule(priors), oracle: oracleRule };
const rows: Record<string, unknown>[] = [];
for (const split of ['train', 'test'] as const) for (const inversion of [0, .25]) for (const [name, factory] of Object.entries(controllers)) {
  const rs = Array.from({ length: N }, (_, i) => runSemanticWorld({ seed: (split === 'train' ? 30000 : 40000) + i, options: { split, inversion } }, factory));
  const mean = (k: keyof typeof rs[0]) => rs.reduce((a, r) => a + r[k], 0) / rs.length, sd = (k: keyof typeof rs[0]) => Math.sqrt(rs.reduce((a, r) => a + (r[k] - mean(k)) ** 2, 0) / (rs.length - 1));
  const row = { split, inversion, controller: name, seeds: N, fitness: +mean('fitness').toFixed(4), fitnessSd: +sd('fitness').toFixed(4), survival: +mean('survival').toFixed(4), living: +mean('living').toFixed(2), toxicBitesPerWorld: +mean('toxicBites').toFixed(1) };
  rows.push(row); console.log(JSON.stringify(row));
}
writeFileSync(`${out}/results.json`, JSON.stringify({ purpose: '语义世界余量测试（开发/诊断）。预言机读取隐藏真值，仅度量上限。训练种子 30000+，测试词汇种子 40000+；不是留出实验。场景 semantic 的食物供给只在训练划分上调节（8 个种子，供给 10/14/18 中选 14：盲 0.22、Laya 规则 0.50、预言机 0.69）。', note: 'inversion=0.25 时 25% 的描述词与真实影响相反（常识线索失效）。', rows }, null, 2));
