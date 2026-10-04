"""服务进程内的可变状态集中在这里，而不是散落为模块全局变量。
单机本地部署：一个进程、一个模型实例、一把推理锁。排队等待有上限，超时才返回 503。"""
import threading
import time
from collections import defaultdict, deque


class ServiceState:
    MAX_RUNS = 8
    MAX_CANCELLED = 16000

    def __init__(self, lock_wait_seconds=30.0):
        self.runtime = {'status': 'loading', 'last_error': None}
        self.runs = {}
        self.worlds = {}
        self.cancelled = set()
        self.cancel_lock = threading.Lock()
        self.lock = threading.Lock()
        self.lock_wait_seconds = lock_wait_seconds
        self.started_at = time.time()
        self.metrics_lock = threading.Lock()
        self.counts = defaultdict(int)
        self.durations = defaultdict(lambda: deque(maxlen=200))

    def reset(self):
        """测试用：清空学习运行状态，不动模型与锁。"""
        self.runs.clear(); self.worlds.clear()
        with self.cancel_lock: self.cancelled.clear()
        with self.metrics_lock: self.counts.clear(); self.durations.clear()

    def record(self, endpoint, status, seconds):
        with self.metrics_lock:
            self.counts[f'{endpoint} {status}'] += 1
            self.durations[endpoint].append(seconds)

    def metrics(self):
        with self.metrics_lock:
            out = {}
            for endpoint, values in self.durations.items():
                ordered = sorted(values)
                out[endpoint] = {'n': len(ordered), 'p50_ms': round(ordered[len(ordered) // 2] * 1000, 1), 'max_ms': round(ordered[-1] * 1000, 1)}
            return {'uptime_seconds': round(time.time() - self.started_at), 'requests': dict(self.counts), 'latency': out}
