// 导出所有可能出现的语义食物描述词（含训练/测试划分），供 Laya 先验表预计算。
// 用法：node packages/evo/export-descriptors.ts   → packages/evo/semantic-descriptors.json
import { writeFileSync } from 'node:fs';
import { allDescriptors } from './semantic.ts';
const list = allDescriptors(); writeFileSync(new URL('./semantic-descriptors.json', import.meta.url), JSON.stringify(list, null, 1) + '\n'); console.log(`wrote ${list.length} descriptors`);
