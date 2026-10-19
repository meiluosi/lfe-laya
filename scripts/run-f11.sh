#!/usr/bin/env bash
# 预注册 11 训练批次的运行器（可重入）：24 次独立进化，先验 {laya,none,vader} × 种子 61–68，
# 参数与 docs/PREREGISTRATION_11.md §2 的冻结命令模板逐项一致（与预注册 10 的唯一差别是 K=4）。
# 用法：bash scripts/run-f11.sh [并发数，默认 6]
set -u
cd "$(dirname "$0")/.."
CONC="${1:-6}"
LOG=experiments/evo/logs-f11
mkdir -p "$LOG"

run_one() {
  local prior="$1" seed="$2" dir="experiments/evo/f11-$1-$2"
  if [ -f "$dir/final.json" ]; then echo "skip  $dir（已完成）"; return 0; fi
  if [ -d "$dir" ]; then echo "abort $dir（目录已存在但无 final.json，拒绝覆盖）" >&2; return 1; fi
  echo "start $dir $(date '+%F %T')"
  node packages/evo/semantic-evolve.ts "$dir" \
    --prior "$prior" --learning on --agent structured --pool on --K 4 --harmCap 4 \
    --ripening on --cues language --seasonTicks 300 --ripeLimit 3000 --inversions 0.25,0.4 \
    --worlds 6 --generations 40 --pop 24 --sigma 0.25 --lr 0.1 --seed "$seed" --workers 1 \
    > "$LOG/f11-$prior-$seed.log" 2>&1
  local rc=$?
  echo "done  $dir $(date '+%F %T') rc=$rc"
  return $rc
}

todo=()
for p in laya none vader; do
  for s in 61 62 63 64 65 66 67 68; do
    [ -f "experiments/evo/f11-$p-$s/final.json" ] || todo+=("$p:$s")
  done
done
echo "待跑 ${#todo[@]} 个 run，并发 $CONC"
i=0
while [ "$i" -lt "${#todo[@]}" ]; do
  batch=("${todo[@]:$i:$CONC}")
  pids=()
  for item in "${batch[@]}"; do run_one "${item%%:*}" "${item##*:}" & pids+=($!); done
  for pid in "${pids[@]}"; do wait "$pid"; done
  i=$((i + CONC))
done
echo "批次结束 $(date '+%F %T')；已完成 $(ls experiments/evo/f11-*/final.json 2>/dev/null | wc -l | tr -d ' ')/24"
