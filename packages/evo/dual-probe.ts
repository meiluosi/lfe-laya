// G11 小探针（开发期，非确认性；协议 docs/DESIGN_G11_DUAL_SYSTEM.md §5）：A/B/A 世界（K=6，开发方言池 test，线索真实但只有 S2c 的提示会用到）里，
// 条件 P（plain）、R（regime，已有基线）、T（触发 + 规则动作）、S2（触发 + LLM）、S2c（+ 可见线索）、S2x（负控制：结果错配）。
// 用法：node packages/evo/dual-probe.ts <输出目录> [--seeds 201,202] [--worlds 8] [--conds P,R,T,S2,S2c,S2x] [--replay]
// LLM：环境变量 LLM_API_KEY（可放在 .env）、LLM_BASE_URL（缺省 https://api.deepseek.com）、LLM_MODEL（缺省 deepseek-flash）。所有调用记录在 <输出目录>/llm-log.jsonl。
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { runDualWorld, recorded, deepseekClient, loadEnv, type Mode } from './dual-system.ts';
import { runSemanticWorld } from './semantic-run.ts';
import { registerPools, loadLayaPriors } from './pools.ts';
import { structuredRegimeCohort } from './structured-ctx.ts';

const args = process.argv.slice(2), out = args[0]; if (!out) throw Error('Usage: node packages/evo/dual-probe.ts <new-output-directory> ...');
const opt = (n: string, d: string) => args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d;
const SEEDS = opt('seeds', '201,202').split(',').map(Number), N = Number(opt('worlds', '8')), CONDS = opt('conds', 'P,R,T,S2,S2c,S2x').split(','), REPLAY = args.includes('--replay'), TRIGGER = opt('trigger', 'abs') as 'abs' | 'jump', THR = Number(opt('thr', '0.5')), MAXC = Number(opt('maxCalls', '12'));
mkdirSync(out, { recursive: true }); loadEnv(); registerPools(); const priors = loadLayaPriors('test');
const needLlm = CONDS.some(c => c.startsWith('S2')), model = process.env.LLM_MODEL ?? 'deepseek-flash';
const llm = needLlm ? recorded(REPLAY ? null : deepseekClient(), `${out}/llm-log.jsonl`, model, REPLAY ? 'replay' : 'live') : undefined;
const PER = 6, EARLY = 2, share = (g: number[], b: number[], a: number, z: number) => { let x = 0, t = 0; for (let i = a; i < z; i++) { x += g[i]; t += g[i] + b[i]; } return t ? x / t : NaN; };
const mean = (xs: number[]) => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
const score = (w: { good: number[]; bad: number[] }) => { const E = (p: number) => share(w.good, w.bad, p * PER, p * PER + EARLY); return { E0: E(0), E1: E(1), E2: E(2) }; };
const res: Record<string, Record<string, unknown>> = {};
for (const seed of SEEDS) {
  const plain: number[] = JSON.parse(readFileSync(`experiments/evo/dev-aba-laya-plain-${seed}/final.json`, 'utf8')).innate, regime: number[] = JSON.parse(readFileSync(`experiments/evo/dev-aba-laya-regime-${seed}/final.json`, 'utf8')).innate;
  res[seed] = {};
  for (const cond of CONDS) {
    const rows = await Promise.all(Array.from({ length: N }, async (_, i) => {
      const worldSeed = 600000 + i, opts = { split: 'test' as const, pool: 'test', sensible: 6, harmCap: 1, inversion: 0, horizon: 3600, drift: { everyTicks: 1200, fraction: 1, pattern: 'aba' as const, cue: 'true' as const } };
      if (cond === 'R') { const r = runSemanticWorld({ seed: worldSeed, options: opts }, () => structuredRegimeCohort(regime, 'laya', priors), 200); return { ...score(r.windows!), fitness: r.fitness, calls: 0, promptTokens: 0, completionTokens: 0, parseFails: 0, triggers: 0, applied: 0 }; }
      const r = await runDualWorld({ seed: worldSeed, pool: 'test', K: 6, pattern: 'aba', cue: 'true', genes: plain, priors, mode: cond as Mode, llm, trigger: TRIGGER, thr: THR, maxCalls: MAXC }); return { ...score(r.windows), fitness: r.fitness, calls: r.calls, promptTokens: r.promptTokens, completionTokens: r.completionTokens, parseFails: r.parseFails, triggers: r.triggers, applied: r.applied };
    }));
    const m = (k: string) => mean(rows.map(r => (r as Record<string, number>)[k]));
    res[seed][cond] = { savings: +(m('E2') - m('E0')).toFixed(4), E0: +m('E0').toFixed(3), E1: +m('E1').toFixed(3), E2: +m('E2').toFixed(3), fitness: +m('fitness').toFixed(3), callsPerWorld: +m('calls').toFixed(1), promptTokens: Math.round(rows.reduce((a, r) => a + r.promptTokens, 0)), completionTokens: Math.round(rows.reduce((a, r) => a + r.completionTokens, 0)), parseFails: rows.reduce((a, r) => a + r.parseFails, 0), triggersPerWorld: +m('triggers').toFixed(1), appliedPerWorld: +m('applied').toFixed(1) };
    console.log(`seed ${seed} ${cond.padEnd(4)}`, JSON.stringify(res[seed][cond]));
  }
}
writeFileSync(`${out}/results.json`, JSON.stringify({ protocol: 'dev (G11 probe)', model, trigger: TRIGGER, thr: THR, maxCalls: MAXC, seeds: SEEDS, worlds: N, conds: CONDS, res }, null, 1));
