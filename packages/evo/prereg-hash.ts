// 预注册基因组哈希工具：冻结训练产物（final.json）的 sha256，供评估脚本校验。
// 用法：node packages/evo/prereg-hash.ts <输出文件.json> <基因组目录前缀> <先验列表...> --seeds 41-48
// 例：node packages/evo/prereg-hash.ts experiments/prereg/genome-hashes-09.json experiments/evo/f9 laya none vader --seeds 41-48
// 说明：本工具只读取 final.json 并计算 sha256，不参与任何训练或评估语义。
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2), out = args[0], prefix = args[1];
if (!out || !prefix) throw Error('Usage: node packages/evo/prereg-hash.ts <out.json> <dir-prefix> <prior...> --seeds A-B');
const si = args.indexOf('--seeds'), spec = args[si + 1], priors = args.slice(2, si < 0 ? undefined : si).filter(a => !a.startsWith('--'));
const [lo, hi] = spec.split('-').map(Number), seeds = []; for (let s = lo; s <= hi; s++) seeds.push(s);

const hashes: Record<string, string> = {};
for (const p of priors) for (const s of seeds) {
  const f = `${prefix}-${p}-${s}/final.json`;
  hashes[`${p}-${s}`] = createHash('sha256').update(readFileSync(f)).digest('hex');
}
writeFileSync(out, JSON.stringify(hashes, null, 1) + '\n');
console.log(`写入 ${out}：${Object.keys(hashes).length} 个基因组哈希`);
