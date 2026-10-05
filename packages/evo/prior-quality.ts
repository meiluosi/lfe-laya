// 先验质量（池层面，不涉及世界动力学）：各先验来源在测试方言上区分“营养 / 有毒”的能力。
// 用法：node packages/evo/prior-quality.ts <新输出目录>
import { mkdirSync, writeFileSync } from 'node:fs';
import { registerPools, loadLayaPriors, shuffledPrior, genericLexiconPrior, vaderPrior, trainedLexiconPrior } from './pools.ts';
const out = process.argv[2]; if (!out) throw Error('Usage: node packages/evo/prior-quality.ts <new-output-directory>'); mkdirSync(out, { recursive: false });
const pools = registerPools(), laya = loadLayaPriors('test');
const sources: Record<string, Map<string, number>> = { 'Laya（固定，缓存的真实输出）': laya, 'VADER 词典（独立来源）': vaderPrior(), '作者自写通用词典（可能偏有利）': genericLexiconPrior(), '训练方言上训练的词典': trainedLexiconPrior(pools.train), '打乱的 Laya（对照）': shuffledPrior(laya, 3) };
const auc = (pairs: [number, boolean][]) => { const pos = pairs.filter(p => p[1]).map(p => p[0]), neg = pairs.filter(p => !p[1]).map(p => p[0]).sort((a, b) => a - b); let w = 0; for (const p of pos) { let lo = 0, hi = neg.length; while (lo < hi) { const m = (lo + hi) >> 1; if (neg[m] < p) lo = m + 1; else hi = m; } let eq = lo; while (eq < neg.length && neg[eq] === p) eq++; w += lo + (eq - lo) / 2; } return w / (pos.length * neg.length); };
const rows: Record<string, unknown> = {};
for (const [name, pri] of Object.entries(sources)) {
  const all = pools.test.map(e => [pri.get(e.text) ?? .5, e.factor > 0] as [number, boolean]), inf = pools.test.filter(e => e.cuePolarity !== 0).map(e => [pri.get(e.text) ?? .5, e.factor > 0] as [number, boolean]);
  const acc = (xs: [number, boolean][]) => xs.filter(([p, y]) => (p > .5) === y).length / xs.length;
  rows[name] = { aucAll: +auc(all).toFixed(3), accAll: +acc(all).toFixed(3), aucInformative: +auc(inf).toFixed(3), accInformative: +acc(inf).toFixed(3) };
  console.log(name.padEnd(30), JSON.stringify(rows[name]));
}
writeFileSync(`${out}/results.json`, JSON.stringify({ purpose: '先验质量：测试方言池（4000 条）上区分营养/有毒的能力；informative = 至少有一条有信息的线索', n: pools.test.length, rows }, null, 2));
