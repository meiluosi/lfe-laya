import { parentPort } from 'node:worker_threads';
import { evaluate, policyController, type WorldSpec } from './evaluate.ts';

type Task = { id: number; theta: number[]; specs: WorldSpec[]; greedy?: boolean };
parentPort!.on('message', (task: Task) => {
  try { parentPort!.postMessage({ id: task.id, result: evaluate(policyController(task.theta, task.greedy), task.specs) }); }
  catch (error) { parentPort!.postMessage({ id: task.id, error: String(error) }); }
});
