// 结构化个体的跨环境配对比较：静态训练 / 漂移训练 / 无先验漂移训练的基因，在静态与漂移测试世界（新描述词）上，
// 对手写探索型变体与预言机。用法：node packages/evo/structured-compare.ts <新输出目录> [--seeds N]
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { runSemanticWorld, loadPriors, layaRule, explorerRule, oracleRule, blindRule, type SemanticFactory } from './semantic-run.ts';
import { structuredCohort, decodeGenes } from './structured.ts';

const out = process.argv[2]; if (!out) throw Error('Usage: node packages/evo/structured-compare.ts <new-output-directory> [--seeds N]');
const N = Number(process.argv[process.argv.indexOf('--seeds') + 1]) || 24; mkdirSync(out, { recursive: false });
const priors = loadPriors(), mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const latest = (dir: string): { genes: number[]; generation: string } | null => {
  if (existsSync(`${dir}/final.json`)) return { genes: JSON.parse(readFileSync(`${dir}/final.json`, 'utf8')).innate, generation: 'final' };
  const f = existsSync(dir) ? readdirSync(dir).filter(x => x.startsWith('theta-gen')).sort().at(-1) : undefined; return f ? { genes: JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')).innate, generation: f.replace(/\D/g, '') } : null;
};
const variants: Record<string, SemanticFactory> = { 'blind-rule': blindRule, 'laya-rule（不学习）': layaRule(priors), 'explorer（手写基线）': explorerRule(priors), 'explorer 遗忘0.15+重试0.02（手写）': explorerRule(priors, { forget: .15, retry: .02 }), 'oracle（时间感知真值）': oracleRule };
const info: Record<string, unknown> = {};
for (const [name, dir, prior] of [['进化·Laya先验·静态训练', 'st-laya-static-01', 'laya'], ['进化·Laya先验·漂移训练', 'st-laya-drift-01', 'laya'], ['进化·无先验·漂移训练', 'st-none-drift-01', 'none']] as const) {
  const g = latest(`experiments/evo/${dir}`); if (!g) continue;
  info[name] = { checkpoint: g.generation, rawGenes: g.genes.map(x => +x.toFixed(3)), decoded: Object.fromEntries(Object.entries(decodeGenes(g.genes)).map(([k, v]) => [k, +v.toFixed(3)])) };
  variants[name] = () => structuredCohort(g.genes, prior, priors);
}
let rs = 7; const rand = () => { rs = (rs + 0x6D2B79F5) >>> 0; let t = rs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ci = (a: number[], b: number[]) => { const d = a.map((x, i) => x - b[i]), bs = Array.from({ length: 2000 }, () => mean(d.map(() => d[Math.floor(rand() * d.length)]))).sort((x, y) => x - y); return { diff: +mean(d).toFixed(4), lo: +bs[50].toFixed(4), hi: +bs[1949].toFixed(4) }; };
const result: Record<string, unknown> = { purpose: '结构化个体跨环境配对比较（测试划分新描述词；开发评估，非留出）。oracle 读取隐藏真值，仅度量上限。', seeds: N, evolved: info };
const worlds: [string, number, object | undefined][] = [['静态·常识正常', 0, undefined], ['静态·25%反转', .25, undefined], ['漂移·常识正常', 0, { everyTicks: 1200, fraction: .5 }], ['漂移·25%反转', .25, { everyTicks: 1200, fraction: .5 }]];
for (const [label, inversion, drift] of worlds) {
  const specs = Array.from({ length: N }, (_, i) => ({ seed: 70000 + i + (inversion ? 1000 : 0) + (drift ? 2000 : 0), options: { split: 'test' as const, inversion, ...(drift ? { drift: drift as { everyTicks: number; fraction: number } } : {}) } }));
  const runs = Object.fromEntries(Object.entries(variants).map(([k, f]) => [k, specs.map(s => runSemanticWorld(s, f))])), base = runs['explorer（手写基线）'].map(r => r.fitness);
  result[label] = Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, { fitness: +mean(v.map(r => r.fitness)).toFixed(3), toxicBites: +mean(v.map(r => r.toxicBites)).toFixed(0), survival: +mean(v.map(r => r.survival)).toFixed(3), vsHandExplorer: ci(v.map(r => r.fitness), base) }]));
  console.log(label); for (const [k, v] of Object.entries(result[label] as Record<string, { fitness: number; vsHandExplorer: { diff: number; lo: number; hi: number } }>)) console.log('  ', k.padEnd(40), v.fitness, `${v.vsHandExplorer.diff >= 0 ? '+' : ''}${v.vsHandExplorer.diff} [${v.vsHandExplorer.lo}, ${v.vsHandExplorer.hi}]`);
}
writeFileSync(`${out}/results.json`, JSON.stringify(result, null, 2));
