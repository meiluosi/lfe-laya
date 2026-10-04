// 带子：任意位置跳转必须与顺序回放逐位一致；回放期间没有模型调用（Replay 不持有 provider）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, Replay, KEYFRAME_EVERY } from '../packages/sim/session.ts';
import { stateHash } from '../packages/sim/ecology.ts';

async function recorded(rounds = 70) {
  const s = new Session({ seed: 11, runId: 'tape-test' }, async () => { throw Error('no model in rule mode'); });
  s.changeMode('rule'); s.resume();
  for (let i = 0; i < rounds && !s.world.done(); i++) {
    await s.advance(true);
    if (i === 12) s.intervene({ kind: 'nutrient', x: 4, y: 4, amount: 12 });
    if (i === 30) s.intervene({ kind: 'obstacle', x: 6, y: 6, blocked: true });
  }
  return s.export();
}
const hashesSequential = recording => { const r = new Replay(recording), out = [stateHash(r.world.snapshot())]; while (r.step()) out.push(stateHash(r.world.snapshot())); return out; };

test('seek to every position equals sequential replay (forward, backward and random order)', async () => {
  const recording = await recorded(), expected = hashesSequential(recording), total = recording.entries.length;
  assert.ok(total > 3 * KEYFRAME_EVERY, 'need several keyframes');
  const r = new Replay(recording);
  for (let i = 0; i <= total; i++) { r.seek(i); assert.equal(stateHash(r.world.snapshot()), expected[i], `forward ${i}`); }
  for (let i = total; i >= 0; i--) { r.seek(i); assert.equal(stateHash(r.world.snapshot()), expected[i], `backward ${i}`); assert.equal(r.index, i); }
  let x = 12345;
  for (let n = 0; n < 60; n++) { x = (x * 1103515245 + 12345) & 0x7fffffff; const i = x % (total + 1); r.seek(i); assert.equal(stateHash(r.world.snapshot()), expected[i], `random ${i}`); }
});
test('evidence after seek equals evidence after sequential playback', async () => {
  const recording = await recorded(), total = recording.entries.length;
  for (const target of [1, KEYFRAME_EVERY, KEYFRAME_EVERY + 1, Math.floor(total / 2), total]) {
    const sequential = new Replay(recording); for (let i = 0; i < target; i++) sequential.step();
    const jumped = new Replay(recording); jumped.seek(total); jumped.seek(target);
    assert.deepEqual(jumped.evidence(), sequential.evidence(), `evidence at ${target}`);
    assert.deepEqual(jumped.learningEvidence(), sequential.learningEvidence());
  }
});
test('tape index matches the simulator at keyframes and is derived without simulation', async () => {
  const recording = await recorded(), r = new Replay(recording), tape = r.tape();
  assert.equal(tape.length, recording.entries.length);
  for (let k = 0; k < tape.length; k += 5) {
    const check = new Replay(recording); check.seek(k + 1); const snap = check.world.snapshot();
    assert.equal(tape[k].tick, snap.tick, `tick at ${k}`); assert.equal(tape[k].living, snap.agents.length, `living at ${k}`);
  }
  assert.ok(tape.some(m => m.kind === 'intervention' && m.intervention === 'nutrient'));
  assert.equal(r.index, 0, 'tape() must not move the playhead');
});
test('out-of-range seek and tampered records are rejected', async () => {
  const recording = await recorded(20), r = new Replay(recording);
  for (const bad of [-1, recording.entries.length + 1, 1.5, NaN]) assert.throws(() => r.seek(bad), /seek_out_of_range/);
  const tampered = structuredClone(recording); tampered.entries[5].afterHash = 'deadbeefdeadbeef';
  const t = new Replay(tampered); assert.throws(() => t.seek(tampered.entries.length), /replay_after_mismatch:5/);
  const bad = new Replay(tampered); bad.seek(4); assert.equal(bad.index, 4, 'positions before the tampered record stay usable');
});
test('live session tape equals the tape of its exported recording', async () => {
  const s = new Session({ seed: 3, runId: 'tape-live' }, async () => { throw Error('none'); });
  s.changeMode('rule'); s.resume(); for (let i = 0; i < 25; i++) await s.advance(true);
  s.intervene({ kind: 'nutrient', x: 2, y: 2, amount: 5 });
  assert.deepEqual(s.tape(), new Replay(s.export()).tape());
});
