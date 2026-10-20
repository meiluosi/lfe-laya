// 生存分析（点子 #4；Roupassov-Ruiz & Zuo 2026 的做法只作灵感）：在给定评估世界上，对各条件的所有个体计算 Kaplan–Meier 生存曲线与受限平均生存时间（RMST）。
// 用法：node packages/evo/survival-curves.ts <输出 json> --pool heldout --delay 80 --seeds 71,72,73 --cond laya=experiments/evo/f12-laya-d80,none=experiments/evo/f12-none-d80 [--worlds 16] [--K 32]
// 条件名决定先验：laya / none / vader / distilled；目录前缀后接 -<种子>/final.json。个体为 v2 结构化个体（9 个基因）。
import { readFileSync, writeFileSync } from 'node:fs';
import { registerPools, loadLayaPriors, vaderPrior, type Priors } from './pools.ts';
import { runSemanticWorld } from './semantic-run.ts';
import { structuredCohort } from './structured.ts';
import { distilledPrior } from './distill.ts';
const a = process.argv, out = a[2], opt = (n: string, d: string) => a.includes(n) ? a[a.indexOf(n) + 1] : d;
const pool = opt('--pool', 'heldout') as 'heldout' | 'factual', delay = Number(opt('--delay', '80')), seeds = opt('--seeds', '71').split(',').map(Number), N = Number(opt('--worlds', '16')), K = Number(opt('--K', '32'));
const conds = Object.fromEntries(opt('--cond', '').split(',').filter(Boolean).map(s => s.split('=') as [string, string]));
registerPools(); const priorT: Record<string, Priors> = { laya: loadLayaPriors(pool), none: new Map(), vader: vaderPrior(), distilled: distilledPrior(pool) }, HORIZON = 3600;
function kaplanMeier(life: { t: number; died: boolean }[]) {
  const ts = [...new Set(life.filter(l => l.died).map(l => l.t))].sort((x, y) => x - y); let s = 1; const curve = [{ t: 0, s: 1 }];
  for (const t of ts) { const atRisk = life.filter(l => l.t >= t).length, d = life.filter(l => l.died && l.t === t).length; s *= 1 - d / atRisk; curve.push({ t, s }); }
  let rmst = 0; for (let i = 0; i < curve.length; i++) { const t1 = i + 1 < curve.length ? curve[i + 1].t : HORIZON; rmst += curve[i].s * (Math.min(t1, HORIZON) - curve[i].t); }
  return { curve, rmst };
}
const result: Record<string, unknown> = {};
for (const [name, prefix] of Object.entries(conds)) {
  const life: { t: number; died: boolean }[] = [], perSeedRmst: number[] = [];
  for (const s of seeds) {
    const g: number[] = JSON.parse(readFileSync(`${prefix}-${s}/final.json`, 'utf8')).innate, mine: { t: number; died: boolean }[] = [];
    for (const [ci, inv] of [.25, .4].entries()) for (let i = 0; i < N; i++) mine.push(...runSemanticWorld({ seed: 700000 + i + ci * 1000, options: { split: 'test', pool, sensible: K, harmCap: 4, inversion: inv, delay } }, () => structuredCohort(g, name === 'none' ? 'none' : 'laya', priorT[name])).lifetimes);
    life.push(...mine); perSeedRmst.push(+kaplanMeier(mine).rmst.toFixed(1));
  }
  const km = kaplanMeier(life); result[name] = { individuals: life.length, deaths: life.filter(l => l.died).length, rmst: +km.rmst.toFixed(1), perSeedRmst, curve: km.curve.filter((_, i, c) => i % Math.max(1, Math.floor(c.length / 200)) === 0) };
  console.log(name.padEnd(10), 'n', life.length, 'deaths', life.filter(l => l.died).length, 'RMST', km.rmst.toFixed(0), 'of', HORIZON);
}
writeFileSync(out, JSON.stringify({ pool, delay, seeds, worlds: N, K, horizon: HORIZON, result }, null, 1));
