/// <reference types="vite/client" />
// 训练产出的先天基因组（experiments/evo/sem-*-01/final.json）。构建时自动发现；没有训练结果时列表为空。
// 先验表是固定 Laya 对全部描述词的真实输出（预先计算并缓存），不是代理模型。
import priorDoc from '../../experiments/evo/laya-prior-v1.json';
import { semanticCohort, SEM_INNATE_SIZE, SEM_INNATE_SIZE_V1, type SemCondition } from '../../packages/evo/sempolicy';
import { structuredCohort } from '../../packages/evo/structured';
import { structuredRegimeCohort, structuredCueCohort } from '../../packages/evo/structured-ctx';
import type { EvolvedController } from '../../packages/sim/session.ts';

type Genome = { condition: SemCondition; innate: number[] };
const files = import.meta.glob('../../experiments/evo/sem-*-01/final.json', { eager: true }) as Record<string, { default: Genome }>;
const priors = new Map(Object.entries((priorDoc as { priors: Record<string, { pEat: number }> }).priors).map(([k, v]) => [k, v.pEat]));
export const evolvedGenomes: Record<string, Genome> = Object.fromEntries(Object.entries(files).filter(([, m]) => m.default.innate.length === SEM_INNATE_SIZE || m.default.innate.length === SEM_INNATE_SIZE_V1).map(([path, m]) => [path.match(/sem-(\w+-\w+)-01/)![1], m.default]));
// 预注册 17 的冻结基因组（有 Laya 先验，训练种子 211）：普通学习、环境分段记忆、线索键控记忆。它们在词池世界里进化，这里在内置小词表世界运行，不是预注册评估世界。
const ctxFiles = import.meta.glob('../../experiments/evo/f17-laya-{plain,regime,cue}-211/final.json', { eager: true }) as Record<string, { default: { innate: number[] } }>;
export const ctxGenomes: Record<string, number[]> = Object.fromEntries(Object.entries(ctxFiles).map(([path, m]) => [`ctx-${path.match(/f17-laya-(\w+)-211/)![1]}`, m.default.innate]));
const CTX_LABEL: Record<string, string> = { 'ctx-plain': '普通学习', 'ctx-regime': '环境分段记忆', 'ctx-cue': '线索键控记忆' };
export const evolvedFactory = (name: string): EvolvedController | null => {
  const t = ctxGenomes[name]; if (t) return (name === 'ctx-regime' ? structuredRegimeCohort : name === 'ctx-cue' ? structuredCueCohort : structuredCohort)(t, 'laya', priors) as EvolvedController;
  const g = evolvedGenomes[name]; return g ? semanticCohort(g.innate, g.condition, priors) : null;
};
/** 例如 laya-on → 「进化先天 · Laya 先验 · 终身学习开」 */
export function evolvedLabel(name: string): string { if (ctxGenomes[name]) return `进化先天 · Laya 先验 · ${CTX_LABEL[name]}（预注册 17 基因组）`; const g = evolvedGenomes[name]; return g ? `进化先天 · ${g.condition.prior === 'laya' ? 'Laya 先验' : '无先验'} · 终身学习${g.condition.learning ? '开' : '关'}` : `进化 ${name}`; }
