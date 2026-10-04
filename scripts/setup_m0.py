"""本机 M0 环境引导：项目内 uv 与独立 Python，不修改系统 Python。"""
import hashlib,io,json,platform,subprocess,urllib.request,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
VERSION='0.12.19'
uv=ROOT/f'.tools/bootstrap/uv-{VERSION}.data/scripts/uv'
if not uv.exists():
    if platform.system()!='Darwin' or platform.machine()!='arm64':
        raise SystemExit('自动引导仅验证过 Apple Silicon；其他平台请按官方 uv 文档建立 Python 3.12 环境。')
    meta=json.load(urllib.request.urlopen(f'https://pypi.org/pypi/uv/{VERSION}/json'))
    wheel=next(x for x in meta['urls'] if 'macosx_11_0_arm64' in x['filename'])
    data=urllib.request.urlopen(wheel['url']).read()
    if hashlib.sha256(data).hexdigest()!=wheel['digests']['sha256']:raise RuntimeError('uv wheel checksum mismatch')
    with zipfile.ZipFile(io.BytesIO(data)) as z:z.extractall(ROOT/'.tools/bootstrap')
    uv.chmod(0o755)
python=ROOT/'.venv/bin/python'
if not python.exists():subprocess.run([str(uv),'venv','--python','3.12.11','.venv'],cwd=ROOT,check=True)
subprocess.run([str(python),'-c','import sys; assert sys.version_info[:2] == (3,12), "M0 requires Python 3.12"'],check=True)
subprocess.run([str(uv),'pip','install','--python',str(python),'-r','requirements-m0.lock'],cwd=ROOT,check=True)
print('M0 environment ready. Model weights are downloaded separately.')
