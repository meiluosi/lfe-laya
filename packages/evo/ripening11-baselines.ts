// 预注册 11 §3 预先声明的描述性基线：盲规则与预言机，在同一批评估世界
// （heldout 池、措辞 B、K=4、季节 300、欺骗 {0.25,0.40}、种子 270000 起、每单元 32 世界）
// 上各跑一次，只用于回答“这个世界是否可学、上限在哪里”，不进入任何假设族。
// 用法：node packages/evo/ripening11-baselines.ts <输出目录>
import { mkdirSync, writeFileSync } from 'node:fs';
import { runSemanticWorld, blindRule, oracleRule, type SemanticFactory } from './semantic-run.ts';
import { registerPools } from './pools.ts';

const out = process.argv[2]; if (!out) throw Error('Usage: node packages/evo/ripening11-baselines.ts <output-dir>');
mkdirSync(out, { recursive: true });
registerPools();
const K = 4, HARM_CAP = 4, SEASON = 300, POOL_LIMIT = 1000, BASE = 270000, N = 32, CUES = ['language', 'off', 'shuffled'] as const, INVERSIONS = [.25, .4];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const r4 = (x: number) => +x.toFixed(4);
const systems: Record<string, SemanticFactory> = { blind: blindRule, oracle: oracleRule };
const rows: Record<string, Record<string, { fitness: number; toxicBites: number; survival: number }>> = {};
for (const [name, f] of Object.entries(systems)) {
  rows[name] = {};
  for (const cues of CUES) {
    const rs = INVERSIONS.flatMap((inv, ci) => Array.from({ length: N }, (_, i) => runSemanticWorld({ seed: BASE + i + ci * 10000, options: { split: 'test', pool: 'heldout', sensible: K, harmCap: HARM_CAP, inversion: inv, ripening: { seasonTicks: SEASON, cues, phrases: 'B' as const, poolLimit: POOL_LIMIT } } }, f)));
    rows[name][cues] = { fitness: r4(mean(rs.map(r => r.fitness))), toxicBites: +mean(rs.map(r => r.toxicBites)).toFixed(0), survival: r4(mean(rs.map(r => r.survival))) };
    console.log(name, cues, JSON.stringify(rows[name][cues]));
  }
}
writeFileSync(`${out}/baselines.json`, JSON.stringify({ protocol: 'docs/PREREGISTRATION_11.md', note: '描述性基线，不计入假设族；同一批评估世界（种子 270000 起，每单元 32 世界）', K, harmCap: HARM_CAP, seasonTicks: SEASON, inversions: INVERSIONS, rows }, null, 2));
console.log('写入', `${out}/baselines.json`);
