import { createInterface } from 'node:readline';
import { Ecology, ECOLOGY_VERSION, stateHash } from './ecology.ts';
import { randomProposal, ruleProposal } from './controllers.ts';
const worlds = new Map<string, Ecology>();
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  try {
    const q = JSON.parse(line); let result: unknown;
    if (q.op === 'ping') result = { version: ECOLOGY_VERSION };
    else if (q.op === 'reset') {
      if (!worlds.has(q.id) && worlds.size >= 64) throw Error('world_capacity');
      const w = new Ecology(q.config); worlds.set(q.id, w); result = { requests: w.requests(), snapshot: w.snapshot() };
    } else if (q.op === 'close') { worlds.delete(q.id); result = { closed: true }; }
    else {
      const w = worlds.get(q.id); if (!w) throw Error('unknown_world');
      if (q.op === 'observe') result = w.requests();
      else if (q.op === 'inspect') result = w.inspect();
      else if (q.op === 'step') result = w.step(q.proposals);
      else if (q.op === 'controller') result = w.requests().map(r => (q.mode === 'random' ? randomProposal : ruleProposal)(r, w.snapshot().config.seed));
      else if (q.op === 'retry') result = w.retry(q.agentId);
      else if (q.op === 'cancel') { w.cancel(); result = { cancelled: true }; }
      else if (q.op === 'snapshot') result = w.snapshot();
      else if (q.op === 'restore') { w.restore(q.snapshot); result = { restored: true, hash: stateHash(w.snapshot()) }; }
      else if (q.op === 'intervene') { w.intervene(q.command); result = w.snapshot(); }
      else throw Error('unknown_operation');
    }
    process.stdout.write(JSON.stringify({ ok: true, result }) + '\n');
  } catch (error) { process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }) + '\n'); }
}
