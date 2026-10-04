"""本次授权实验的顺序执行器；依赖失败即停止，不忽略或替换结果。"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--after-pid',type=int,required=True)
    parser.add_argument('--after-stage',choices=['development','heldout'],default='development');args=parser.parse_args()
    predecessor='development-features-01' if args.after_stage=='development' else 'heldout-01'
    completion=Path('experiments/ecology/evidence')/predecessor/'completion.json'
    while not completion.exists():
        try:os.kill(args.after_pid,0)
        except ProcessLookupError:raise RuntimeError(f'{predecessor}_stopped_without_completion')
        time.sleep(10)
    if json.loads(completion.read_text())['runs']!=(18 if args.after_stage=='development' else 27):raise RuntimeError('incomplete_predecessor_matrix')
    jobs=[('development-residual.json','development-residual-01'),('heldout-01.json','heldout-01')] if args.after_stage=='development' else [('reproduction-laya-01.json','reproduction-laya-01')]
    for config,output in jobs:
        log=Path('experiments/ecology/evidence')/f'{output}.log'
        if log.exists():raise RuntimeError(f'previous_attempt_preserved:{log}')
        print(json.dumps({'starting':output}),flush=True)
        with log.open('w') as stream:
            runner='experiment.py' if args.after_stage=='heldout' else 'grouped_experiment.py'
            subprocess.run([sys.executable,'-u',f'services/ecology/{runner}',f'experiments/ecology/config/{config}',f'experiments/ecology/evidence/{output}'],stdout=stream,stderr=subprocess.STDOUT,check=True)
        print(json.dumps({'completed':output}),flush=True)

if __name__=='__main__':main()
