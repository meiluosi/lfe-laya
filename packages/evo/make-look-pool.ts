// W8b：邻居外观的文本池（供 laya_prior_pool.py 预先计算先验）。用法：node packages/evo/make-look-pool.ts → packages/evo/pools/looks.json
import { writeFileSync } from 'node:fs';
import { LOOK_PHRASES, lookText } from './semantic.ts';
const out = (['A', 'B'] as const).flatMap(s => (['harm', 'boost', 'calm'] as const).flatMap(k => LOOK_PHRASES[s][k].map(p => ({ text: lookText(p) }))));
writeFileSync(new URL('./pools/looks.json', import.meta.url), JSON.stringify(out) + '\n'); console.log(`looks: ${out.length} texts`);
