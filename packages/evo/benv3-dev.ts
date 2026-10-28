// G13 开发期试跑（非确认性）：手设基因的 benv3 在稠密交替世界（300 tick 一个阶段）里，各线索制度组合下的适应度。
// 用法：node packages/evo/benv3-dev.ts <输出目录> --seed 201 [--worlds 6]
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { runSemanticWorld, type SemanticFactory } from './semantic-run.ts';
import { registerPools, loadLayaPriors } from './pools.ts';
import { structuredCohort } from './structured.ts';
import { structuredBenv3Cohort, type Benv3Opt } from './structured-benv3.ts';
import { cueOptions, type RegimeName } from './cue-regimes.ts';

const args = process.argv.slice(2), out = args[0]; if (!out) throw Error('Usage: node packages/evo/benv3-dev.ts <new-output-directory> --seed 201');
const opt = (n: string, d: string) => args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d, SEED = Number(opt('seed', '201')), N = Number(opt('worlds', '6'));
mkdirSync(out, { recursive: true }); registerPools(); const lay = loadLayaPriors('test');
const plain: number[] = JSON.parse(readFileSync(`experiments/evo/dev-aba-laya-plain-${SEED}/final.json`, 'utf8')).innate, g = [...plain, .7, .02, .3, .5, .8, 8];
const b3 = (o: Benv3Opt): (() => ReturnType<SemanticFactory>) => () => structuredBenv3Cohort(g, 'laya', lay, o);
const CONDS: { id: string; make: () => ReturnType<SemanticFactory> }[] = [{ id: 'plain', make: () => structuredCohort(plain, 'laya', lay) }, { id: 'off', make: b3({ sensor: false }) }, { id: 'fixed1', make: b3({ channels: 1, online: false }) }, { id: 'online1', make: b3({ channels: 1, online: true }) }, { id: 'fixed2', make: b3({ channels: 2, online: false }) }, { id: 'online2', make: b3({ channels: 2, online: true }) }];
const CELLS: [RegimeName, RegimeName][] = [['reliable', 'absent'], ['noisy', 'absent'], ['uninformative', 'absent'], ['absent', 'absent'], ['reliable', 'reliable'], ['noisy', 'reliable'], ['uninformative', 'reliable'], ['uninformative', 'uninformative']];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length, res: Record<string, Record<string, number>> = {};
for (const [r1, r2] of CELLS) { const key = `${r1}/${r2}`; res[key] = {};
  for (const c of CONDS) { const fits = Array.from({ length: N }, (_, i) => runSemanticWorld({ seed: 660000 + i, options: { split: 'test', pool: 'test', sensible: 6, harmCap: 1, inversion: 0, horizon: 6000, drift: { everyTicks: 300, fraction: 1, pattern: 'alt', cue: 'paraphrase', ...cueOptions(r1, r2) } } }, c.make as SemanticFactory, 100).fitness); res[key][c.id] = +mean(fits).toFixed(3); }
  console.log(`seed ${SEED} ${key.padEnd(30)}`, JSON.stringify(res[key]));
}
writeFileSync(`${out}/results-${SEED}.json`, JSON.stringify({ seed: SEED, worlds: N, res }, null, 1));
