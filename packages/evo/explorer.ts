// 手写“探索型”终身学习控制器的上限参考（不是进化结果）。用法：node packages/evo/explorer.ts <新输出目录> [--seeds N]
import { mkdirSync, writeFileSync } from 'node:fs';
import { runSemanticWorld, loadPriors, layaRule, explorerRule, oracleRule, blindRule } from './semantic-run.ts';
const out = process.argv[2]; if (!out) throw Error('Usage: node packages/evo/explorer.ts <new-output-directory> [--seeds N]');
const N = Number(process.argv[process.argv.indexOf('--seeds') + 1]) || 24; mkdirSync(out, { recursive: false });
const priors = loadPriors(), mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
let rs = 7; const rand = () => { rs = (rs + 0x6D2B79F5) >>> 0; let t = rs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ci = (a: number[], b: number[]) => { const d = a.map((x, i) => x - b[i]), bs = Array.from({ length: 2000 }, () => mean(d.map(() => d[Math.floor(rand() * d.length)]))).sort((x, y) => x - y); return { diff: +mean(d).toFixed(4), lo: +bs[50].toFixed(4), hi: +bs[1949].toFixed(4) }; };
const result: Record<string, unknown> = { purpose: '手写探索型终身学习控制器 vs Laya 先验规则（测试划分，新描述词；开发评估）。explorer：Laya 明确好则追、明确坏则避、模糊则先试一口，吃后按自己的真实后果保留或放弃；经验不共享。', seeds: N };
for (const inversion of [0, .25]) {
  const specs = Array.from({ length: N }, (_, i) => ({ seed: 60000 + i + (inversion ? 1000 : 0), options: { split: 'test' as const, inversion } }));
  const run = (f: Parameters<typeof runSemanticWorld>[1]) => specs.map(s => runSemanticWorld(s, f)), fit = (r: ReturnType<typeof run>) => r.map(x => x.fitness);
  const m = { blind: run(blindRule), layaRule: run(layaRule(priors)), explorer: run(explorerRule(priors)), oracle: run(oracleRule) };
  result[String(inversion)] = { means: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { fitness: +mean(fit(v)).toFixed(4), toxicBites: +mean(v.map(x => x.toxicBites)).toFixed(1), survival: +mean(v.map(x => x.survival)).toFixed(4) }])),
    explorerMinusLayaRule: ci(fit(m.explorer), fit(m.layaRule)), oracleMinusExplorer: ci(fit(m.oracle), fit(m.explorer)) };
}
writeFileSync(`${out}/results.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 1));
