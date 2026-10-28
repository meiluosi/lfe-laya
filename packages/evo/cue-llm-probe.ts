// G11 探针 C（开发期，协议 docs/DESIGN_G11_DUAL_SYSTEM.md §13）：LLM 能否判断两句环境描述是否同一类条件。
// 用法：node packages/evo/cue-llm-probe.ts <输出目录> [--replay]
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { recorded, deepseekClient, loadEnv } from './dual-system.ts';

const out = process.argv[2]; if (!out) throw Error('Usage: node packages/evo/cue-llm-probe.ts <new-output-directory>');
mkdirSync(out, { recursive: true }); loadEnv();
const cues = JSON.parse(readFileSync(new URL('./cues.json', import.meta.url), 'utf8')) as Record<string, { train: string[]; eval: string[] }> & { noise: string[] };
const model = process.env.LLM_MODEL ?? 'deepseek-flash', llm = recorded(process.argv.includes('--replay') ? null : deepseekClient(), `${out}/llm-log.jsonl`, model, process.argv.includes('--replay') ? 'replay' : 'live');
const SYSTEM = 'You compare two short descriptions of the conditions a creature senses around it. Decide whether they describe the same kind of conditions (temperature, wetness, wind and visibility), even if the wording is very different. Reply with JSON only: {"same": <a probability between 0 and 1>}.';
const ask = async (a: string, b: string) => { const r = await llm({ system: SYSTEM, user: `A: "${a}"\nB: "${b}"`, tag: 'cue' }); try { const p = Number(JSON.parse(r.text).same); return Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : NaN; } catch { return NaN; } };
const pair = async (a: string, b: string) => { const [x, y] = await Promise.all([ask(a, b), ask(b, a)]); return (x + y) / 2; };
type S = { text: string; state: string; split: 'train' | 'eval' | 'noise' };
const sents: S[] = [];
for (const s of ['A', 'B', 'C']) { for (const t of cues[s].train) sents.push({ text: t, state: s, split: 'train' }); for (const t of cues[s].eval) sents.push({ text: t, state: s, split: 'eval' }); }
for (const t of cues.noise) sents.push({ text: t, state: 'N', split: 'noise' });
const tr = sents.filter(x => x.split === 'train'), others = sents.filter(x => x.split !== 'train');
const sim = new Map<string, number>();   // key = train idx | other idx
const jobs: Promise<void>[] = []; let done = 0;
tr.forEach((a, i) => others.forEach((b, j) => { jobs.push(pair(a.text, b.text).then(p => { sim.set(`${i}|${j}`, p); if (++done % 100 === 0) console.log('pairs', done, 'of', tr.length * others.length); })); }));
await Promise.all(jobs);
const toks = (t: string) => new Set(t.toLowerCase().match(/[a-z]+/g)); const jac = (a: string, b: string) => { const x = toks(a), y = toks(b), i = [...x].filter(w => y.has(w)).length; return i / (x.size + y.size - i); };
const auc = (pos: number[], neg: number[]) => { let w = 0; for (const p of pos) for (const n of neg) w += p > n ? 1 : p === n ? .5 : 0; return w / (pos.length * neg.length); };
const evalOf = (score: (i: number, j: number) => number) => {
  const evs = others.map((b, j) => ({ b, j })).filter(x => x.b.split === 'eval'), nzs = others.map((b, j) => ({ b, j })).filter(x => x.b.split === 'noise');
  const stateScore = (j: number, s: string) => { const idx = tr.map((a, i) => ({ a, i })).filter(x => x.a.state === s); return idx.reduce((acc, x) => acc + score(x.i, j), 0) / idx.length; };
  const best = (j: number) => ['A', 'B', 'C'].map(s => ({ s, v: stateScore(j, s) })).sort((x, y) => y.v - x.v)[0];
  const acc = evs.filter(x => best(x.j).s === x.b.state).length / evs.length, same: number[] = [], diff: number[] = [];
  tr.forEach((a, i) => evs.forEach(x => (a.state === x.b.state ? same : diff).push(score(i, x.j))));
  return { acc: +acc.toFixed(3), pair_auc: +auc(same, diff).toFixed(3), eval_vs_noise_auc: +auc(evs.map(x => best(x.j).v), nzs.map(x => best(x.j).v)).toFixed(3) };
};
const llmScore = (i: number, j: number) => sim.get(`${i}|${j}`)!, jacScore = (i: number, j: number) => jac(tr[i].text, others[j].text);
let seed = 7; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const vals = [...sim.entries()], perm = vals.map(([, v]) => v).sort(() => rnd() - .5), shuf = new Map(vals.map(([k], n) => [k, perm[n]]));
const res = { llm: evalOf(llmScore), jaccard_baseline: evalOf(jacScore), shuffled_llm: evalOf((i, j) => shuf.get(`${i}|${j}`)!), nan_pairs: vals.filter(([, v]) => !Number.isFinite(v)).length, pairs: vals.length, model };
const pass = (r: { acc: number; pair_auc: number; eval_vs_noise_auc: number }) => r.acc >= .9 && r.pair_auc >= .9 && r.eval_vs_noise_auc >= .8;
const wrong = others.map((b, j) => ({ b, j })).filter(x => x.b.split === 'eval').map(x => ({ text: x.b.text, truth: x.b.state, ...(() => { const sc = ['A', 'B', 'C'].map(s => { const idx = tr.map((a, i) => ({ a, i })).filter(y => y.a.state === s); return { s, v: idx.reduce((acc, y) => acc + llmScore(y.i, x.j), 0) / idx.length }; }).sort((p, q) => q.v - p.v); return { pred: sc[0].s, top: +sc[0].v.toFixed(2), second: +sc[1].v.toFixed(2) }; })() })).filter(x => x.truth !== x.pred);
writeFileSync(`${out}/results.json`, JSON.stringify({ ...res, pass: pass(res.llm), misclassified: wrong }, null, 1));
console.log(JSON.stringify({ ...res, pass: pass(res.llm) }), '\nmisclassified:', JSON.stringify(wrong));
