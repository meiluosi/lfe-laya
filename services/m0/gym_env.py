"""Gymnasium 适配同一 TS 单体世界。全局快照仅供评估器，不进入策略特征。"""
import copy
import gymnasium as gym
import numpy as np
from bridge import Bridge
ACTIONS=('north','east','south','west','eat','rest')
OBS_SIZE=66

def features(request,prior=None,memory=True):
    o=request['observation'];cells=o['local']
    if len(cells)!=13:raise ValueError('m0 encoder requires Manhattan perception=2')
    result=[o['energy']/o['capacity'],min(o['age']/360,1)]
    for cell in cells:result.extend([min(cell['food']/20,1),float(cell['blocked'])])
    memories=o['memory'] if memory else []
    if len(memories)>8:raise ValueError('memory over budget')
    for item in memories:result.extend([item['dx']/7,item['dy']/7,min(item['food']/20,1),min(item['stepsAgo']/60,1)])
    result.extend([0.]*(4*(8-len(memories))))
    result.extend([float((prior or {}).get(a,0)) for a in ACTIONS])
    data=np.asarray(result,dtype=np.float32)
    if data.shape!=(OBS_SIZE,) or not np.isfinite(data).all():raise ValueError('invalid feature vector')
    return data

def mask(request):return np.asarray([a in {c['id'] for c in request['candidates']} for a in ACTIONS],dtype=bool)

class ForagingEnv(gym.Env):
    metadata={'render_modes':[]}
    def __init__(self,config=None,provider=None):
        super().__init__();self.bridge=Bridge();self.config=config or {};self.provider=provider
        self.observation_space=gym.spaces.Box(-1,1,(OBS_SIZE,),np.float32)
        self.action_space=gym.spaces.Discrete(len(ACTIONS));self.request=None;self.record=None;self.obs=None
    def reset(self,*,seed=None,options=None):
        super().reset(seed=seed)
        chosen=int(seed) if seed is not None else int(self.np_random.integers(1,2**31))
        self.request=self.bridge.call('reset',config={**self.config,'runId':'gym','seed':chosen})
        return self._observe(),{}
    def _observe(self):
        self.record=self.provider.predict([self.request])[0] if self.provider else None
        prior=self.record['proposal']['distribution'] if self.record else None
        self.obs=features(self.request,prior);return self.obs.copy()
    def action_masks(self):return mask(self.request)
    def step(self,action):
        chosen=ACTIONS[int(action)]
        transition=self.bridge.call('step',proposal={'identity':self.request['identity'],'action':chosen,'provider':'gym-policy'})
        if not transition['accepted']:
            # Gym 检查器可能忽略掩码；拒绝时不推进世界、不记录训练经历、不改选动作。
            return self.obs.copy(),0.0,False,False,{'rejected':transition['reason'],'executed':False}
        done=transition['terminated'] or transition['truncated']
        if not done:
            self.request=self.bridge.call('observe');obs=self._observe()
        else:
            self.request=self.bridge.call('inspect')
            obs=self._observe() if transition['truncated'] else features(self.request)
        return obs,float(transition['reward']),transition['terminated'],transition['truncated'],{'executed':True,'transition':transition}
    def close(self):self.bridge.close()
