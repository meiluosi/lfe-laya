// 由 TS 世界生成协议夹具：真实请求（含繁殖/障碍/邻居/记忆等多样状态）。
// 用法：node scripts/gen_contract_fixture.mjs        重新生成 tests/fixtures/requests.json
//       tests/contract.test.mjs 会在夹具与当前 TS 输出不一致时失败，提醒更新并同步 Python 端。
import { Ecology, ECOLOGY_VERSION } from '../packages/sim/ecology.ts';
import { ruleProposal } from '../packages/sim/controllers.ts';
import { ECOLOGY_PROTOCOL } from '../packages/protocol/ecology.ts';
import { writeFileSync } from 'node:fs';

const SEMANTIC = { kinds: [{ description: 'ripe and sweet berry', factor: 1 }, { description: 'rotten and foul-smelling berry', factor: -1 }, { description: 'dull grey lump', factor: .5 }] };
export function build(semantic = false) {
  const samples = [];
  const world = new Ecology(semantic ? { seed: 7, runId: 'contract-semantic', width: 12, height: 10, diffusion: 0, deathReturn: 0, semantic: SEMANTIC } : { seed: 7, runId: 'contract' });
  const seen = new Set();
  for (let round = 0; round < 400 && !world.done(); round++) {
    const requests = world.requests();
    for (const r of requests) {
      // 以候选集合与邻居/记忆/障碍特征去重，保留形态多样的样本。
      const key = [r.candidates.map(c => c.id).join(), r.observation.neighbors.length > 0, r.observation.memory.length > 0, r.observation.local.some(c => c.blocked), r.observation.lastRejected, r.observation.local.some(c => c.desc), r.observation.memory.some(m => m.desc)].join('|');
      if (!seen.has(key) && samples.length < 24) { seen.add(key); samples.push(r); }
    }
    world.step(requests.map(r => ruleProposal(r, 7)));
  }
  return { version: ECOLOGY_VERSION, protocol: ECOLOGY_PROTOCOL, requests: samples };
}
if (process.argv[1].endsWith('gen_contract_fixture.mjs')) {
  for (const [semantic, name] of [[false, 'requests.json'], [true, 'requests-semantic.json']]) {
    const data = build(semantic); writeFileSync(new URL(`../tests/fixtures/${name}`, import.meta.url), JSON.stringify(data, null, 1) + '\n'); console.log(`wrote ${name}: ${data.requests.length} requests`);
  }
}
