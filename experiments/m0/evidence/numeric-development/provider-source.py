"""固定 Laya 适配器：许可观测 -> 候选偏好。原始舍入概率与归一化提案分开。"""
import copy
import hashlib
import importlib.metadata
import json
import os
import math
import shutil
import tempfile
import time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
TEMPLATE_VERSION='local-foraging-en-v1'

def encode(request, memory=True):
    observation=request['observation']
    # 严格白名单：系统关联 ID、世界快照、日程都不会进入模型。
    allowed={'energy','capacity','age','local','memory'}
    if set(observation)!=allowed:raise ValueError('unexpected observation fields')
    for c in observation['local']:
        if set(c)!={'dx','dy','food','blocked'}:raise ValueError('unexpected local fields')
    for c in observation['memory']:
        if set(c)!={'dx','dy','food','stepsAgo'}:raise ValueError('unexpected memory fields')
    state={'self':{k:observation[k] for k in ['energy','capacity','age']},
           'visible_format':'[dx,dy,food,blocked]', 'visible_cells':[[c['dx'],c['dy'],round(c['food'],4),c['blocked']] for c in observation['local']],
           'memory_format':'[dx,dy,food,steps_ago]', 'remembered_food':[[m['dx'],m['dy'],round(m['food'],4),m['stepsAgo']] for m in observation['memory']] if memory else []}
    labels={f'option_{i}':c['id'] for i,c in enumerate(request['candidates'])}
    if len(set(labels.values()))!=len(labels) or not labels:raise ValueError('invalid candidates')
    criteria={label:request['candidates'][i]['description'] for i,label in enumerate(labels)}
    questions={'action':{'type':'choice','instructions':
        'Choose one action to maintain energy and survive. Food can be eaten only at the current location. '+
        'Coordinates are relative: dx positive is east; dy positive is south. Movement costs energy; resting still costs metabolism. '+
        'Use only visible cells and remembered food. Memories may be outdated.', 'criteria':criteria}}
    return state,questions,labels

class LayaProvider:
    def __init__(self,device='mps'):
        import torch,laya
        self.manifest=json.loads((ROOT/'experiments/m0/model-manifest.json').read_text())
        self.requested_device=device
        self.start=time.perf_counter()
        source=ROOT/self.manifest['local_dir']
        runtime_root=ROOT/'.models/runtime';runtime_root.mkdir(exist_ok=True)
        runtime=Path(tempfile.mkdtemp(prefix='laya-',dir=runtime_root))
        for name in self.manifest['files']:
            target=runtime/name;target.parent.mkdir(parents=True,exist_ok=True)
            if name.endswith('.safetensors'):os.link(source/name,target)
            else:shutil.copy2(source/name,target)
        self.agent=laya.load(str(runtime),device=device,
            expected_sha256={p:d['sha256'] for p,d in self.manifest['files'].items()})
        config_path='tokenizer/tokenizer_config.json'
        self.tokenizer_runtime_sha256=hashlib.sha256((runtime/config_path).read_bytes()).hexdigest()
        self.load_seconds=time.perf_counter()-self.start
        self.version=laya.__version__
        if device=='mps':torch.mps.synchronize()
        if str(self.agent.device)!=device:raise RuntimeError(f'device mismatch: {self.agent.device}')
    def metadata(self):
        return {'provider':'laya','sdk':self.version,'repo':self.manifest['repo'],'revision':self.manifest['revision'],
                'requested_device':self.requested_device,'actual_device':str(self.agent.device),
                'cpu_fallback_count':self.agent.cpu_fallback_count,'template':TEMPLATE_VERSION,'load_seconds':self.load_seconds,'tokenizer_runtime_sha256':self.tokenizer_runtime_sha256}
    def predict(self,requests,memory=True):
        import torch
        from laya.common import build_sequence
        records=[None]*len(requests)
        groups={}
        for i,request in enumerate(requests):
            state,questions,labels=encode(request,memory)
            internal=self.agent._to_internal(questions['action'])
            full,_=build_sequence(self.agent.tok,state,internal,max_len=100000,head_max_len=100000)
            bounded,_=build_sequence(self.agent.tok,state,internal,max_len=1024,head_max_len=256)
            if full!=bounded:raise ValueError('input or question would be truncated')
            key=json.dumps(questions,sort_keys=True)
            groups.setdefault(key,[]).append((i,state,questions,labels))
        for group in groups.values():
            start=time.perf_counter()
            raw=self.agent.predict_batch([x[1] for x in group],group[0][2],batch_size=len(group),max_len=1024,head_max_len=256)
            if str(self.agent.device)=='mps':torch.mps.synchronize()
            elapsed=(time.perf_counter()-start)*1000
            if str(self.agent.device)!=self.requested_device or self.agent.cpu_fallback_count:
                raise RuntimeError('unexpected CPU fallback; inference rejected')
            for (i,state,questions,labels),result in zip(group,raw):
                usage=result.get('usage',{})
                if usage.get('truncated') or usage.get('options'):raise RuntimeError('model input truncated')
                probabilities=result['answers']['action']['probabilities']
                if set(probabilities)!=set(labels):raise RuntimeError('candidate mapping mismatch')
                if any(not isinstance(v,(int,float)) or not math.isfinite(v) or v<0 or v>1 for v in probabilities.values()):raise RuntimeError('invalid probabilities')
                total=sum(probabilities.values())
                if not 0.99<total<1.01:raise RuntimeError('invalid probability sum')
                distribution={labels[k]:v/total for k,v in probabilities.items()}
                action=labels[result['answers']['action']['choice']]
                request=requests[i]
                payload={'state':state,'questions':questions}
                records[i]={'proposal':{'identity':copy.deepcopy(request['identity']),'provider':'laya','action':action,'distribution':distribution},
                    'input':payload,'raw_output':result,'metadata':self.metadata(),
                    'input_sha256':hashlib.sha256(json.dumps(payload,sort_keys=True).encode()).hexdigest(),
                    'batch_ms':elapsed,'batch_size':len(group),'amortized_ms':elapsed/len(group)}
        return records
