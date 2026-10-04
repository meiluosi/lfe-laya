"""固定 Laya 适配器：许可观测 -> 候选偏好。原始舍入概率与归一化提案分开。"""
import copy
import hashlib
import importlib.metadata
import json
import os
import math
import shutil
import atexit
import tempfile
import time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
TEMPLATE_VERSION='local-foraging-en-v2'

def encode(request, memory=True):
    identity=request['identity']
    identity_keys={'protocol','runId','generation','epoch','decisionId','attemptId','tick','snapshotId','agentId'}
    if set(identity)!=identity_keys or identity['protocol']!='m0-decision-v1':raise ValueError('invalid identity')
    observation=request['observation']
    def finite(value):return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value)
    for name in ['energy','capacity','age']:
        if not finite(observation[name]) or observation[name]<0:raise ValueError('invalid self state')
    if observation['capacity']<=0 or observation['energy']>observation['capacity']:raise ValueError('invalid capacity')
    if len(observation['local'])>13 or len(observation['memory'])>8:raise ValueError('observation budget exceeded')
    # 严格白名单：系统关联 ID、世界快照、日程都不会进入模型。
    allowed={'energy','capacity','age','local','memory'}
    if set(observation)!=allowed:raise ValueError('unexpected observation fields')
    for c in observation['local']:
        if set(c)!={'dx','dy','food','blocked'}:raise ValueError('unexpected local fields')
        if not all(finite(c[k]) for k in ['dx','dy','food']) or c['food']<0 or abs(c['dx'])+abs(c['dy'])>2 or not isinstance(c['blocked'],bool):raise ValueError('invalid local observation')
    for c in observation['memory']:
        if set(c)!={'dx','dy','food','stepsAgo'}:raise ValueError('unexpected memory fields')
        if not all(finite(c[k]) for k in c) or c['food']<0 or c['stepsAgo']<0:raise ValueError('invalid memory')
    def location(dx,dy):
        parts=[]
        if dy:parts.append(f"{abs(dy)} step(s) {'south' if dy>0 else 'north'}")
        if dx:parts.append(f"{abs(dx)} step(s) {'east' if dx>0 else 'west'}")
        return ' and '.join(parts) if parts else 'your current location'
    sentences=[f"You are a small creature with {observation['energy']:.2f} energy out of {observation['capacity']:.0f}.",
               'Eating food restores energy. Moving costs 0.30 energy. Resting costs 0.12 energy and does not restore energy.']
    food=[c for c in observation['local'] if c['food']>0 and not c['blocked']]
    sentences.extend(f"You see {c['food']:.1f} units of food at {location(c['dx'],c['dy'])}." for c in food)
    if not food:sentences.append('No food is visible nearby.')
    sentences.append('All other visible cells within two steps have no food.')
    sentences.extend(f"A wall blocks {location(c['dx'],c['dy'])}." for c in observation['local'] if c['blocked'])
    if memory:
        sentences.extend(f"You remember food at {location(m['dx'],m['dy'])}, observed {m['stepsAgo']} steps ago; it may be gone." for m in observation['memory'])
    state=' '.join(sentences)
    for candidate in request['candidates']:
        if candidate['id'] not in ['north','east','south','west','eat','rest'] or not isinstance(candidate['description'],str) or not 1<=len(candidate['description'])<=300:raise ValueError('invalid candidate')
    labels={f'option_{i}':c['id'] for i,c in enumerate(request['candidates'])}
    if len(set(labels.values()))!=len(labels) or not labels:raise ValueError('invalid candidates')
    criteria={label:request['candidates'][i]['description'] for i,label in enumerate(labels)}
    questions={'action':{'type':'choice','instructions':
        'Choose the next action to obtain food and survive. Eat only when food is at your current location. Otherwise you must move to reach it. Use the creature’s observations.', 'criteria':criteria}}
    return state,questions,labels

class LayaProvider:
    def __init__(self,device='mps'):
        import torch,laya
        self.manifest=json.loads((ROOT/os.environ.get('M0_MODEL_MANIFEST','experiments/m0/model-manifest.json')).read_text())
        self.requested_device=device
        self.start=time.perf_counter()
        source=ROOT/self.manifest['local_dir']
        runtime_root=ROOT/'.models/runtime';runtime_root.mkdir(exist_ok=True)
        self._remove_dead_runtime_dirs(runtime_root)
        runtime=Path(tempfile.mkdtemp(prefix=f'laya-{os.getpid()}-',dir=runtime_root))
        # 运行副本仅含硬链接与小文件；进程退出时清理，避免 .models/runtime 无限堆积。
        atexit.register(shutil.rmtree,runtime,ignore_errors=True)
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
    @staticmethod
    def _remove_dead_runtime_dirs(root):
        """目录名含创建者进程号；SIGTERM/崩溃时 atexit 不一定运行，下次启动时回收进程已不存在的目录。"""
        for path in root.glob('laya-*'):
            parts=path.name.split('-')
            if len(parts)<3 or not parts[1].isdigit(): continue  # 旧格式或未知目录不碰
            try: os.kill(int(parts[1]),0)
            except ProcessLookupError: shutil.rmtree(path,ignore_errors=True)
            except PermissionError: pass
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
