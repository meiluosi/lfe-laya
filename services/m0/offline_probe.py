"""在进程内拒绝所有外连；验证本地权重及 tokenizer 缓存可独立推理。"""
import socket,json,os,time
started=time.perf_counter()
from bridge import ROOT,Bridge
os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1';os.environ['USE_TF']='0'
blocked=[]
def denied(self,address):
    blocked.append(str(address));raise RuntimeError('network forbidden by offline probe')
socket.socket.connect=denied;socket.socket.connect_ex=denied
from laya_provider import LayaProvider
provider=LayaProvider()
with Bridge() as bridge:
    r=bridge.call('reset',config={'seed':91,'runId':'offline'})
    decision=provider.predict([r])[0];result=bridge.call('step',proposal=decision['proposal'])
    assert result['accepted']
    (ROOT/'experiments/m0/evidence/offline-probe.json').write_text(json.dumps({'network_policy':'Python socket.connect/connect_ex denied; HF offline flags set; OS network not toggled','blocked_attempts':blocked,'cold_process_to_first_execution_seconds':time.perf_counter()-started,'model':provider.metadata(),'decision':decision,'transition':result},indent=2))
    print('Offline inference and execution passed',flush=True)
