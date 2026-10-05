// 预注册 05：在“需要理解”的事实方言池上，Laya 先验是否比情感词典更能区分营养 / 有毒（协议见 docs/PREREGISTRATION_05.md）。
// 一次性运行；Laya 先验表只依赖文本（不用标签）。用法：node packages/evo/prior-quality-pool.ts <新输出目录> [--dialect factual]
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registerPools, loadLayaPriors, shuffledPrior, genericLexiconPrior, vaderPrior, type Priors } from './pools.ts';
import type { Dialect } from './ontology.ts';
const out = process.argv[2]; if (!out) throw Error('Usage: node packages/evo/prior-quality-pool.ts <new-output-directory> [--dialect factual]');
const dialect = (process.argv.includes('--dialect') ? process.argv[process.argv.indexOf('--dialect') + 1] : 'factual') as Dialect;
const BOOTSTRAP = 10000, THRESHOLD = 0.10;
if (dialect === 'factual') {   // 正式运行：先验表与池必须与冻结哈希一致
  const frozen = JSON.parse(readFileSync('experiments/prereg/hashes-05.json', 'utf8')) as Record<string, string>, h = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');
  for (const f of Object.keys(frozen)) if (h(f) !== frozen[f]) throw Error(`hash_mismatch:${f}`);
}
mkdirSync(out, { recursive: false });
const pool = (registerPools() as Record<string, import('./ontology.ts').PoolEntry[] | undefined>)[dialect]; if (!pool) throw Error(`pool_missing:${dialect}`);
const laya = loadLayaPriors(dialect); if (laya.size < pool.length) throw Error(`laya_prior_incomplete:${laya.size}/${pool.length}`);
const sources: Record<string, Priors> = { Laya: laya, VADER: vaderPrior(), 作者自写通用词典: genericLexiconPrior(), 打乱的Laya: shuffledPrior(laya, 3) };
const y = pool.map(e => e.factor > 0), informative = pool.map(e => e.cuePolarity !== 0);
const scores = Object.fromEntries(Object.entries(sources).map(([n, p]) => [n, pool.map(e => p.get(e.text) ?? .5)]));
function auc(s: number[], idx: number[]) {   // Mann-Whitney，含并列
  const order = idx.slice().sort((a, b) => s[a] - s[b]); let rank = 0, sumPos = 0, nPos = 0; const n = order.length;
  for (let i = 0; i < n;) { let j = i; while (j < n && s[order[j]] === s[order[i]]) j++; const avg = (i + 1 + j) / 2; for (let k = i; k < j; k++) if (y[order[k]]) { sumPos += avg; nPos++; } i = j; rank += j - i; }
  const nNeg = n - nPos; return (sumPos - nPos * (nPos + 1) / 2) / (nPos * nNeg);
}
let rs = 20261007; const rand = () => { rs = (rs + 0x6D2B79F5) >>> 0; let t = rs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const all = pool.map((_, i) => i), inf = all.filter(i => informative[i]);
const acc = (s: number[], idx: number[]) => idx.filter(i => (s[i] > .5) === y[i]).length / idx.length;
const boot = (a: string, b: string) => { const ds: number[] = []; for (let r = 0; r < BOOTSTRAP; r++) { const idx = all.map(() => all[Math.floor(rand() * all.length)]); ds.push(auc(scores[a], idx) - auc(scores[b], idx)); } ds.sort((x, z) => x - z); return { diff: +(auc(scores[a], all) - auc(scores[b], all)).toFixed(4), ci95: [+ds[Math.floor(BOOTSTRAP * .025)].toFixed(4), +ds[Math.floor(BOOTSTRAP * .975)].toFixed(4)], pOneSided: ds.filter(x => x <= 0).length / BOOTSTRAP }; };
const primary = boot('Laya', 'VADER');
const verdict = { id: 'H1', claim: `Laya 的 AUC 比 VADER 高至少 ${THRESHOLD}，且 95% CI 下界 > 0`, ...primary, supported: primary.diff >= THRESHOLD && primary.ci95[0] > 0 };
const rows = Object.fromEntries(Object.keys(sources).map(n => [n, { aucAll: +auc(scores[n], all).toFixed(4), accAll: +acc(scores[n], all).toFixed(4), aucInformative: +auc(scores[n], inf).toFixed(4), accInformative: +acc(scores[n], inf).toFixed(4) }]));
const byTier = Object.fromEntries((['nutritive', 'mild', 'strong', 'lethal'] as const).map(t => [t, Object.fromEntries(Object.keys(sources).map(n => { const idx = all.filter(i => pool[i].tier === t); return [n, +(idx.filter(i => (scores[n][i] > .5) === (t === 'nutritive')).length / idx.length).toFixed(3)]; }))]));
const secondary = { layaMinusGeneric: boot('Laya', '作者自写通用词典'), layaMinusShuffled: boot('Laya', '打乱的Laya') };
const report = { protocol: 'docs/PREREGISTRATION_05.md', dialect, n: pool.length, primary: verdict, secondary, rows, correctRateByTier: byTier };
writeFileSync(`${out}/results.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ primary: verdict, rows, byTier, secondary }, null, 1));
