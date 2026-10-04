"""下载一个固定 revision，并记录来源、大小与 SHA-256，不加载模型。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
from datetime import datetime, timezone
from huggingface_hub import HfApi, snapshot_download

ROOT = Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--repo',default='convaiinnovations/laya-multilingual');parser.add_argument('--revision');args=parser.parse_args()
REPO = args.repo
info = HfApi().model_info(REPO, revision=args.revision, files_metadata=True)
revision = info.sha
folder = ROOT / '.models' / REPO.split('/')[-1] / revision
folder.mkdir(parents=True, exist_ok=True)
patterns = ['rl_agent_config.json','model.safetensors','tokenizer/*','encoder/*','README.md','LICENSE*']
print(json.dumps({'event':'download_start','repo':REPO,'revision':revision,'folder':str(folder)}),flush=True)
snapshot_download(REPO, revision=revision, local_dir=folder, allow_patterns=patterns, max_workers=3)
files={}
for path in sorted(folder.rglob('*')):
    if not path.is_file() or '.cache' in path.parts: continue
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    files[str(path.relative_to(folder))]={'bytes':path.stat().st_size,'sha256':h.hexdigest()}
manifest={'repo':REPO,'revision':revision,'local_dir':str(folder.relative_to(ROOT)),
          'downloaded_at':datetime.now(timezone.utc).isoformat(),'license':(info.card_data.to_dict() if info.card_data else {}).get('license'),
          'files':files,'total_bytes':sum(f['bytes'] for f in files.values())}
out=ROOT/'experiments/m0/model-manifests'/f"{REPO.split('/')[-1]}.json";out.parent.mkdir(exist_ok=True);out.write_text(json.dumps(manifest,indent=2))
print(json.dumps({'event':'download_complete','total_bytes':manifest['total_bytes'],'files':len(files)}),flush=True)
