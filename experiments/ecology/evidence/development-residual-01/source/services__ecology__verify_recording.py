"""不加载 Laya、不训练，逐轮核验真实实验动作重放。"""
import argparse
import json
from pathlib import Path
from bridge import Bridge
from experiment import write_json

def verify(directory):
    initial=json.loads((directory/'initial.json').read_text());count=0
    with Bridge() as bridge:
        bridge.call('reset',config=initial['config']);bridge.call('restore',snapshot=initial)
        for line in (directory/'rounds.jsonl').open():
            row=json.loads(line);requests=bridge.call('observe');recorded=row['result']
            assert len(requests)==len(recorded['proposals'])
            proposals=[]
            for actual,old,p in zip(requests,row['requests'],recorded['proposals']):
                assert actual['observation']==old['observation'];assert actual['candidates']==old['candidates'];assert actual['identity']['agentId']==old['identity']['agentId']
                proposals.append({**p,'identity':actual['identity']})
            result=bridge.call('step',proposals=proposals);assert result['accepted']
            for key in ['beforeHash','afterHash','outcomes','events','snapshot']:assert result[key]==recorded[key],(count,key)
            count+=1
    result={'verified':True,'rounds':count,'modelCalls':0,'trainingUpdates':0,'finalHash':recorded['afterHash'] if count else None}
    write_json(directory/'replay-verification.json',result);return result

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('directory');args=parser.parse_args();print(json.dumps(verify(Path(args.directory))))
