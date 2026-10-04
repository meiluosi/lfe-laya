"""批量实验仅共享固定先验推理，个体训练结果应与逐世界运行一致。"""
import sys
import json
import copy
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'services/ecology'))
from bridge import Bridge
from experiment import run_world,run_grouped

class TestPrior:
    def predict(self,requests,memory=True):
        return [{'test_only':True,'proposal':{'identity':copy.deepcopy(r['identity']),'provider':'laya','action':'rest','distribution':{c['id']:1/len(r['candidates']) for c in r['candidates']}}} for r in requests]

def test_grouped_and_serial_have_identical_world_actions_and_parameter_updates(tmp_path):
    prior=TestPrior();serial=[];jobs=[]
    with Bridge() as bridge:
        for seed in [41,42,43]:
            config={'runId':f'grouped-test-{seed}','seed':seed,'initialAgents':2,'reproduction':False,'horizon':60,'phaseTicks':20}
            report,state=run_world(bridge,prior,config,'learning',tmp_path/f'serial-{seed}',{'n_steps':2,'batch_size':2})
            serial.append(state)
            jobs.append(dict(config=config,mode='learning',output=tmp_path/f'grouped-{seed}',learning_config={'n_steps':2,'batch_size':2}))
        grouped=run_grouped(bridge,prior,jobs)
    for expected,(_,actual) in zip(serial,grouped):
        assert expected['world']==actual['world']
        assert {k:p['revision'] for k,p in expected['learning']['policies'].items()}=={k:p['revision'] for k,p in actual['learning']['policies'].items()}
        for key,p in expected['learning']['policies'].items():
            for name,v in p['parameters'].items():assert (v==actual['learning']['policies'][key]['parameters'][name]).all()
