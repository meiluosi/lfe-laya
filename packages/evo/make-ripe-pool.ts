// W7：生成“阶段化描述”的文本池（描述 + 阶段短语），供 laya_prior_pool.py 预先计算 Laya 先验。只依赖文本。
// 用法：node packages/evo/make-ripe-pool.ts <方言池名> <A|B> <前 N 条>   → packages/evo/pools/<池名>-ripe-<A|B>.json
import { writeFileSync } from 'node:fs';
import { loadPoolFile } from './pools.ts';
import { STAGE_PHRASES } from './semantic.ts';
const [name, set, n] = process.argv.slice(2); if (!name || (set !== 'A' && set !== 'B') || !n) throw Error('Usage: node packages/evo/make-ripe-pool.ts <pool> <A|B> <N>');
const pool = loadPoolFile(name).slice(0, Number(n)), out = pool.flatMap(e => STAGE_PHRASES[set].map(p => ({ text: `${e.text} ${p}` })));
if (out.some(e => e.text.length > 240 || !/^[ -~]+$/.test(e.text))) throw Error('text_limit');
writeFileSync(new URL(`./pools/${name}-ripe-${set}.json`, import.meta.url), JSON.stringify(out) + '\n'); console.log(`${name}-ripe-${set}: ${out.length} texts`);
