"""无界面实验驱动相同 TS 生态模块；Python 不拥有世界规则。"""
import json
from pathlib import Path
import subprocess
import selectors

ROOT = Path(__file__).resolve().parents[2]

class Bridge:
    def __init__(self):
        self.process = subprocess.Popen(['node', 'packages/sim/ecology-bridge.ts'], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.process.stdout, selectors.EVENT_READ)
        self.call('ping')

    def call(self, op, id='world', **kwargs):
        self.process.stdin.write(json.dumps({'op': op, 'id': id, **kwargs}, allow_nan=False) + '\n')
        self.process.stdin.flush()
        if not self.selector.select(timeout=60): raise TimeoutError('ecology_bridge_timeout')
        line = self.process.stdout.readline()
        if not line: raise RuntimeError(f'ecology_bridge_exited:{self.process.poll()}')
        result = json.loads(line)
        if not result['ok']: raise RuntimeError(result['error'])
        return result['result']

    def close(self):
        if self.process.poll() is None:
            self.process.stdin.close()
            try: self.process.wait(timeout=5)
            except subprocess.TimeoutExpired: self.process.terminate(); self.process.wait(timeout=5)
        self.selector.close(); self.process.stdout.close()

    def __enter__(self): return self
    def __exit__(self, *args): self.close()
