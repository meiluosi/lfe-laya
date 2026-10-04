#!/usr/bin/env python3
"""发布前准备：把超过阈值的原始大文件（轨迹、检查点）排除出 git，并保留其大小与 SHA-256 清单，便于本地核对完整性。
幂等：重复运行只会刷新 .gitignore 里的标记区块和 experiments/RAW_DATA_MANIFEST.json。
用法：python3 scripts/prepare_publish.py [--threshold-mb 5]"""
import argparse, hashlib, json, os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP = {'node_modules', '.venv', '.git', '.models', '.tools', '.runtime', 'dist', '__pycache__', '.pytest_cache'}
parser = argparse.ArgumentParser(); parser.add_argument('--threshold-mb', type=float, default=5); args = parser.parse_args()
limit = args.threshold_mb * 1024 * 1024
big = []
for dirpath, dirnames, files in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in SKIP]
    for f in files:
        p = Path(dirpath) / f
        if p.is_symlink() or p.stat().st_size <= limit: continue
        big.append(p)
big.sort()
def sha(p):
    h = hashlib.sha256()
    with p.open('rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''): h.update(chunk)
    return h.hexdigest()
manifest = {'note': f'这些文件超过 {args.threshold_mb:g} MB，未纳入 git。记录大小与 SHA-256，可在持有原始数据的机器上用 scripts/prepare_publish.py 重新生成并比对。', 'files': [{'path': str(p.relative_to(ROOT)), 'bytes': p.stat().st_size, 'sha256': sha(p)} for p in big]}
(ROOT / 'experiments').mkdir(exist_ok=True)
(ROOT / 'experiments/RAW_DATA_MANIFEST.json').write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + '\n')
START, END = '# >>> prepare_publish: 超过阈值的原始大文件 >>>', '# <<< prepare_publish <<<'
gi = ROOT / '.gitignore'; text = gi.read_text() if gi.exists() else ''
if START in text: text = text[:text.index(START)].rstrip('\n') + '\n' + (text[text.index(END) + len(END):].lstrip('\n') if END in text else '')
block = START + '\n' + '\n'.join('/' + str(p.relative_to(ROOT)) for p in big) + '\n' + END + '\n'
gi.write_text(text.rstrip('\n') + '\n\n' + block)
print(f'{len(big)} 个文件超过 {args.threshold_mb:g} MB，合计 {sum(p.stat().st_size for p in big) / 1048576:.0f} MB；清单已写入 experiments/RAW_DATA_MANIFEST.json')
