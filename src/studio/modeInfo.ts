import { modeName, type View } from '../lab/labels';
import { evolvedLabel } from './genomes';

export type Tone = 'evolved' | 'live' | 'scrub' | 'replay' | 'learning' | 'frozen' | 'fallback';
/** 证据边界徽标：文字 + 符号 + 色调，三者同时表达，不只靠颜色。 */
export function modeInfo(view: View): { symbol: string; title: string; note: string; tone: Tone } {
  const brain = modeName(view.mode, evolvedLabel);
  if (view.replay?.live) return { symbol: '◀', title: '回看 · 实时会话', note: '会话已暂停，回看不改变世界、不调用模型、不训练', tone: 'scrub' };
  if (view.replay) return { symbol: '▣', title: '录制回放', note: '按记录的动作重放 · 不调用模型 · 不训练', tone: 'replay' };
  if (view.mode.startsWith('evolved:')) return { symbol: '◈', title: `真实模拟 · ${brain}`, note: '先天参数来自进化；个体信念只在本次寿命内形成 · 不可分支', tone: 'evolved' };
  if (view.mode === 'rule-fallback') return { symbol: '⚠', title: '规则降级', note: '模型不可用时明确切换；不计入纯 Laya 结果', tone: 'fallback' };
  if (view.mode === 'learning' || view.mode === 'no-laya') return { symbol: '◆', title: `真实模拟 · ${brain}`, note: view.paused ? '世界暂停 · 独立学习状态保留' : '个体独立训练中 · 效果待对照验证', tone: 'learning' };
  if (view.mode.endsWith('frozen')) return { symbol: '❄', title: `真实模拟 · ${brain}`, note: '策略参数冻结 · 行为仍可继续', tone: 'frozen' };
  return { symbol: '●', title: `真实模拟 · ${brain}`, note: '共享世界 · 未训练个体策略', tone: 'live' };
}
