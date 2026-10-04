"""仅 loopback 的共享生态服务。故障明确返回，不静默替换控制器。"""
from contextlib import asynccontextmanager
import threading
from fastapi import FastAPI, HTTPException
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
checkpoint_root = Path(__file__).resolve().parents[2] / '.runtime/ecology/checkpoints'

class DecisionBatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    requests: list[dict] = Field(min_length=1, max_length=64)
    memory: bool = True

@asynccontextmanager
async def lifespan(app):
    try:
        runtime['provider'] = EcologyProvider(); runtime['status'] = 'ready'
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
        if q.transaction_id in r.receipts: return {'committed':True,'receipt':r.receipts[q.transaction_id]}
        if r.staged:
            if r.staged['id']!=q.transaction_id or r.staged['requests']!=q.requests: raise ValueError('uncommitted_learning_transaction')
            return {**r.staged['response'],'records':r.staged['records']}
        for request in q.requests: encode(request)
        if not r.no_laya and 'provider' not in runtime: raise ValueError('model_unavailable')
        records=[] if r.no_laya else runtime['provider'].predict(q.requests,memory=True)
        return {**r.prepare(q.transaction_id,q.requests,records),'records':records}
    return locked_call(prepare)

@app.post('/learning/commit')
def learning_commit(q:LearningCommit):
    return locked_call(lambda:get_run(q.run_id).commit(q.transaction_id,q.result))

@app.post('/learning/abort')
def learning_abort(q:LearningControl):
    return locked_call(lambda:get_run(q.run_id).abort(q.transaction_id))

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
        if not q.world or q.world['config']['runId']!=q.run_id: raise ValueError('checkpoint_world_identity')
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
        world=state['world'];world['config']['runId']=q.run_id
        learning_runs[q.run_id]=LearningRuntime.from_state(state['learning'],run_id=q.run_id)
        return {'world':world,'run_id':q.run_id,'frozen':learning_runs[q.run_id].frozen,'no_laya':learning_runs[q.run_id].no_laya}
    return locked_call(restore)

@app.post('/learning/close')
def learning_close(q:LearningControl):
    def close():
        r=get_run(q.run_id)
        if r.staged: raise ValueError('abort_or_commit_before_close')
        del learning_runs[q.run_id];return {'closed':True}
    return locked_call(close)

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=8767)
