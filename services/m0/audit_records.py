"""复核真实日志的确定性回放与真实检查点续接；不重新调用模型。"""
import argparse, copy, hashlib, json
import numpy as np
import torch
from bridge import ROOT, Bridge
from gym_env import features, mask
from policy import PolicySession

def equal(a,b):
    if isinstance(a,torch.Tensor): return torch.equal(a,b)
    if isinstance(a,np.ndarray): return np.array_equal(a,b)
    if isinstance(a,dict): return a.keys()==b.keys() and all(equal(a[k],b[k]) for k in a)
    if isinstance(a,(tuple,list)): return len(a)==len(b) and all(equal(x,y) for x,y in zip(a,b))
    return a==b

def audit(source,checkpoint):
    torch.set_num_threads(2)
    rows=[]
    for stage in ['online','heldout']:
        path=source/f'{stage}-decisions.jsonl'
        if path.exists():
            rows.extend(json.loads(line) for line in path.read_text().splitlines() if line.strip())
    trajectories={}
    for row in rows:
        if 'transition' in row:trajectories.setdefault(row['id'],[]).append(row)
    counts={}
    with Bridge() as bridge:
        for identifier,records in trajectories.items():
            bridge.call('reset',id=identifier,config=records[0]['transition']['snapshot']['config'])
            for row in records:
                expected=row['transition'];request=bridge.call('observe',id=identifier)
                assert request==expected['request'],(identifier,expected['tick'],'observation')
                actual=bridge.call('step',id=identifier,proposal=expected['proposal'])
                assert actual==expected,(identifier,expected['tick'],'transition')
            counts[identifier]=len(records)
    resumed=[]
    states=torch.load(checkpoint,weights_only=False,map_location='cpu')
    with Bridge() as bridge:
        for identifier,state in states.items():
            if state['done'] or not state['policy'] or state['policy']['frozen']:continue
            next_row=next((r for r in trajectories[identifier] if r['transition']['tick']==state['world']['tick']+1),None)
            if next_row is None:raise RuntimeError('Wait until source contains checkpoint successor')
            pair=[];updates=[];decisions=[];transitions=[]
            for _ in range(2):
                p=PolicySession(state['policy']['seed'],state['policy']['config']);p.restore(state['policy']);pair.append(p)
            protected=pair[1].export()
            for branch_index,suffix in enumerate(['a','b']):
                branch=f'{identifier}-{suffix}'
                bridge.call('reset',id=branch,config=state['world']['config'])
                bridge.call('restore',id=branch,snapshot=state['world'])
                request=bridge.call('observe',id=branch)
                assert request['observation']==next_row['transition']['request']['observation']
                p=pair[branch_index]
                prior=next_row['model']['proposal']['distribution'] if next_row['model'] else None
                obs=features(request,prior)
                if state['needs_update']:
                    updates.append(p.update(obs,False,f'{identifier}:resume-audit:{p.revision}',p.revision))
                decision=p.act(request,obs,mask(request));transition=bridge.call('step',id=branch,proposal=decision)
                p.settle(transition);decisions.append(decision);transitions.append(transition)
                if branch_index==0:
                    untouched=pair[1].export()
                    for key in ['parameters','optimizer','rng','consumed','committed','pending','revision','num_timesteps']:
                        assert equal(untouched[key],protected[key]),('cross-individual mutation',key)
                    for key in ['observations','actions','rewards','returns','values','log_probs','advantages','action_masks','episode_starts','pos','full']:
                        assert equal(getattr(untouched['buffer'],key),getattr(protected['buffer'],key)),('cross-individual buffer mutation',key)
            assert decisions[0]==decisions[1]
            assert transitions[0]==transitions[1]
            expected=next_row['transition']
            assert decisions[0]['action']==expected['action']
            assert transitions[0]['snapshot']==expected['snapshot']
            assert transitions[0]['reward']==expected['reward']
            assert equal(pair[0].model.policy.optimizer.state_dict(),pair[1].model.policy.optimizer.state_dict())
            assert pair[0].fingerprint()==pair[1].fingerprint()
            assert pair[0].rng is not pair[1].rng and pair[0].model.rollout_buffer is not pair[1].model.rollout_buffer
            assert pair[0].settle(transitions[0])=={'duplicate':True}
            if updates:
                retry=pair[0].update(obs,False,updates[0]['batch_id'],updates[0]['input_revision'])
                assert retry==updates[0]
            resumed.append({'id':identifier,'checkpoint_tick':state['world']['tick'],'action':decisions[0]['action'],
                'revision':pair[0].revision,'parameters':pair[0].fingerprint(),'updated':bool(updates),
                'same_as_original_execution':True,'pair_optimizer_and_parameters_equal':True,'duplicate_experience_ignored':True,
                'updating_one_leaves_other_parameters_optimizer_experience_rng_unchanged':True})
    assert resumed,'No live learning checkpoint available'
    result={'source':str(source.relative_to(ROOT)),'checkpoint_sha256':hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
        'replayed_transitions':sum(counts.values()),'trajectories':counts,'resume_checks':resumed,
        'model_input':'reuse actual recorded probabilities at matching observation; no new inference; replay is not new model evidence',
        'scope':'same pinned runtime; full execution replay; twin checkpoint branches update and execute identically'}
    (ROOT/'experiments/m0/evidence/record-audit.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('run');parser.add_argument('--checkpoint',default='experiments/m0/evidence/real-resume-source.pt');args=parser.parse_args()
    audit(ROOT/args.run,ROOT/args.checkpoint)
