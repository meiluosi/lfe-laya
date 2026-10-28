// G12：让 LLM 给每条线索句子（72 句：作者 36 + LLM 36）做结构化“命名”：温度 / 湿度 / 风 / 能见度 / 光线，句子没说的属性记 unknown，再给一个 2–3 个词的环境名。
// 由描述符得到相容度矩阵 cue-sim3.json：两句已知的属性里一致的越多越相容，冲突越多越不相容，未知不惩罚（Laplace：s = (一致数 + 1)/(共同已知数 + 2)）。
// 这是“只提到部分属性的句子”的更合理的读法：它与若干个环境相容，而不是勉强判“同一类 / 不同类”。cue-sim.json、cue-sim2.json 不动。
// 用法：node packages/evo/build-cue-desc.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { recorded, deepseekClient, loadEnv } from './dual-system.ts';

loadEnv(); const base = JSON.parse(readFileSync(new URL('./cue-sim2.json', import.meta.url), 'utf8')) as { sentences: string[]; state: number[]; bank: number[] };
const model = process.env.LLM_MODEL ?? 'deepseek-flash', llm = recorded(deepseekClient(), 'experiments/evo/g12-cues/llm-log-desc.jsonl', model);
const ATTR = { temperature: ['warm', 'cold'], wetness: ['dry', 'wet'], wind: ['still', 'windy'], visibility: ['clear', 'foggy'], light: ['normal', 'strange'] } as const;
const SYSTEM = `You read one short description of the conditions around a small creature and extract what it says. Reply with JSON only: {"temperature":"warm"|"cold"|"unknown","wetness":"dry"|"wet"|"unknown","wind":"still"|"windy"|"unknown","visibility":"clear"|"foggy"|"unknown","light":"normal"|"strange"|"unknown","name":"<2 to 3 word label for these conditions>"}. Use "unknown" for anything the description does not say; do not guess.`;
type D = Record<keyof typeof ATTR, string> & { name: string };
const desc: D[] = await Promise.all(base.sentences.map(async t => { const r = await llm({ tag: 'desc', system: SYSTEM, user: `Description: "${t}"` }); try { const j = JSON.parse(r.text); const o = {} as D; for (const [k, vs] of Object.entries(ATTR)) (o as Record<string, string>)[k] = (vs as readonly string[]).includes(j[k]) ? j[k] : 'unknown'; o.name = String(j.name ?? '').slice(0, 40); return o; } catch { return { temperature: 'unknown', wetness: 'unknown', wind: 'unknown', visibility: 'unknown', light: 'unknown', name: '' } as D; } }));
const n = base.sentences.length, keys = Object.keys(ATTR) as (keyof typeof ATTR)[], p: number[][] = Array.from({ length: n }, () => new Array(n).fill(1));
for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { let known = 0, agree = 0; for (const k of keys) if (desc[i][k] !== 'unknown' && desc[j][k] !== 'unknown') { known++; if (desc[i][k] === desc[j][k]) agree++; } p[i][j] = p[j][i] = +((agree + 1) / (known + 2)).toFixed(3); }
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length; const same: number[] = [], diff: number[] = [], amb: number[] = [];
for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) (base.state[i] === base.state[j] ? same : diff).push(p[i][j]);
const known = desc.map(d => keys.filter(k => d[k] !== 'unknown').length), expect: Record<string, Record<string, string>> = { 0: { temperature: 'warm', wetness: 'dry', wind: 'still' }, 1: { temperature: 'cold', wetness: 'wet', wind: 'windy' }, 2: { visibility: 'foggy', light: 'strange' } };
let wrongAttr = 0, totalAttr = 0; desc.forEach((d, i) => { for (const [k, v] of Object.entries(expect[base.state[i]])) if ((d as Record<string, string>)[k] !== 'unknown') { totalAttr++; if ((d as Record<string, string>)[k] !== v) wrongAttr++; } });
writeFileSync(new URL('./cue-sim3.json', import.meta.url), JSON.stringify({ note: 'LLM 对线索句子的结构化命名（G12）及由此得到的相容度矩阵；state / bank 与 cue-sim2.json 相同，state 只用于度量。', model, sentences: base.sentences, state: base.state, bank: base.bank, desc, p }) + '\n');
console.log(JSON.stringify({ sentences: n, meanKnownAttrs: +mean(known).toFixed(2), sentencesWithOneOrFewerKnown: known.filter(k => k <= 1).length, attrContradictingAuthorState: `${wrongAttr}/${totalAttr}`, sameStateMean: +mean(same).toFixed(3), diffStateMean: +mean(diff).toFixed(3), sameMin: Math.min(...same), diffMax: Math.max(...diff) }));
console.log(desc.slice(36, 42).map((d, i) => `${base.sentences[36 + i]} -> ${JSON.stringify(d)}`).join('\n'));
