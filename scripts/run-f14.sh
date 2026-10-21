#!/usr/bin/env bash
# 预注册 14 训练批次的运行器（可重入）：64 次独立进化，先验 {laya,none} × 学习器 {safety,bayes} × 延迟 {40,80} × 种子 81–88，
# 参数与 docs/PREREGISTRATION_14.md §2 的冻结命令模板逐项一致。
# 用法：bash scripts/run-f14.sh [并发数，默认 6]
set -u
cd "$(dirname "$0")/.."
CONC="${1:-6}"
LOG=experiments/evo/logs-f14
mkdir -p "$LOG"

run_one() {
  local prior="$1" learner="$2" delay="$3" seed="$4" dir="experiments/evo/f14-$1-$2-d$3-$4"
  if [ -f "$dir/final.json" ]; then echo "skip  $dir（已完成）"; return 0; fi
  if [ -d "$dir" ]; then echo "abort $dir（目录已存在但无 final.json，拒绝覆盖）" >&2; return 1; fi
  echo "start $dir $(date '+%F %T')"
  node packages/evo/semantic-evolve.ts "$dir" \
    --prior "$prior" --learning on --agent structured --learner "$learner" --pool on --K 32 --harmCap 4 \
    --delay "$delay" --delayAll on --inversions 0.25,0.4 --worldSeeds vary --worlds 6 --generations 40 \
    --pop 24 --sigma 0.25 --lr 0.1 --seed "$seed" --workers 1 \
    > "$LOG/f14-$prior-$learner-d$delay-$seed.log" 2>&1
  local rc=$?
  echo "done  $dir $(date '+%F %T') rc=$rc"
  return $rc
}

todo=()
for p in laya none; do for l in safety bayes; do for d in 40 80; do for s in 81 82 83 84 85 86 87 88; do
  [ -f "experiments/evo/f14-$p-$l-d$d-$s/final.json" ] || todo+=("$p:$l:$d:$s")
done; done; done; done
echo "待运行 ${#todo[@]} 个，并发 $CONC"
for t in "${todo[@]}"; do
  IFS=: read -r p l d s <<< "$t"
  run_one "$p" "$l" "$d" "$s" &
  while [ "$(jobs -rp | wc -l)" -ge "$CONC" ]; do sleep 5; done
done
wait
echo "全部完成 $(date '+%F %T')"
