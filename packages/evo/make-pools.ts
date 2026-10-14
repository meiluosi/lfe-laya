// 生成训练/测试词池（含隐藏属性，仅供世界生成与度量；个体永远只看到 text）。用法：node packages/evo/make-pools.ts [--train N] [--test N]
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { generatePool } from './ontology.ts';
const arg = (n: string, d: number) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? Number(process.argv[i + 1]) : d; };
mkdirSync(new URL('./pools', import.meta.url), { recursive: true });
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '';
if (!only || only === 'factual-train') {   // 事实方言的训练池：同一方言、不同随机流，且剔除评估池 factual 中出现过的文本
  const evalTexts = new Set((JSON.parse(readFileSync(new URL('./pools/factual.json', import.meta.url), 'utf8')) as { text: string }[]).map(e => e.text));
  const pool = generatePool('factual', arg('factualTrain', 12000) + 6000, 2).filter(e => !evalTexts.has(e.text)).slice(0, arg('factualTrain', 12000));
  if (pool.length < arg('factualTrain', 12000)) throw Error('pool_exhausted');
  writeFileSync(new URL('./pools/factual-train.json', import.meta.url), JSON.stringify(pool) + '\n'); console.log(`factual-train: ${pool.length} entries`);
}
for (const [dialect, n, seed] of ([['train', arg('train', 12000), 1], ['test', arg('test', 4000), 1], ['heldout', arg('heldout', 4000), 1], ['factual', arg('factual', 4000), 1]] as const).filter(x => !only || x[0] === only)) {
  const pool = generatePool(dialect, n, seed); writeFileSync(new URL(`./pools/${dialect}.json`, import.meta.url), JSON.stringify(pool) + '\n'); console.log(`${dialect}: ${pool.length} entries`);
}
