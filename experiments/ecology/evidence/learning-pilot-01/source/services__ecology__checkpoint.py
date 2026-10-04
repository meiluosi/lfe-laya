"""仅数据的检查点编码；读取始终使用 torch weights_only，禁止任意对象反序列化。"""
import hashlib
import io
import os
from pathlib import Path
import numpy as np
import torch


def pack(value):
    if isinstance(value, np.ndarray):
        array=value.astype(np.int64) if value.dtype==np.uint32 else value
        return {'__array__':torch.from_numpy(array.copy()),'dtype':str(value.dtype)}
    if isinstance(value,np.generic): return value.item()
    if isinstance(value,torch.Tensor): return value.detach().cpu().clone()
    if isinstance(value,dict): return {k:pack(v) for k,v in value.items()}
    if isinstance(value,tuple): return tuple(pack(v) for v in value)
    if isinstance(value,list): return [pack(v) for v in value]
    if value is None or isinstance(value,(str,int,float,bool)): return value
    raise TypeError(f'unsupported_checkpoint_type:{type(value)}')


def unpack(value):
    if isinstance(value,dict) and set(value)=={'__array__','dtype'}:
        return value['__array__'].cpu().numpy().astype(np.dtype(value['dtype']))
    if isinstance(value,dict): return {k:unpack(v) for k,v in value.items()}
    if isinstance(value,tuple): return tuple(unpack(v) for v in value)
    if isinstance(value,list): return [unpack(v) for v in value]
    return value


def dumps(state):
    buffer=io.BytesIO();torch.save(pack(state),buffer);return buffer.getvalue()


def loads(data):
    if len(data)>256*1024*1024: raise ValueError('checkpoint_size_limit')
    return unpack(torch.load(io.BytesIO(data),map_location='cpu',weights_only=True))


def save(path,state):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    data=dumps(state);temporary=path.with_suffix(path.suffix+'.tmp')
    with temporary.open('wb') as f: f.write(data);f.flush();os.fsync(f.fileno())
    os.replace(temporary,path)
    return {'path':str(path),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
