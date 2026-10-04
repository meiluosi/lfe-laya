"""Python 仅驱动同一个 TS 世界；不包含第二份环境规则。"""
import json
import subprocess
import time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
class Bridge:
    def __init__(self):
        self.process=subprocess.Popen(['node','packages/sim/bridge.ts'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,bufsize=1)
        self.calls=0;self.elapsed=0.
        self.call('ping')
    def call(self,op,id='world',**kwargs):
        start=time.perf_counter()
        self.process.stdin.write(json.dumps({'op':op,'id':id,**kwargs},allow_nan=False)+'\n');self.process.stdin.flush()
        line=self.process.stdout.readline()
        if not line: raise RuntimeError(f'bridge exited: {self.process.poll()}')
        result=json.loads(line);self.calls+=1;self.elapsed+=time.perf_counter()-start
        if not result['ok']:raise RuntimeError(result['error'])
        return result['result']
    def close(self):
        if self.process.poll() is None:
            self.process.stdin.close()
            try:self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:self.process.terminate();self.process.wait(timeout=5)
        self.process.stdout.close()
    def __enter__(self):return self
    def __exit__(self,*args):self.close()
