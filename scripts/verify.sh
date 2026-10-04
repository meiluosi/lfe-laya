#!/usr/bin/env bash
# 一键验证：类型检查、Node 测试、Python 测试（逐文件，避免 m0 与 ecology 同名模块互相覆盖）、构建。
# 不需要网络与模型下载；不会启动长实验。加 --ui 额外运行浏览器冒烟（需要本机 Chromium 内核浏览器）。
set -euo pipefail
cd "$(dirname "$0")/.."
PY=${PY:-.venv/bin/python}
step() { printf '\n== %s ==\n' "$1"; }

step 'tsc';        npx tsc -b
step 'node tests'; node --test tests/*.test.mjs
step 'python tests'
for f in tests/test_*.py; do
  printf '%s: ' "$f"
  out=$("$PY" -m pytest -q "$f" 2>&1) && echo "$(echo "$out" | tail -1)" || { echo "$out" | tail -20; exit 1; }
done
step 'build';      npx vite build >/dev/null && echo ok
if [ "${1:-}" = '--ui' ]; then step 'browser smoke'; node scripts/smoke_ui.mjs; node scripts/smoke_studio.mjs; fi
echo; echo 'verify: all steps passed'
