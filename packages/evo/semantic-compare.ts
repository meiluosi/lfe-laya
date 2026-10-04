// 2×2 进化结果的同种子配对比较（测试划分：全新描述词）。用法：
//   node packages/evo/semantic-compare.ts <新输出目录> [--seeds N] [--theta none-off=path ...]
// 默认读取 experiments/evo/sem-{none,laya}-{off,on}-01/final.json（若不存在则用最新的 theta-gen*.json）。
// 同一批世界种子上所有控制器配对；差值用 bootstrap 95% 置信区间。包含“损伤”对照：同一基因组在测试时关掉终身学习或关掉先验。
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { runSemanticWorld, loadPriors, blindRule, layaRule, oracleRule, randomPolicy, type SemanticFactory } from './semantic-run.ts';
import { semanticCohort, type SemCondition } from './sempolicy.ts';

const args = process.argv.slice(2), out = args[0]; if (!out) throw Error('Usage: node packages/evo/semantic-compare.ts <new-output-directory> [--seeds N]');
const N = Number(args[args.indexOf('--seeds') + 1]) || 24, SUFFIX = args.includes('--suffix') ? args[args.indexOf('--suffix') + 1] : '01'; mkdirSync(out, { recursive: false });
const priors = loadPriors();
function loadTheta(name: string): { innate: number[]; generation: string } | null {
  const dir = `experiments/evo/sem-${name}-${SUFFIX}`; if (existsSync(`${dir}/final.json`)) return { innate: JSON.parse(readFileSync(`${dir}/final.json`, 'utf8')).innate, generation: 'final' };
  if (!existsSync(dir)) return null; const files = readdirSync(dir).filter(f => f.startsWith('theta-gen')).sort(); if (!files.length) return null;
  return { innate: JSON.parse(readFileSync(`${dir}/${files.at(-1)}`, 'utf8')).innate, generation: files.at(-1)!.replace('theta-gen', '').replace('.json', '') };
}
const evolved = (innate: number[], cond: SemCondition): SemanticFactory => kinds => semanticCohort(innate, cond, cond.prior === 'oracle' ? new Map(kinds.map(k => [k.description, (k.factor + 1) / 2])) : priors);
const controllers: Record<string, SemanticFactory> = { random: randomPolicy, 'blind-rule': blindRule, 'laya-rule': layaRule(priors), oracle: oracleRule };
const info: Record<string, string> = {};
for (const [prior, learning] of [['none', 'off'], ['none', 'on'], ['laya', 'off'], ['laya', 'on'], ['oracle', 'off']] as const) {
  const th = loadTheta(`${prior}-${learning}`); if (!th) continue; info[`evolved ${prior}/${learning}`] = th.generation;
  controllers[`evolved ${prior}/${learning}`] = evolved(th.innate, { prior, learning: learning === 'on' });
  if (prior === 'laya' && learning === 'on') {   // 损伤对照：同一基因组，测试时去掉某一部分
    controllers['lesion: laya/on genome, learning off'] = evolved(th.innate, { prior: 'laya', learning: false });
    controllers['lesion: laya/on genome, prior off'] = evolved(th.innate, { prior: 'none', learning: true });
  }
}
const specs = (inversion: number) => Array.from({ length: N }, (_, i) => ({ seed: 60000 + i + (inversion ? 1000 : 0), options: { split: 'test' as const, inversion } }));
const results: Record<string, Record<string, number[]>> = {};   // [inversion][controller] = 每个种子的适应度
for (const inv of [0, .25]) { results[String(inv)] = {}; for (const [name, f] of Object.entries(controllers)) { results[String(inv)][name] = specs(inv).map(s => runSemanticWorld(s, f).fitness); console.log(inv, name, (results[String(inv)][name].reduce((a, b) => a + b, 0) / N).toFixed(3)); } }
let rs = 12345; const rand = () => { rs = (rs + 0x6D2B79F5) >>> 0; let t = rs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function pairedCi(a: number[], b: number[]) { const d = a.map((x, i) => x - b[i]), boots = Array.from({ length: 2000 }, () => mean(d.map(() => d[Math.floor(rand() * d.length)]))).sort((x, y) => x - y); return { diff: +mean(d).toFixed(4), lo: +boots[50].toFixed(4), hi: +boots[1949].toFixed(4) }; }
const names = Object.keys(controllers), table: Record<string, unknown> = {}, pairs: Record<string, Record<string, unknown>> = {};
const compareAgainst = ['blind-rule', 'laya-rule', 'evolved none/off', 'evolved laya/off', 'evolved oracle/off'].filter(n => n in controllers);
for (const inv of Object.keys(results)) {
  table[inv] = Object.fromEntries(names.map(n => [n, { mean: +mean(results[inv][n]).toFixed(4), sd: +Math.sqrt(results[inv][n].reduce((a, x) => a + (x - mean(results[inv][n])) ** 2, 0) / (N - 1)).toFixed(4) }]));
  pairs[inv] = {}; for (const n of names) for (const ref of compareAgainst) if (n !== ref) pairs[inv][`${n} − ${ref}`] = pairedCi(results[inv][n], results[inv][ref]);
}
writeFileSync(`${out}/results.json`, JSON.stringify({ purpose: '2×2 进化结果的配对比较（测试划分，新描述词；开发评估，不是留出实验）', seeds: N, seedBase: 60000, evolvedCheckpoints: info, means: table, pairedDifferences95CI: pairs, perSeed: results }, null, 2));
console.log(JSON.stringify(table, null, 1));
