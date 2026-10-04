"""M0 本地推理服务。只返回提案，不持有或修改世界。"""
import json,threading,time
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI,HTTPException
from pydantic import BaseModel,ConfigDict,Field
from laya_provider import LayaProvider,encode
from bridge import ROOT
class DecisionBatch(BaseModel):
    model_config=ConfigDict(extra='forbid')
    requests:list[dict]=Field(min_length=1,max_length=48)
    memory:bool=True
runtime={'status':'loading','last_error':None};lock=threading.Lock()
@asynccontextmanager
async def lifespan(app):
    try:
        runtime['provider']=LayaProvider();runtime['status']='ready'
    except Exception as e:runtime['status']='failed';runtime['last_error']=str(e)
    yield
app=FastAPI(lifespan=lifespan)
@app.get('/health')
def health():
    result={k:v for k,v in runtime.items() if k!='provider'}
    if 'provider' in runtime:result['model']=runtime['provider'].metadata()
    return result
@app.post('/decide')
def decide(batch:DecisionBatch):
    if runtime['status']=='failed' or 'provider' not in runtime:raise HTTPException(503,'model unavailable; inspect /health')
    try:
        for request in batch.requests:encode(request,batch.memory)
    except (KeyError,TypeError,ValueError) as e:raise HTTPException(422,str(e))
    if not lock.acquire(blocking=False):raise HTTPException(503,'model busy',headers={'Retry-After':'1'})
    runtime['status']='running'
    try:
        records=runtime['provider'].predict(batch.requests,memory=batch.memory)
        runtime['last_error']=None
        return {'records':records,'mode':'real-laya'}
    except Exception as e:
        runtime['last_error']=str(e);raise HTTPException(503,'inference failed; inspect /health')
    finally:runtime['status']='ready';lock.release()
if __name__=='__main__':
    import uvicorn
    uvicorn.run(app,host='127.0.0.1',port=8765)
