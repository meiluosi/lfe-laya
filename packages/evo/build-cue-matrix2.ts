// G12：与 build-cue-matrix.ts 相同，但覆盖两个措辞库（作者 36 句 + LLM 36 句 = 72 句，2556 对）。结果存 cue-sim2.json（cue-sim.json 不动：预注册 21 用它）。
// 预先算好“线索句子对是否同一类条件”的 LLM 判断，存成矩阵（packages/evo/cue-sim2.json）。线索句子集合是固定的（cues.json 的状态 A/B/C 的训练句 + 评估句，共 36 句），
// 所以全部句对（630 对 × 两种顺序）只需问一次；之后训练与评估都查这张表——等价于“传感器 = 缓存的 LLM 判断”，同步、免费、可严格回放。
// 提示与探针 C、G11b 完全一致（缓存键含模型、系统提示、用户提示，已有记录直接复用）。用法：node packages/evo/build-cue-matrix.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { recorded, deepseekClient, loadEnv } from './dual-system.ts';

loadEnv(); const cues = JSON.parse(readFileSync(new URL('./cues.json', import.meta.url), 'utf8')) as Record<string, { train: string[]; eval: string[] }>;
const llmCues = JSON.parse(readFileSync(new URL('./cues-llm.json', import.meta.url), 'utf8')) as Record<string, string[]>;
const sentences: string[] = [], state: number[] = [], bank: number[] = [];   // bank 0 = 作者撰写（与 cue-sim.json 的前 36 句相同顺序），bank 1 = LLM 撰写
['A', 'B', 'C'].forEach((k, si) => { for (const t of [...cues[k].train, ...cues[k].eval]) { sentences.push(t); state.push(si); bank.push(0); } });
['A', 'B', 'C'].forEach((k, si) => { for (const t of llmCues[k]) { sentences.push(t); state.push(si); bank.push(1); } });
const model = process.env.LLM_MODEL ?? 'deepseek-flash', llm = recorded(deepseekClient(), 'experiments/evo/g12-cues/llm-log.jsonl', model);
const SYSTEM = 'You compare two short descriptions of the conditions a creature senses around it. Decide whether they describe the same kind of conditions (temperature, wetness, wind and visibility), even if the wording is very different. Reply with JSON only: {"same": <a probability between 0 and 1>}.';
const ask = async (a: string, b: string) => { const r = await llm({ system: SYSTEM, user: `A: "${a}"\nB: "${b}"`, tag: 'sensor' }); try { const p = Number(JSON.parse(r.text).same); return Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : NaN; } catch { return NaN; } };
const n = sentences.length, p: number[][] = Array.from({ length: n }, () => new Array(n).fill(0)); const jobs: Promise<void>[] = []; let bad = 0;
for (let i = 0; i < n; i++) { p[i][i] = 1; for (let j = i + 1; j < n; j++) jobs.push(Promise.all([ask(sentences[i], sentences[j]), ask(sentences[j], sentences[i])]).then(([x, y]) => { const v = (x + y) / 2; if (!Number.isFinite(v)) bad++; p[i][j] = p[j][i] = Number.isFinite(v) ? +v.toFixed(3) : .5; })); }
await Promise.all(jobs);
let same: number[] = [], diff: number[] = []; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) (state[i] === state[j] ? same : diff).push(p[i][j]);
const cross: number[][] = [[], []]; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (bank[i] !== bank[j]) cross[state[i] === state[j] ? 0 : 1].push(p[i][j]);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
writeFileSync(new URL('./cue-sim2.json', import.meta.url), JSON.stringify({ note: 'LLM 对线索句子对“是否同一类条件”的判断（两种顺序平均）。state 为作者撰写时的状态标签，只用于度量，不进入个体。', model, builtAt: '2026-10-28', unparsedPairs: bad, sentences, state, bank, p }) + '\n');
console.log(JSON.stringify({ sentences: n, pairs: (n * (n - 1)) / 2, unparsed: bad, meanSameState: +mean(same).toFixed(3), meanDiffState: +mean(diff).toFixed(3), minSame: Math.min(...same), maxDiff: Math.max(...diff), crossBank: { sameMean: +mean(cross[0]).toFixed(3), diffMean: +mean(cross[1]).toFixed(3), sameMin: Math.min(...cross[0]), diffMax: Math.max(...cross[1]) } }));
