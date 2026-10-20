// 蒸馏先验：只依赖文本与 Laya 的缓存判断；拟合确定；输出在 (0,1)；训练方言上与 Laya 相关；不读取任何隐藏标签（池条目的 factor 不参与拟合）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fitHead, distilledPrior, D } from '../packages/evo/distill.ts';
import { loadLayaPriors } from '../packages/evo/pools.ts';

test('the head is deterministic and has 33 weights', () => { const a = fitHead(); assert.equal(a.length, D + 1); assert.ok(a.every(Number.isFinite)); assert.deepEqual(fitHead(), a); });
test('priors lie in (0,1), cover every embedded text and correlate with Laya on the training dialect', () => {
  const p = distilledPrior('train'), laya = loadLayaPriors('train'); assert.ok(p.size >= 12000); let sx = 0, sy = 0, n = 0; const xs = [], ys = [];
  for (const [t, v] of p) { assert.ok(v > 0 && v < 1); const l = laya.get(t); if (l !== undefined) { xs.push(v); ys.push(l); sx += v; sy += l; n++; } }
  const mx = sx / n, my = sy / n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  assert.ok(sxy / Math.sqrt(sxx * syy) > 0.7, `相关 ${sxy / Math.sqrt(sxx * syy)}`);
});
test('the fit does not read hidden labels: the fitting code never touches the pool factor', () => {
  const src = readFileSync(new URL('../packages/evo/distill.ts', import.meta.url), 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/\.factor|\.tier|cuePolarity/.test(src), '拟合代码不得引用 factor / tier / cuePolarity');
});
