"""本次授权实验的顺序执行器；依赖失败即停止，不忽略或替换结果。"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--after-pid',type=int,required=True);args=parser.parse_args()
    completion=Path('experiments/ecology/evidence/development-features-01/completion.json')
    while not completion.exists():
        try:os.kill(args.after_pid,0)
        except ProcessLookupError:raise RuntimeError('development_features_stopped_without_completion')
        time.sleep(10)
    if json.loads(completion.read_text())['runs']!=18:raise RuntimeError('incomplete_development_matrix')
    for config,output in [('development-residual.json','development-residual-01'),('heldout-01.json','heldout-01')]:
        log=Path('experiments/ecology/evidence')/f'{output}.log'
        if log.exists():raise RuntimeError(f'previous_attempt_preserved:{log}')
        print(json.dumps({'starting':output}),flush=True)
        with log.open('w') as stream:
            subprocess.run([sys.executable,'-u','services/ecology/grouped_experiment.py',f'experiments/ecology/config/{config}',f'experiments/ecology/evidence/{output}'],stdout=stream,stderr=subprocess.STDOUT,check=True)
        print(json.dumps({'completed':output}),flush=True)

if __name__=='__main__':main()
