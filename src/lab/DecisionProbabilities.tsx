import { ACTIONS, type Proposal } from '../../packages/protocol/ecology';
const labels=['向北','向东','向南','向西','摄食','休眠','繁殖'];
const probability=(value:number|undefined)=>value===undefined?'—':`${(value*100).toFixed(2)}%`;
export function DecisionProbabilities({proposal,prior}:{proposal:Proposal;prior:Proposal['distribution']}) {
  if(!proposal.distribution) return null;
  return <details><summary>动作偏好与实际选择</summary><div className="comparison-scroll"><table><thead><tr><th>动作</th><th>Laya 偏好</th><th>执行策略</th><th>实际选择</th></tr></thead><tbody>
    {ACTIONS.filter(action=>proposal.distribution?.[action]!==undefined).map(action=><tr key={action}><td>{labels[ACTIONS.indexOf(action)]}</td><td>{probability(prior?.[action])}</td><td>{probability(proposal.distribution?.[action])}</td><td>{proposal.action===action?'已选择':'—'}</td></tr>)}
  </tbody></table></div>{!prior&&<p>本轮没有 Laya 偏好；空白不表示模型给出零概率。</p>}</details>;
}
