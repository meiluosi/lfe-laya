#!/usr/bin/env bash
# G8 S1 校准运行器（可重入）：12 个候选参数，协议见 docs/G8_CALIBRATION.md。用法：bash scripts/run-g8-calib.sh [并发数，默认 4]
set -u
cd "$(dirname "$0")/.."
CONC="${1:-4}"; mkdir -p experiments/evo/g8-calib
for S in 14 20 28; do for T in 32 26; do for I in 8 16; do
  f="experiments/evo/g8-calib/S${S}-T${T}-I${I}.json"
  [ -f "$f" ] && { echo "skip $f"; continue; }
  node packages/evo/ecology-calibrate.ts "$f" --supply $S --threshold $T --init $I --worlds 10 > "experiments/evo/g8-calib/S${S}-T${T}-I${I}.log" 2>&1 &
  while [ "$(jobs -rp | wc -l)" -ge "$CONC" ]; do sleep 5; done
done; done; done
wait; echo "全部完成 $(date '+%F %T')"
