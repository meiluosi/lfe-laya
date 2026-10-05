// 闸门（G1–G6）：判定一个关卡是否是“合格的基准”，即能否把先验、学习、进化的贡献分开。
// 用法：node packages/evo/ladder.ts <新输出目录> --K 32 [--inversion 0.25] [--seeds 24] [--dialect test] [--drift]
// 所有控制器为手写规则骨架 + 个体经验（进化个体的闸门在 W9 加入）；oracle 读取隐藏真值，仅度量上限。
import { mkdirSync, writeFileSync } from 'node:fs';
import { runSemanticWorld, explorerRule, oracleRule, blindRule, type SemanticFactory } from './semantic-run.ts';
import { registerPools, loadLayaPriors, shuffledPrior, genericLexiconPrior, trainedLexiconPrior, vaderPrior } from './pools.ts';

const args = process.argv.slice(2), out = args[0]; if (!out) throw Error('Usage: node packages/evo/ladder.ts <new-output-directory> --K 32 [--inversion 0.25] [--seeds 24] [--drift]');
const opt = (n: string, d: number) => { const i = args.indexOf(`--${n}`); return i >= 0 ? Number(args[i + 1]) : d; };
const K = opt('K', 24), inversion = opt('inversion', 0), N = opt('seeds', 24), drift = args.includes('--drift'), harmCap = opt('harmCap', 1), delay = opt('delay', 0), credit = delay ? delay + 30 : 0;
mkdirSync(out, { recursive: false });
const pools = registerPools(), priors = loadLayaPriors('test'); if (priors.size < pools.test.length) console.error(`警告：Laya 先验表不完整（${priors.size}/${pools.test.length}），缺失条目按“无语义”处理`);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
let rs = 11; const rand = () => { rs = (rs + 0x6D2B79F5) >>> 0; let t = rs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ci = (a: number[], b: number[]) => { const d = a.map((x, i) => x - b[i]), bs = Array.from({ length: 2000 }, () => mean(d.map(() => d[Math.floor(rand() * d.length)]))).sort((x, y) => x - y); return { diff: mean(d), lo: bs[50], hi: bs[1949] }; };

const none = new Map<string, number>(), shuffled = shuffledPrior(priors, 3), generic = genericLexiconPrior(), vader = vaderPrior(), trained = trainedLexiconPrior(pools.train);
const V: Record<string, SemanticFactory> = {
  blind: blindRule, oracle: oracleRule,
  learner: explorerRule(none, { mode: 'none', creditWindow: credit }),
  'laya·硬': explorerRule(priors, { mode: 'veto', creditWindow: credit }), 'laya·自适应': explorerRule(priors, { mode: 'adaptive', creditWindow: credit }),
  'shuffled·硬': explorerRule(shuffled, { mode: 'veto', creditWindow: credit }), 'shuffled·自适应': explorerRule(shuffled, { mode: 'adaptive', creditWindow: credit }),
  'vader词典·硬': explorerRule(vader, { mode: 'veto', creditWindow: credit }), 'vader词典·自适应': explorerRule(vader, { mode: 'adaptive', creditWindow: credit }),
  'generic词典·硬': explorerRule(generic, { mode: 'veto', creditWindow: credit }), 'generic词典·自适应': explorerRule(generic, { mode: 'adaptive', creditWindow: credit }),
  'trained词典·硬': explorerRule(trained, { mode: 'veto', creditWindow: credit }), 'trained词典·自适应': explorerRule(trained, { mode: 'adaptive', creditWindow: credit }),
};
const specs = Array.from({ length: N }, (_, i) => ({ seed: 100000 + i + K * 1000, options: { split: 'test' as const, pool: 'test', sensible: K, inversion, harmCap, ...(drift ? { drift: { everyTicks: 1200, fraction: .5 } } : {}), ...(delay ? { delay } : {}) } }));
const runs: Record<string, { fitness: number; toxicBites: number; survival: number }[]> = {};
for (const [name, f] of Object.entries(V)) { runs[name] = specs.map(s => runSemanticWorld(s, f)); console.log(name.padEnd(18), mean(runs[name].map(r => r.fitness)).toFixed(3)); }
const fit = (n: string) => runs[n].map(r => r.fitness), m = (n: string) => mean(fit(n));
const best = (names: string[]) => names.reduce((a, b) => m(b) > m(a) ? b : a), layaBest = best(['laya·硬', 'laya·自适应']), shufBest = best(['shuffled·硬', 'shuffled·自适应']), lexBest = best(['vader词典·硬', 'vader词典·自适应', 'trained词典·硬', 'trained词典·自适应']);   // 作者自写的 generic 词典可能与方言重合，不参与 G5 判定，仅作参考
const g3 = ci(fit(layaBest), fit('learner')), g5 = ci(fit(layaBest), fit(lexBest));
const gates = [
  { gate: 'G1 信息有价值', rule: 'oracle − blind ≥ 0.35', value: +(m('oracle') - m('blind')).toFixed(3), pass: m('oracle') - m('blind') >= .35 },
  { gate: 'G2 经验不够', rule: 'learner ≤ 0.85 × oracle', value: +(m('learner') / m('oracle')).toFixed(3), pass: m('learner') <= .85 * m('oracle') },
  { gate: 'G3 先验有用', rule: `${layaBest} − learner ≥ +0.05 且 CI 下界 > 0`, value: `${g3.diff.toFixed(3)} [${g3.lo.toFixed(3)}, ${g3.hi.toFixed(3)}]`, pass: g3.diff >= .05 && g3.lo > 0 },
  { gate: 'G4 增益来自语义', rule: `${shufBest} ≤ learner + 0.01`, value: +(m(shufBest) - m('learner')).toFixed(3), pass: m(shufBest) <= m('learner') + .01 },
  { gate: 'G5 增益来自 Laya 的广度', rule: `${layaBest} − ${lexBest} ≥ +0.04`, value: `${g5.diff.toFixed(3)} [${g5.lo.toFixed(3)}, ${g5.hi.toFixed(3)}]`, pass: g5.diff >= .04 },
  { gate: 'G6 仍有余量', rule: '最好控制器 ≤ 0.9 × oracle', value: +(m(best(Object.keys(V).filter(k => k !== 'oracle'))) / m('oracle')).toFixed(3), pass: m(best(Object.keys(V).filter(k => k !== 'oracle'))) <= .9 * m('oracle') },
];
const report = { purpose: '关卡闸门判定（开发评估；测试方言；手写控制器）', level: { K, inversion, drift, harmCap, delay, seeds: N, dialect: 'test', priorsLoaded: priors.size },
  means: Object.fromEntries(Object.keys(V).map(n => [n, { fitness: +m(n).toFixed(3), toxicBites: +mean(runs[n].map(r => r.toxicBites)).toFixed(0), survival: +mean(runs[n].map(r => r.survival)).toFixed(3) }])), gates, allPass: gates.every(g => g.pass) };
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(gates, null, 1)); console.log('全部通过：', report.allPass);
