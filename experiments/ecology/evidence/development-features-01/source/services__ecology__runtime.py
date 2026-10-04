"""学习事务：prepare 暂存更新及提案，commit 仅接收实际反馈，abort 丢弃暂存。"""
import copy
import hashlib
import json
import numpy as np
from learning import IndividualPolicy, features, action_mask, OBS_SIZE


def stable_seed(seed,agent_id):
    return int.from_bytes(hashlib.sha256(f'{seed}:{agent_id}'.encode()).digest()[:4],'little') & 0x7fffffff


class LearningRuntime:
    VERSION='ecology-learning-runtime-v1'
    def __init__(self,run_id,seed,config=None,frozen=False,no_laya=False):
        if not isinstance(run_id,str) or not run_id or len(run_id)>120: raise ValueError('learning_run_id')
        self.run_id=run_id;self.seed=seed;self.config=copy.deepcopy(config or {})
        self.frozen=bool(frozen);self.no_laya=bool(no_laya);self.policies={};self.staged=None;self.receipts={};self.last_tick=-1
        self.retired={};self.last_world_hash=None
    def prepare(self,transaction_id,requests,records):
        if transaction_id in self.receipts: return {'committed':True,'receipt':copy.deepcopy(self.receipts[transaction_id])}
        signature=hashlib.sha256(json.dumps({'requests':requests,'records':records},sort_keys=True).encode()).hexdigest()
        if self.staged:
            if self.staged['id']==transaction_id and self.staged['signature']==signature: return copy.deepcopy(self.staged['response'])
            raise ValueError('uncommitted_learning_transaction')
        if not 1<=len(requests)<=64 or len({r['identity']['agentId'] for r in requests})!=len(requests): raise ValueError('learning_batch_budget')
        ticks={r['identity']['tick'] for r in requests}
        if len(ticks)!=1 or next(iter(ticks))<=self.last_tick or any(r['identity']['runId']!=self.run_id for r in requests): raise ValueError('learning_identity')
        if self.no_laya:
            if records: raise ValueError('no_laya_received_model_records')
            by_id={}
        else:
            if len(records)!=len(requests): raise ValueError('missing_model_priors')
            by_id={r['proposal']['identity']['agentId']:r for r in records}
            if len(by_id)!=len(records): raise ValueError('duplicate_model_prior')
        working={};proposals=[];updates=[];policy_inputs=[]
        for request in requests:
            identity=request['identity'];agent_id=identity['agentId']
            if agent_id in self.retired: raise ValueError('dead_policy_reused')
            if agent_id in self.policies: policy=IndividualPolicy.from_state(self.policies[agent_id].export())
            else: policy=IndividualPolicy(stable_seed(self.seed,agent_id),self.config);policy.set_frozen(self.frozen)
            prior=None
            if not self.no_laya:
                record=by_id.get(agent_id)
                if not record or record['proposal']['identity']!=identity or record['proposal']['provider']!='laya': raise ValueError('model_prior_identity')
                prior=record['proposal']['distribution'];legal={c['id'] for c in request['candidates']}
                if set(prior)!=legal or not all(np.isfinite(v) and 0<=v<=1 for v in prior.values()) or abs(sum(prior.values())-1)>1e-6: raise ValueError('model_prior_distribution')
            obs=features(request,prior);mask=action_mask(request)
            if not policy.frozen and policy.model.rollout_buffer.full:
                update=policy.update(obs,False,f'{agent_id}:update:{policy.revision}',policy.revision);updates.append({'agentId':agent_id,**update})
            proposal=policy.act(request,obs,mask,'individual-ppo-no-laya' if self.no_laya else 'laya+individual-ppo')
            proposals.append(proposal);working[agent_id]=policy
            policy_inputs.append({'agentId':agent_id,'encoding':policy.export()['encoding'],'features':obs.tolist(),'mask':mask.tolist(),'prior':prior,'revision':policy.revision})
        response={'transactionId':transaction_id,'proposals':proposals,'updates':updates,'policyInputs':policy_inputs,'committed':False}
        self.staged={'id':transaction_id,'signature':signature,'working':working,'response':copy.deepcopy(response),'requests':copy.deepcopy(requests),'records':copy.deepcopy(records)}
        return response
    def abort(self,transaction_id):
        if transaction_id in self.receipts: raise ValueError('already_committed')
        if not self.staged: return {'aborted':True,'duplicate':True}
        if self.staged['id']!=transaction_id: raise ValueError('stale_transaction')
        self.staged=None;return {'aborted':True,'duplicate':False}
    def commit(self,transaction_id,result):
        signature=hashlib.sha256(json.dumps(result,sort_keys=True).encode()).hexdigest()
        if transaction_id in self.receipts:
            receipt=self.receipts[transaction_id]
            if receipt['feedbackHash']!=signature: raise ValueError('duplicate_feedback_changed')
            return copy.deepcopy(receipt)
        stage=self.staged
        if not stage or stage['id']!=transaction_id: raise ValueError('unknown_transaction')
        if not result['accepted'] or result['proposals']!=stage['response']['proposals'] or len(result['outcomes'])!=len(stage['requests']): raise ValueError('feedback_barrier_mismatch')
        outcomes={o['agentId']:o for o in result['outcomes']}
        if len(outcomes)!=len(stage['requests']): raise ValueError('feedback_identity')
        # 对暂存状态再次复制：任一个体失败时，整个提交可用原始事务重试。
        working={k:IndividualPolicy.from_state(p.export()) for k,p in stage['working'].items()}
        updates=copy.deepcopy(stage['response']['updates']);retired={}
        for proposal in stage['response']['proposals']:
            agent_id=proposal['identity']['agentId'];policy=working[agent_id];outcome=outcomes[agent_id]
            policy.settle(proposal,outcome)
            if outcome['terminated']:
                if not policy.frozen and policy.model.rollout_buffer.pos:
                    update=policy.update(np.zeros(OBS_SIZE,np.float32),True,f'{agent_id}:terminal:{policy.revision}',policy.revision);updates.append({'agentId':agent_id,**update})
                retired[agent_id]=policy.export()
        if len(self.retired)+len(retired)>512: raise ValueError('retired_policy_capacity_export_required')
        next_policies=dict(self.policies)
        for key,policy in working.items():
            if key in retired: next_policies.pop(key,None)
            else: next_policies[key]=policy
        receipt={'transactionId':transaction_id,'feedbackHash':signature,'worldHash':result['afterHash'],'tick':result['snapshot']['tick'],
                 'updates':updates,'revisions':{key:p.revision for key,p in working.items()},'retired':list(retired)}
        self.policies=next_policies;self.retired.update(retired);self.last_tick=stage['requests'][0]['identity']['tick'];self.last_world_hash=result['afterHash'];self.staged=None
        self.receipts[transaction_id]=copy.deepcopy(receipt)
        while len(self.receipts)>64: del self.receipts[next(iter(self.receipts))]
        return receipt
    def finish(self,requests,records):
        if self.staged: raise ValueError('uncommitted_transaction')
        by_id={r['proposal']['identity']['agentId']:r for r in records};working={};updates=[]
        for request in requests:
            agent_id=request['identity']['agentId'];policy=IndividualPolicy.from_state(self.policies[agent_id].export())
            prior=None if self.no_laya else by_id[agent_id]['proposal']['distribution']
            if not policy.frozen and policy.model.rollout_buffer.pos:
                updates.append({'agentId':agent_id,**policy.update(features(request,prior),False,f'{agent_id}:truncation:{policy.revision}',policy.revision)})
            working[agent_id]=policy
        self.policies.update(working);return updates
    def set_frozen(self,frozen):
        if self.staged: raise ValueError('uncommitted_transaction')
        for policy in self.policies.values(): policy.set_frozen(frozen)
        self.frozen=bool(frozen)
    def export(self):
        if self.staged: raise ValueError('checkpoint_requires_committed_boundary')
        return copy.deepcopy({'version':self.VERSION,'run_id':self.run_id,'seed':self.seed,'config':self.config,'frozen':self.frozen,'no_laya':self.no_laya,
            'policies':{key:policy.export() for key,policy in self.policies.items()},'retired':self.retired,'receipts':self.receipts,'last_tick':self.last_tick,'last_world_hash':self.last_world_hash})
    @classmethod
    def from_state(cls,state,run_id=None):
        if state['version']!=cls.VERSION: raise ValueError('runtime_checkpoint_version')
        result=cls(run_id or state['run_id'],state['seed'],state['config'],state['frozen'],state['no_laya'])
        result.policies={key:IndividualPolicy.from_state(p) for key,p in state['policies'].items()};result.retired=copy.deepcopy(state['retired'])
        result.receipts=copy.deepcopy(state['receipts']) if run_id is None else {};result.last_tick=state['last_tick'];result.last_world_hash=state['last_world_hash']
        return result
