// 开发期分析（非确认性，不涉及进化）：把 Laya 的缓存判断蒸馏进 32 维嵌入上的线性头，检验这个固定的头在新方言上能否复现 Laya 的区分力。
// 只用文本：训练目标是 Laya 对训练方言描述的 P(eat)（不使用任何隐藏标签）；隐藏标签只用于最后度量 AUC。
// 用法：node packages/evo/distill-head.ts [--lambda 1] [--logit]
import { registerPools, loadLayaPriors, loadEmbeddings } from './pools.ts';
const lam = process.argv.includes('--lambda') ? Number(process.argv[process.argv.indexOf('--lambda') + 1]) : 1, useLogit = process.argv.includes('--logit');
const pools = registerPools() as Record<string, { text: string; factor: number }[] | undefined>, D = 32;
const target = (p: number) => useLogit ? Math.log(Math.min(.99, Math.max(.01, p)) / (1 - Math.min(.99, Math.max(.01, p)))) : p;
function data(dialect: 'train' | 'heldout' | 'factual') { const pri = loadLayaPriors(dialect), emb = loadEmbeddings(dialect); return (pools[dialect] ?? []).filter(e => pri.has(e.text) && emb.has(e.text)).map(e => ({ x: Array.from(emb.get(e.text)!), p: pri.get(e.text)!, good: e.factor > 0 })); }
const train = data('train'); if (!train.length) throw Error('no training data');
// 岭回归：(XᵀX + λI) w = Xᵀy，含偏置
const n = D + 1, A = Array.from({ length: n }, () => new Array(n).fill(0)), b = new Array(n).fill(0);
for (const r of train) { const x = [...r.x, 1], y = target(r.p); for (let i = 0; i < n; i++) { b[i] += x[i] * y; for (let j = 0; j < n; j++) A[i][j] += x[i] * x[j]; } }
for (let i = 0; i < D; i++) A[i][i] += lam;
for (let i = 0; i < n; i++) { let m = i; for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[m][i])) m = k; [A[i], A[m]] = [A[m], A[i]]; [b[i], b[m]] = [b[m], b[i]]; for (let k = i + 1; k < n; k++) { const f = A[k][i] / A[i][i]; for (let j = i; j < n; j++) A[k][j] -= f * A[i][j]; b[k] -= f * b[i]; } }
const w = new Array(n).fill(0); for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let j = i + 1; j < n; j++) s -= A[i][j] * w[j]; w[i] = s / A[i][i]; }
const pred = (x: number[]) => { let s = w[D]; for (let i = 0; i < D; i++) s += w[i] * x[i]; return s; };
const auc = (pairs: [number, boolean][]) => { const o = pairs.map((p, i) => [p[0], p[1], i] as const).sort((a, b) => a[0] - b[0]); let rank = 0, sumPos = 0, nPos = 0; for (let i = 0; i < o.length;) { let j = i; while (j < o.length && o[j][0] === o[i][0]) j++; const avg = (i + 1 + j) / 2; for (let k = i; k < j; k++) if (o[k][1]) { sumPos += avg; nPos++; } i = j; rank += j - i; } return (sumPos - nPos * (nPos + 1) / 2) / (nPos * (o.length - nPos)); };
const corr = (a: number[], b: number[]) => { const ma = a.reduce((x, y) => x + y, 0) / a.length, mb = b.reduce((x, y) => x + y, 0) / b.length; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } return sab / Math.sqrt(saa * sbb); };
console.log(`λ=${lam} ${useLogit ? 'logit' : 'prob'} target; n_train=${train.length}`);
for (const d of ['train', 'heldout', 'factual'] as const) { const ds = d === 'train' ? train : data(d), ph = ds.map(r => pred(r.x)); console.log(d.padEnd(8), 'n', ds.length, '| head AUC', auc(ds.map((r, i) => [ph[i], r.good])).toFixed(3), '| Laya AUC', auc(ds.map(r => [r.p, r.good])).toFixed(3), '| corr(head, Laya)', corr(ph, ds.map(r => target(r.p))).toFixed(3)); }
