// 独立来源的评估词池：UCI Mushroom 数据集（CC BY 4.0，doi 10.24432/C5959T；data/external/uci-mushroom/）。
// 食物描述由真实记录的属性值生成（每条随机抽 7 个属性，固定随机流），可食 / 有毒标签来自数据集，不是我们写的。
// 可食 → 营养（+1），有毒 → 有害（−1，含“未知可食性并入有毒”的记录）。用法：node packages/evo/make-mushroom-pool.ts
import { readFileSync, writeFileSync } from 'node:fs';
const rows = readFileSync(new URL('../../data/external/uci-mushroom/agaricus-lepiota.data', import.meta.url), 'utf8').trim().split('\n').map(l => l.split(','));
const colors: Record<string, string> = { n: 'brown', b: 'buff', c: 'cinnamon', g: 'gray', r: 'green', p: 'pink', u: 'purple', e: 'red', w: 'white', y: 'yellow', k: 'black', h: 'chocolate', o: 'orange' };
// 每个属性：值代码 → 短语（顺序与数据列一致，第 0 列是类别）
const A: Record<string, string>[] = [
  { x: 'a convex cap', b: 'a bell-shaped cap', c: 'a conical cap', f: 'a flat cap', k: 'a knobbed cap', s: 'a sunken cap' },
  { f: 'a fibrous cap surface', g: 'a grooved cap surface', y: 'a scaly cap surface', s: 'a smooth cap surface' },
  Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, `a ${v} cap`])),
  { t: 'it bruises when handled', f: 'it does not bruise' },
  { a: 'an almond smell', l: 'an anise smell', c: 'a creosote smell', y: 'a fishy smell', f: 'a foul smell', m: 'a musty smell', n: 'no noticeable smell', p: 'a pungent smell', s: 'a spicy smell' },
  { a: 'attached gills', d: 'descending gills', f: 'free gills', n: 'notched gills' },
  { c: 'closely spaced gills', w: 'crowded gills', d: 'distantly spaced gills' },
  { b: 'broad gills', n: 'narrow gills' },
  Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, `${v} gills`])),
  { e: 'an enlarging stalk', t: 'a tapering stalk' },
  { b: 'a bulbous stalk base', c: 'a club-shaped stalk base', u: 'a cup-shaped stalk base', e: 'an equal stalk base', z: 'a rhizomorphic stalk base', r: 'a rooted stalk base', '?': 'a stalk base hidden from view' },
  { f: 'a fibrous stalk above the ring', y: 'a scaly stalk above the ring', k: 'a silky stalk above the ring', s: 'a smooth stalk above the ring' },
  { f: 'a fibrous stalk below the ring', y: 'a scaly stalk below the ring', k: 'a silky stalk below the ring', s: 'a smooth stalk below the ring' },
  Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, `a ${v} stalk above the ring`])),
  Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, `a ${v} stalk below the ring`])),
  { p: 'a partial veil', u: 'a universal veil' },
  Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, `a ${v} veil`])),
  { n: 'no ring', o: 'one ring', t: 'two rings' },
  { c: 'a cobwebby ring', e: 'an evanescent ring', f: 'a flaring ring', l: 'a large ring', n: 'no ring type', p: 'a pendant ring', s: 'a sheathing ring', z: 'a zoned ring' },
  Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, `a ${v} spore print`])),
  { a: 'it grows abundantly', c: 'it grows in clusters', n: 'it grows in numbers', s: 'it grows scattered', v: 'it grows in several places', y: 'it grows solitary' },
  { g: 'found among grasses', l: 'found among leaves', m: 'found in meadows', p: 'found along paths', u: 'found on urban ground', w: 'found on waste ground', d: 'found in woods' },
];
let s = 20261028; const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const seen = new Set<string>(), pool: { text: string; dialect: string; tier: string; factor: number; cuePolarity: number; clauses: number }[] = [];
for (const r of rows) {
  const idx = Array.from({ length: 22 }, (_, i) => i); for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const keep = idx.slice(0, 7).sort((a, b) => a - b), parts = keep.map(i => { const v = A[i][r[i + 1]]; if (!v) throw Error(`unmapped ${i} ${r[i + 1]}`); return v; });
  const text = `A mushroom with ${parts.join('; ')}.`.replace(/with it /g, 'with ').replace(/; it /g, '; ');
  if (seen.has(text)) continue; seen.add(text);
  pool.push({ text, dialect: 'mushroom', tier: r[0] === 'e' ? 'nutritive' : 'strong', factor: r[0] === 'e' ? 1 : -1, cuePolarity: 0, clauses: 7 });
}
// 与其他评估池同规模：固定随机流抽 4000 条（不分层，保持数据集的自然比例）
for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
pool.length = Math.min(pool.length, 4000);
writeFileSync(new URL('./pools/mushroom.json', import.meta.url), JSON.stringify(pool) + '\n');
console.log(`mushroom: ${pool.length} entries, edible ${pool.filter(e => e.factor > 0).length}, poisonous ${pool.filter(e => e.factor < 0).length}`);
console.log(pool.slice(0, 3).map(e => e.text).join('\n'));
