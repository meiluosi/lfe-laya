// G12 开发期实验（非确认性；docs/DESIGN_G11_DUAL_SYSTEM.md §18）：benv2 的在线可靠度、传感器矩阵（pair / desc）、思考代价，在 LLM 措辞库与线索缺陷世界里。
// 用法：node packages/evo/benv2-dev.ts <输出目录> --seed 201 [--worlds 5]
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { runSemanticWorld, type SemanticFactory } from './semantic-run.ts';
import { registerPools, loadLayaPriors } from './pools.ts';
import { structuredCohort } from './structured.ts';
import { structuredRegimeCohort } from './structured-ctx.ts';
import { structuredBenv2Cohort, type Benv2Opt } from './structured-benv2.ts';

const args = process.argv.slice(2), out = args[0]; if (!out) throw Error('Usage: node packages/evo/benv2-dev.ts <new-output-directory> --seed 201');
const opt = (n: string, d: string) => args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d, SEED = Number(opt('seed', '201')), N = Number(opt('worlds', '5'));
mkdirSync(out, { recursive: true }); registerPools(); const lay = loadLayaPriors('test');
const plain: number[] = JSON.parse(readFileSync(`experiments/evo/dev-aba-laya-plain-${SEED}/final.json`, 'utf8')).innate, regime: number[] = JSON.parse(readFileSync(`experiments/evo/dev-aba-laya-regime-${SEED}/final.json`, 'utf8')).innate;
const g = [...plain, .7, .02, .3, .8, .5];
type Cond = { id: string; make: () => ReturnType<SemanticFactory> };
const b2 = (o: Benv2Opt): Cond['make'] => () => structuredBenv2Cohort(g, 'laya', lay, o);
const ONLY = opt('only', '');
const ALL_CONDS: Cond[] = [
  { id: 'plain', make: () => structuredCohort(plain, 'laya', lay) }, { id: 'regime', make: () => structuredRegimeCohort(regime, 'laya', lay) },
  { id: 'off', make: b2({ sensor: false }) },
  { id: 'pair-gene', make: b2({ matrix: 'pair', reliability: 'gene' }) }, { id: 'pair-online', make: b2({ matrix: 'pair', reliability: 'online' }) },
  { id: 'desc-gene', make: b2({ matrix: 'desc', reliability: 'gene' }) }, { id: 'desc-online', make: b2({ matrix: 'desc', reliability: 'online' }) },
  { id: 'pair-online-think10-rest', make: b2({ matrix: 'pair', reliability: 'online', think: { ticks: 10, rest: true } }) }, { id: 'pair-online-think40-rest', make: b2({ matrix: 'pair', reliability: 'online', think: { ticks: 40, rest: true } }) },
  { id: 'pair-online-think40-delay', make: b2({ matrix: 'pair', reliability: 'online', think: { ticks: 40, rest: false } }) },
];
const CONDS = ONLY ? ALL_CONDS.filter(c => c.id.includes(ONLY) || c.id === 'plain') : ALL_CONDS;
const WORLDS: { id: string; bank: 'author' | 'llm'; flaw?: { missing: number; wrong: number } }[] = [
  { id: 'author-clean', bank: 'author' }, { id: 'llm-clean', bank: 'llm' }, { id: 'llm-wrong.3', bank: 'llm', flaw: { missing: 0, wrong: .3 } }, { id: 'llm-miss.3+wrong.3', bank: 'llm', flaw: { missing: .3, wrong: .3 } },
];
const PHASE = 1200, WIN = 200, PER = 6, share = (g2: number[], b: number[], a: number, z: number) => { let x = 0, t = 0; for (let i = a; i < z; i++) { x += g2[i]; t += g2[i] + b[i]; } return t ? x / t : NaN; };
const mean = (xs: number[]) => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
const res: Record<string, Record<string, Record<string, number>>> = {};
for (const w of WORLDS) { res[w.id] = {}; for (const c of CONDS) {
  const rows = Array.from({ length: N }, (_, i) => { const r = runSemanticWorld({ seed: 650000 + i, options: { split: 'test', pool: 'test', sensible: 6, harmCap: 1, inversion: 0, horizon: 5 * PHASE, drift: { everyTicks: PHASE, fraction: 1, pattern: 'abab', cue: 'paraphrase', cueBank: w.bank, ...(w.flaw ? { cueFlaw: w.flaw } : {}) } } }, c.make as SemanticFactory, WIN);
    return { fitness: r.fitness, E0: share(r.windows!.good, r.windows!.bad, 0, 2), E4: share(r.windows!.good, r.windows!.bad, 4 * PER, 4 * PER + 2) }; });
  res[w.id][c.id] = { fitness: +mean(rows.map(r => r.fitness)).toFixed(3), savings: +(mean(rows.map(r => r.E4)) - mean(rows.map(r => r.E0))).toFixed(3), E0: +mean(rows.map(r => r.E0)).toFixed(3), E4: +mean(rows.map(r => r.E4)).toFixed(3) };
  console.log(`seed ${SEED} ${w.id.padEnd(20)} ${c.id.padEnd(26)}`, JSON.stringify(res[w.id][c.id]));
} }
writeFileSync(`${out}/results-${SEED}${ONLY ? '-' + ONLY : ''}.json`, JSON.stringify({ seed: SEED, worlds: N, res }, null, 1));
