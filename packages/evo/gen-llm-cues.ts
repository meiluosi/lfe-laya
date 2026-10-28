// 让 LLM 写一批新的线索句子（只给它每个状态的属性，不给我们作者写的句子），作为独立来源的措辞库：packages/evo/cues-llm.json。
// 用法：node packages/evo/gen-llm-cues.ts   （需要 .env 里的 LLM_API_KEY；所有调用记录在 experiments/evo/g12-cues/llm-log.jsonl）
import { mkdirSync, writeFileSync } from 'node:fs';
import { recorded, deepseekClient, loadEnv } from './dual-system.ts';

loadEnv(); mkdirSync('experiments/evo/g12-cues', { recursive: true });
const model = process.env.LLM_MODEL ?? 'deepseek-flash', llm = recorded(deepseekClient(), 'experiments/evo/g12-cues/llm-log.jsonl', model);
const STATES: Record<string, string> = { A: 'warm, still air (no wind) and dry ground', B: 'cold, windy air and wet ground', C: 'thick mist or fog hanging in the air and a strange, unusual quality of light' };
const STYLES = ['plain everyday wording', 'poetic wording', 'terse, clipped wording', 'technical, field-guide wording'];
const out: Record<string, string[]> = { A: [], B: [], C: [] };
for (const [s, desc] of Object.entries(STATES)) for (const style of STYLES) {
  const r = await llm({ tag: 'gen', system: 'You write short descriptions of the conditions around a small creature. Reply with JSON only: {"sentences": [<exactly 4 distinct strings>]}. Each sentence is 4 to 14 words, plain ASCII, and does not mention the creature or food.',
    user: `Write 4 different sentences describing these conditions: ${desc}. Use ${style}. Do not copy the wording of the other sentences; vary the vocabulary.` });
  try { for (const t of JSON.parse(r.text).sentences as string[]) if (typeof t === 'string' && /^[ -~]{4,110}$/.test(t) && !out[s].includes(t.trim())) out[s].push(t.trim()); } catch { console.error('parse failure', s, style); }
}
const bank = Object.fromEntries(Object.entries(out).map(([s, v]) => [s, v.slice(0, 12)]));
writeFileSync('packages/evo/cues-llm.json', JSON.stringify({ note: `LLM（${model}，思考关闭）按状态属性写的线索句子，只给属性、不给作者写的句子；用作独立来源的措辞库（G12）。`, model, A: bank.A, B: bank.B, C: bank.C }, null, 1) + '\n');
console.log(Object.fromEntries(Object.entries(bank).map(([s, v]) => [s, v.length]))); for (const s of ['A', 'B', 'C']) console.log(s, bank[s].slice(0, 3));
