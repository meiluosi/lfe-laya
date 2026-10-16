// 开发期诊断（非确认性）：给训练过程中的检查点基因组做难度响应曲线，用于判断
// 预注册 10 §6.1 所说的“没有先验的个体学不会这个世界、停在什么都不吃”能否被难度参数绕开。
// 不使用任何训练信号，只做评估；结果只用于选择下一轮开发期预实验的难度档，不进入正式协议。
// 用法：node packages/evo/ripening-grid.ts <基因组> [--worlds N] [--Ks 4,8,16] [--harmCaps 1,2,4] [--season 300]
//   <基因组> 形如 experiments/evo/f10-none-51/theta-gen0020.json 或 .../final.json，可给多个。
import { readFileSync } from 'node:fs';
import { registerPools, loadLayaPriors, vaderPrior, type Priors } from './pools.ts';
import { runSemanticWorld, type SemanticFactory } from './semantic-run.ts';
import { structuredCohort } from './structured.ts';
import { structuredSocialCohort, SOCIAL_GENES } from './structured-social.ts';

const argv = process.argv.slice(2);
const specs = argv.filter(a => !a.startsWith('--')), opt = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const optN = (n: string, d: number) => Number(opt(n, String(d)));
const N = optN('worlds', 8), SEASON = optN('season', 300);
const KS = opt('Ks', '4,8,16').split(',').map(Number), HARMS = opt('harmCaps', '1,2,4').split(',').map(Number);
const CUES = (opt('cues', 'language,off') as string).split(',') as ('language' | 'off' | 'shuffled')[];
registerPools();
const priors: Record<string, Priors> = { laya: loadLayaPriors('heldout'), none: new Map<string, number>(), vader: vaderPrior() };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

for (const file of specs) {
  const j = JSON.parse(readFileSync(file, 'utf8')) as { innate: number[]; condition?: { prior: string } };
  const prior = (file.match(/-((?:laya|none|vader))-/) ?? [])[1] ?? j.condition?.prior ?? 'none';
  // 按基因组长度分派控制器：10 基因 = 社会学习个体（预注册 09），9 基因 = 结构化个体 v2（预注册 10）
  const f: SemanticFactory = () => j.innate.length === SOCIAL_GENES
    ? structuredSocialCohort(j.innate, prior === 'none' ? 'none' : 'laya', priors[prior])
    : structuredCohort(j.innate, prior === 'none' ? 'none' : 'laya', priors[prior]);
  console.log(`\n### ${file}  先验=${prior}`);
  console.log(['K', 'harmCap', ...CUES.map(c => `${c}:fit`), ...CUES.map(c => `${c}:毒`), '存活'].join('\t'));
  for (const K of KS) for (const harmCap of HARMS) {
    const row: string[] = [String(K), String(harmCap)];
    const fits: Record<string, number> = {}, toxi: Record<string, number> = {};
    let surv = 0;
    for (const cues of CUES) {
      const invs = [.25, .4];
      const rs = invs.flatMap((inv, ci) => Array.from({ length: N }, (_, i) => runSemanticWorld({ seed: 400000 + i + ci * 1000, options: { split: 'test', pool: 'heldout', sensible: K, harmCap, inversion: inv, ripening: { seasonTicks: SEASON, cues, phrases: 'B', poolLimit: 1000 } } }, f)));
      fits[cues] = +mean(rs.map(r => r.fitness)).toFixed(3); toxi[cues] = +mean(rs.map(r => r.toxicBites)).toFixed(1); surv = +mean(rs.map(r => r.survival)).toFixed(3);
    }
    row.push(...CUES.map(c => String(fits[c])), ...CUES.map(c => String(toxi[c])), String(surv));
    console.log(row.join('\t'));
  }
}
