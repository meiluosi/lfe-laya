import { ACTIONS } from '../../packages/protocol/ecology';
import type { LearningUpdate } from '../../packages/sim/learning-port';

const labels = ['向北', '向东', '向南', '向西', '摄食', '休眠', '繁殖'];
const percent = (value: number) => `${(value * 100).toFixed(2)}%`;

/** 固定同一观测比较实际更新前后分布；不是新的一轮动作，也不是收益判据。 */
export function LearningEvidence({ update, replay }: { update: LearningUpdate; replay: boolean }) {
  const probe = update.probe;
  return <div className="learning-change">
    <p>{replay ? '录制中的更新' : '最近已确认更新'} · {update.agentId} · v{update.input_revision} → v{update.revision} · {update.samples} 次真实经历</p>
    {probe && <details><summary>查看同一观测的策略变化 · 最大 {(probe.maxDelta * 100).toFixed(2)} 个百分点</summary>
      <div className="comparison-scroll"><table><thead><tr><th>动作</th><th>更新前</th><th>更新后</th><th>变化（百分点）</th></tr></thead><tbody>
        {ACTIONS.map((action, i) => <tr key={action}><td>{labels[i]}{!probe.mask[i] ? ' · 不可选' : ''}</td><td>{percent(probe.before[i])}</td><td>{percent(probe.after[i])}</td><td>{((probe.after[i] - probe.before[i]) * 100).toFixed(2)}</td></tr>)}
      </tbody></table></div><p>比较使用这次更新记录的同一局部观测，动作可选范围也相同。概率变化不等于生存改善。</p>
    </details>}
  </div>;
}
