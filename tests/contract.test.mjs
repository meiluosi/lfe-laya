// 协议契约（TS 侧）：夹具必须等于当前 TS 世界产出的请求；漂移时失败，并提示重新生成。
// Python 侧 tests/test_ecology_contract.py 读取同一夹具，检查 encode() 接受真实请求并拒绝破坏性变更。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from '../scripts/gen_contract_fixture.mjs';
import { validateProposal } from '../packages/protocol/ecology.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/requests.json', import.meta.url), 'utf8'));
test('contract fixture matches the live TS simulator output', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(build())), fixture, '协议或世界输出已变化：运行 node scripts/gen_contract_fixture.mjs，并确认 Python encode() 仍通过');
});
const semanticFixture = JSON.parse(readFileSync(new URL('./fixtures/requests-semantic.json', import.meta.url), 'utf8'));
test('semantic contract fixture matches the live TS simulator output and carries descriptions', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(build(true))), semanticFixture, '语义世界请求已变化：运行 node scripts/gen_contract_fixture.mjs');
  assert.ok(semanticFixture.requests.some(r => r.observation.local.some(c => c.desc)), '需要含食物描述的样本'); assert.ok(semanticFixture.requests.some(r => r.observation.memory.some(m => m.desc)));
  assert.ok(!/factor/.test(JSON.stringify(semanticFixture)), '隐藏真值不能进入请求');
});
test('fixture covers diverse request shapes', () => {
  assert.ok(fixture.requests.length >= 8);
  assert.ok(fixture.requests.some(r => r.observation.neighbors.length), '需要含邻居样本');
  assert.ok(fixture.requests.some(r => r.observation.memory.length), '需要含记忆样本');
  assert.ok(fixture.requests.some(r => r.candidates.some(c => c.id === 'reproduce')));
});
test('every fixture request accepts its own rest proposal and rejects stale identity', () => {
  for (const r of fixture.requests) {
    const ok = { identity: r.identity, action: 'rest', provider: 'contract' };
    assert.equal(validateProposal(r, ok), null);
    assert.equal(validateProposal(r, { ...ok, identity: { ...r.identity, tick: r.identity.tick + 1 } }), 'stale_tick');
  }
});
