#!/usr/bin/env bash
# 预注册 10 剩余批次的运行器（可重入）：跳过已有 final.json 的 run，其余按 3 路并行执行。
# 参数与 docs/PREREGISTRATION_10.md §2 的冻结命令模板逐项一致。
# 用法：bash scripts/run-f10-rest.sh [并发数]
set -u
cd "$(dirname "$0")/.."
CONC="${1:-3}"
LOG=experiments/evo/logs-f10
mkdir -p "$LOG"

run_one() {
  local prior="$1" seed="$2" dir="experiments/evo/f10-$1-$2"
  if [ -f "$dir/final.json" ]; then echo "skip  $dir（已完成）"; return 0; fi
  if [ -d "$dir" ]; then echo "abort $dir（目录已存在但无 final.json，拒绝覆盖）" >&2; return 1; fi
  echo "start $dir $(date '+%F %T')"
  node packages/evo/semantic-evolve.ts "$dir" \
    --prior "$prior" --learning on --agent structured --pool on --K 16 --harmCap 4 \
    --ripening on --cues language --seasonTicks 300 --ripeLimit 3000 --inversions 0.25,0.4 \
    --worlds 6 --generations 40 --pop 24 --sigma 0.25 --lr 0.1 --seed "$seed" --workers 1 \
    > "$LOG/f10-$prior-$seed.log" 2>&1
  local rc=$?
  echo "done  $dir $(date '+%F %T') rc=$rc"
  return $rc
}

# 先算出还需要跑的 run，再按并发数分批
todo=()
for p in laya none vader; do
  for s in 51 52 53 54 55 56 57 58; do
    [ -f "experiments/evo/f10-$p-$s/final.json" ] || todo+=("$p:$s")
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
echo "批次结束 $(date '+%F %T')；已完成 $(ls experiments/evo/f10-*/final.json 2>/dev/null | wc -l | tr -d ' ')/24"
