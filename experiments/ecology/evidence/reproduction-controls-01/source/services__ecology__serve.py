"""仅 loopback 的共享生态服务。故障明确返回，不静默替换控制器。"""
from contextlib import asynccontextmanager
import copy
from bridge import Bridge
import threading
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from provider import EcologyProvider, encode
from runtime import LearningRuntime
import checkpoint
from pathlib import Path
import hashlib
import re
from typing import Literal

runtime = {'status': 'loading', 'last_error': None}
lock = threading.Lock()
learning_runs = {}
learning_worlds = {}
cancelled = set()
cancel_lock = threading.Lock()
checkpoint_root = Path(__file__).resolve().parents[2] / '.runtime/ecology/checkpoints'

class DecisionBatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    requests: list[dict] = Field(min_length=1, max_length=64)
    memory: bool = True

@asynccontextmanager
async def lifespan(app):
    try:
        if runtime.get('without_laya'): runtime['status']='no-laya-only'
        else: runtime['provider'] = EcologyProvider(); runtime['status'] = 'ready'
    except Exception as error:
        runtime['status'] = 'failed'; runtime['last_error'] = str(error)
    yield

app = FastAPI(lifespan=lifespan)

@app.get('/health')
def health():
    return {**{k: v for k, v in runtime.items() if k != 'provider'}, 'model': runtime['provider'].metadata() if 'provider' in runtime else None}

@app.post('/decide')
def decide(batch: DecisionBatch):
    if 'provider' not in runtime: raise HTTPException(503, 'model_unavailable')
    try:
        for request in batch.requests: encode(request, batch.memory)
    except (ValueError, KeyError, TypeError) as error: raise HTTPException(422, str(error))
    if not lock.acquire(blocking=False): raise HTTPException(503, 'model_busy', headers={'Retry-After': '1'})
    runtime['status'] = 'running'
    try:
        records = runtime['provider'].predict(batch.requests, memory=batch.memory)
        runtime['last_error'] = None
        return {'records': records, 'mode': 'real-laya'}
    except Exception as error:
        runtime['last_error'] = str(error)
        raise HTTPException(503, str(error))
    finally:
        runtime['status'] = 'ready'; lock.release()

class LearningCreate(BaseModel):
    model_config=ConfigDict(extra='forbid')
    run_id:str=Field(min_length=1,max_length=120)
    seed:int=Field(ge=1,le=0xffffffff)
    mode:Literal['learning','no-laya','frozen']='learning'
    fusion:Literal['features','residual']='features'

class LearningPrepare(BaseModel):
    model_config=ConfigDict(extra='forbid')
    run_id:str=Field(min_length=1,max_length=120)
    transaction_id:str=Field(min_length=1,max_length=256)
    requests:list[dict]=Field(min_length=1,max_length=64)
    world:dict
    frozen:bool=False

class LearningCommit(BaseModel):
    model_config=ConfigDict(extra='forbid')
    run_id:str=Field(min_length=1,max_length=120)
    transaction_id:str=Field(min_length=1,max_length=256)
    result:dict

class LearningControl(BaseModel):
    model_config=ConfigDict(extra='forbid')
    run_id:str=Field(min_length=1,max_length=120)
    transaction_id:str|None=None
    frozen:bool|None=None
    world:dict|None=None
    checkpoint_id:str|None=None

def get_run(run_id):
    if run_id not in learning_runs: raise ValueError('unknown_learning_run')
    return learning_runs[run_id]

def locked_call(callback):
    if not lock.acquire(blocking=False): raise HTTPException(503,'service_busy',headers={'Retry-After':'1'})
    try: return callback()
    except (KeyError,TypeError,ValueError) as error: raise HTTPException(422,str(error))
    except Exception as error:
        runtime['last_error']=str(error);raise HTTPException(503,str(error))
    finally: lock.release()

def validate_boundary(run_id,world,requests=None):
    if not world or world['config']['runId']!=run_id: raise ValueError('world_identity')
    previous=learning_worlds.get(run_id)
    if previous:
        # 用户可以在动作边界干预资源或障碍；个体/模拟时间不能越过学习反馈。
        if previous['tick']!=world['tick'] or previous['agents']!=world['agents']: raise ValueError('learning_world_out_of_sync')
    with Bridge() as validator:
        validator.call('reset',config=world['config']);validator.call('restore',snapshot=world)
        if requests is not None:
            observed=validator.call('observe')
            if len(observed)!=len(requests): raise ValueError('world_observation_mismatch')
            for expected,actual in zip(observed,requests):
                for key in ('generation','attemptId'): expected['identity'][key]=actual['identity'][key]
            if observed!=requests: raise ValueError('world_observation_mismatch')

@app.post('/learning/create')
def learning_create(q:LearningCreate):
    def create():
        if q.run_id in learning_runs:
            r=learning_runs[q.run_id]
            if r.seed!=q.seed or r.no_laya!=(q.mode=='no-laya') or r.config!={'fusion':q.fusion}: raise ValueError('existing_learning_run_mismatch')
            return {'created':False,'run_id':r.run_id}
        if len(learning_runs)>=8: raise ValueError('learning_run_capacity_export_and_close_required')
        learning_runs[q.run_id]=LearningRuntime(q.run_id,q.seed,{'fusion':q.fusion},q.mode=='frozen',q.mode=='no-laya')
        return {'created':True,'run_id':q.run_id}
    return locked_call(create)

@app.post('/learning/prepare')
def learning_prepare(q:LearningPrepare):
    def prepare():
        r=get_run(q.run_id)
        with cancel_lock:
            if (q.run_id,q.transaction_id) in cancelled: raise ValueError('cancelled_transaction')
        if q.transaction_id in r.receipts: return {'committed':True,'receipt':r.receipts[q.transaction_id]}
        if r.staged:
            if r.staged['id']!=q.transaction_id or r.staged['requests']!=q.requests: raise ValueError('uncommitted_learning_transaction')
            return {**r.staged['response'],'records':r.staged['records']}
        validate_boundary(q.run_id,q.world,requests=q.requests)
        r.set_frozen(q.frozen)
        for request in q.requests: encode(request)
        if not r.no_laya and 'provider' not in runtime: raise ValueError('model_unavailable')
        records=[] if r.no_laya else runtime['provider'].predict(q.requests,memory=True)
        with cancel_lock:
            if (q.run_id,q.transaction_id) in cancelled: raise ValueError('cancelled_transaction')
        learning_worlds[q.run_id]=copy.deepcopy(q.world)
        return {**r.prepare(q.transaction_id,q.requests,records),'records':records}
    return locked_call(prepare)

@app.post('/learning/commit')
def learning_commit(q:LearningCommit):
    def commit():
        r=get_run(q.run_id);bootstrap=None
        if q.transaction_id not in r.receipts and not r.frozen and any(o['truncated'] for o in q.result['outcomes']):
            if not r.staged or r.staged['id']!=q.transaction_id: raise ValueError('unknown_transaction')
            with Bridge() as validator:
                validator.call('reset',config=q.result['snapshot']['config'])
                validator.call('restore',snapshot=q.result['snapshot'])
                requests=validator.call('inspect')
            if not r.no_laya and 'provider' not in runtime: raise ValueError('model_unavailable')
            records=[] if r.no_laya else runtime['provider'].predict(requests,memory=True)
            bootstrap={'requests':requests,'records':records}
        duplicate=q.transaction_id in r.receipts
        receipt=r.commit(q.transaction_id,q.result,bootstrap)
        # 旧事务的迟到重试只返回旧回执，不能把已推进的世界边界写回过去。
        if not duplicate: learning_worlds[q.run_id]=copy.deepcopy(q.result['snapshot'])
        return receipt
    return locked_call(commit)

@app.post('/learning/abort')
def learning_abort(q:LearningControl):
    if not q.transaction_id: raise HTTPException(422,'transaction_id_required')
    with cancel_lock:
        if len(cancelled)>=16000: raise HTTPException(422,'cancellation_capacity_close_old_runs')
        cancelled.add((q.run_id,q.transaction_id))
    # 先留下墓碑，使正在推理的请求不能暂存；随后确认旧暂存已撤销。
    with lock:
        try: return get_run(q.run_id).abort(q.transaction_id) if q.run_id in learning_runs else {'aborted':True,'duplicate':True}
        except ValueError as error: raise HTTPException(422,str(error))

@app.post('/learning/freeze')
def learning_freeze(q:LearningControl):
    def freeze():
        if q.frozen is None: raise ValueError('frozen_required')
        r=get_run(q.run_id);r.set_frozen(q.frozen);return {'frozen':r.frozen}
    return locked_call(freeze)

@app.post('/learning/checkpoint')
def learning_checkpoint(q:LearningControl):
    def store():
        r=get_run(q.run_id)
        validate_boundary(q.run_id,q.world)
        learning_worlds[q.run_id]=copy.deepcopy(q.world)
        state={'format':'ecology-complete-learning-v1','world':q.world,'learning':r.export(),'model':runtime['provider'].metadata() if 'provider' in runtime else None}
        data=checkpoint.dumps(state);digest=hashlib.sha256(data).hexdigest();checkpoint_root.mkdir(parents=True,exist_ok=True)
        if sum(p.stat().st_size for p in checkpoint_root.glob('*.pt'))+len(data)>2*1024**3: raise ValueError('checkpoint_disk_capacity')
        path=checkpoint_root/f'{digest}.pt'
        if not path.exists():
            temporary=path.with_suffix('.tmp');temporary.write_bytes(data);temporary.replace(path)
        return {'checkpoint_id':digest,'bytes':len(data),'format':state['format']}
    return locked_call(store)

@app.post('/learning/restore')
def learning_restore(q:LearningControl):
    def restore():
        if not q.checkpoint_id or not re.fullmatch('[a-f0-9]{64}',q.checkpoint_id): raise ValueError('invalid_checkpoint_id')
        if q.run_id in learning_runs or len(learning_runs)>=8: raise ValueError('new_learning_run_required')
        data=(checkpoint_root/f'{q.checkpoint_id}.pt').read_bytes()
        if hashlib.sha256(data).hexdigest()!=q.checkpoint_id: raise ValueError('checkpoint_integrity')
        state=checkpoint.loads(data)
        if state['format']!='ecology-complete-learning-v1': raise ValueError('checkpoint_format')
        validate_checkpoint(state)
        if not state['learning']['no_laya']:
            if 'provider' not in runtime: raise ValueError('checkpoint_requires_laya')
            actual=runtime['provider'].metadata()
            if any(actual.get(k)!=state['model'].get(k) for k in ('repo','revision','template','tokenizer_runtime_sha256')): raise ValueError('checkpoint_model_mismatch')
        world=state['world'];world['config']['runId']=q.run_id
        learning_runs[q.run_id]=LearningRuntime.from_state(state['learning'],run_id=q.run_id)
        learning_worlds[q.run_id]=copy.deepcopy(world)
        return {'world':world,'run_id':q.run_id,'frozen':learning_runs[q.run_id].frozen,'no_laya':learning_runs[q.run_id].no_laya}
    return locked_call(restore)

@app.post('/learning/close')
def learning_close(q:LearningControl):
    def close():
        r=get_run(q.run_id)
        if r.staged: raise ValueError('abort_or_commit_before_close')
        del learning_runs[q.run_id];learning_worlds.pop(q.run_id,None)
        with cancel_lock: cancelled.difference_update({key for key in cancelled if key[0]==q.run_id})
        return {'closed':True}
    return locked_call(close)

def validate_checkpoint(state):
    if state['format']!='ecology-complete-learning-v1' or state['learning']['version']!=LearningRuntime.VERSION: raise ValueError('checkpoint_version')
    r=state['learning'];world=state['world']
    if world['config']['runId']!=r['run_id'] or len(r['policies'])>64 or len(r['retired'])>512: raise ValueError('checkpoint_identity_or_budget')
    alive={a['id']:a for a in world['agents']}
    if not set(r['policies'])<=set(alive) or any(a['born']<=r['last_tick'] for key,a in alive.items() if key not in r['policies']): raise ValueError('checkpoint_policy_population')
    with Bridge() as validator:
        validator.call('reset',config=world['config']);validator.call('restore',snapshot=world)

@app.get('/learning/checkpoint/{checkpoint_id}')
def download_checkpoint(checkpoint_id:str):
    if not re.fullmatch('[a-f0-9]{64}',checkpoint_id): raise HTTPException(422,'invalid_checkpoint_id')
    path=checkpoint_root/f'{checkpoint_id}.pt'
    if not path.is_file(): raise HTTPException(404,'checkpoint_not_found')
    return FileResponse(path,filename=f'lfe-learning-{checkpoint_id[:12]}.pt',media_type='application/octet-stream')

@app.post('/learning/import')
async def import_checkpoint(request:Request):
    data=bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data)>256*1024**2: raise HTTPException(413,'checkpoint_size_limit')
    def store():
        state=checkpoint.loads(bytes(data));validate_checkpoint(state)
        digest=hashlib.sha256(data).hexdigest();checkpoint_root.mkdir(parents=True,exist_ok=True)
        if sum(p.stat().st_size for p in checkpoint_root.glob('*.pt'))+len(data)>2*1024**3: raise ValueError('checkpoint_disk_capacity')
        path=checkpoint_root/f'{digest}.pt'
        if not path.exists():
            temporary=path.with_suffix('.tmp');temporary.write_bytes(data);temporary.replace(path)
        return {'checkpoint_id':digest,'bytes':len(data),'format':state['format']}
    return locked_call(store)

if __name__ == '__main__':
    import uvicorn
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--without-laya',action='store_true');args=parser.parse_args()
    runtime['without_laya']=args.without_laya
    uvicorn.run(app, host='127.0.0.1', port=8767)
