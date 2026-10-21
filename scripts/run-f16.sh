#!/usr/bin/env bash
# 预注册 16 训练批次的运行器（可重入）：64 次独立进化，先验 {laya,none} × 学习器 {plain,lag} × 制度 {j60,k60} × 种子 111–118，
# 参数与 docs/PREREGISTRATION_16.md §2 的冻结命令模板逐项一致。
# 用法：bash scripts/run-f16.sh [并发数，默认 6]
set -u
cd "$(dirname "$0")/.."
CONC="${1:-6}"
LOG=experiments/evo/logs-f16
mkdir -p "$LOG"

run_one() {
  local prior="$1" learner="$2" reg="$3" seed="$4" dir="experiments/evo/f16-$1-$2-$3-$4" mode
  if [ "$reg" = j60 ]; then mode=jitter; else mode=kind; fi
  if [ -f "$dir/final.json" ]; then echo "skip  $dir（已完成）"; return 0; fi
  if [ -d "$dir" ]; then echo "abort $dir（目录已存在但无 final.json，拒绝覆盖）" >&2; return 1; fi
  echo "start $dir $(date '+%F %T')"
  node packages/evo/semantic-evolve.ts "$dir" \
    --prior "$prior" --learning on --agent structured --learner "$learner" --pool on --K 32 --harmCap 4 \
    --delay 60 --delaySpread 30 --delayMode "$mode" --delayAll on --inversions 0.25,0.4 --worldSeeds vary --worlds 6 --generations 40 \
    --pop 24 --sigma 0.25 --lr 0.1 --seed "$seed" --workers 1 \
    > "$LOG/f16-$prior-$learner-$reg-$seed.log" 2>&1
  local rc=$?
  echo "done  $dir $(date '+%F %T') rc=$rc"
  return $rc
}

todo=()
for p in laya none; do for l in plain lag; do for r in j60 k60; do for s in 111 112 113 114 115 116 117 118; do
  [ -f "experiments/evo/f16-$p-$l-$r-$s/final.json" ] || todo+=("$p:$l:$r:$s")
done; done; done; done
echo "待运行 ${#todo[@]} 个，并发 $CONC"
for t in "${todo[@]}"; do
  IFS=: read -r p l r s <<< "$t"
  run_one "$p" "$l" "$r" "$s" &
  while [ "$(jobs -rp | wc -l)" -ge "$CONC" ]; do sleep 5; done
done
wait
echo "全部完成 $(date '+%F %T')"
