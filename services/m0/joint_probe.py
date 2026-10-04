"""真实 Laya、独立策略、TS 世界及一次梯度更新的联合预算。"""
import json,time,statistics,threading,resource
import numpy as np
import psutil
import torch
from bridge import ROOT,Bridge
from policy import PolicySession
from gym_env import features,mask
from laya_provider import LayaProvider

if __name__=='__main__':
    torch.set_num_threads(2);provider=LayaProvider();result={'model':provider.metadata(),'batches':[]}
    with Bridge() as bridge:
        for count in [1,8]:
            policies=[PolicySession(810+i) for i in range(count)]
            identifiers=[f'joint-{count}-{i}' for i in range(count)]
            requests=[bridge.call('reset',id=identifier,config={'seed':810+i,'runId':identifier}) for i,identifier in enumerate(identifiers)]
            rounds=[];updates=[];start=time.perf_counter()
            peaks={'rss':psutil.Process().memory_info().rss,'mps_driver':torch.mps.driver_allocated_memory()}
            stop=threading.Event()
            def sample():
                while not stop.wait(.02):
                    peaks['rss']=max(peaks['rss'],psutil.Process().memory_info().rss)
                    peaks['mps_driver']=max(peaks['mps_driver'],torch.mps.driver_allocated_memory())
            sampler=threading.Thread(target=sample,daemon=True);sampler.start()
            with (ROOT/f'experiments/m0/evidence/joint-{count}.jsonl').open('w') as log:
                for step in range(33):
                    begin=time.perf_counter();model_start=time.perf_counter();records=provider.predict(requests)
                    model_ms=(time.perf_counter()-model_start)*1000
                    for i,(p,record) in enumerate(zip(policies,records)):
                        obs=features(requests[i],record['proposal']['distribution'])
                        if p.model.rollout_buffer.full:updates.append(p.update(obs,False,f'{identifiers[i]}:32',p.revision))
                        proposal=p.act(requests[i],obs,mask(requests[i]));transition=bridge.call('step',id=identifiers[i],proposal=proposal)
                        assert transition['accepted'] and not transition['terminated'] and not transition['truncated']
                        p.settle(transition);requests[i]=bridge.call('observe',id=identifiers[i])
                        log.write(json.dumps({'model':record,'transition':transition})+'\n')
                    rounds.append({'step':step+1,'wall_ms':(time.perf_counter()-begin)*1000,'model_ms':model_ms})
            stop.set();sampler.join()
            p=policies[0]
            state_bytes={'parameters':sum(v.numel()*v.element_size() for v in p.model.policy.state_dict().values()),
                'optimizer_tensors':sum(v.numel()*v.element_size() for s in p.model.policy.optimizer.state_dict()['state'].values() for v in s.values() if isinstance(v,torch.Tensor)),
                'rollout_arrays':sum(v.nbytes for v in vars(p.model.rollout_buffer).values() if isinstance(v,np.ndarray))}
            result['batches'].append({'count':count,'steps_per_individual':33,'elapsed_seconds':time.perf_counter()-start,
                'round_median_ms':statistics.median(r['wall_ms'] for r in rounds),'round_max_ms':max(r['wall_ms'] for r in rounds),
                'rounds':rounds,'updates':updates,'parameters_per_individual':sum(p.numel() for p in policies[0].model.policy.parameters()),
                'sampled_peak_bytes':peaks,'individual_tensor_array_bytes':state_bytes,
                'memory_scope':'RSS and MPS driver measured separately, not additive; individual arrays exclude Python/framework overhead'})
    result['process_peak_rss_bytes']=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    (ROOT/'experiments/m0/evidence/joint-probe.json').write_text(json.dumps(result,indent=2))
    print(json.dumps([{k:v for k,v in b.items() if k not in ['rounds','updates']} for b in result['batches']],indent=2))
