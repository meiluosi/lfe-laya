#!/usr/bin/env bash
# 预注册 22 训练批次的运行器（可重入）：48 次独立进化，先验 laya × 学习器 {b3off,b3f1,b3f1c,b3o1,b3f2,b3o2} × 种子 301–308，
# 参数与 docs/PREREGISTRATION_22.md §2 的冻结命令模板逐项一致。
# 用法：bash scripts/run-f22.sh [并发数，默认 6]
set -u
cd "$(dirname "$0")/.."
CONC="${1:-6}"
LOG=experiments/evo/logs-f22
mkdir -p "$LOG"

run_one() {
  local prior="$1" learner="$2" seed="$3" dir="experiments/evo/f22-$1-$2-$3"
  if [ -f "$dir/final.json" ]; then echo "skip  $dir（已完成）"; return 0; fi
  if [ -d "$dir" ]; then echo "abort $dir（目录已存在但无 final.json，拒绝覆盖）" >&2; return 1; fi
  local mix=mix; [ "$learner" = b3f1c ] && mix=clean
  echo "start $dir $(date '+%F %T')"
  node packages/evo/semantic-evolve.ts "$dir" \
    --prior "$prior" --learning on --agent structured --learner "$learner" --pool on --K 6 --harmCap 1 --inversions 0 \
    --driftAll on --driftFraction 1 --driftPhase 300 --driftPattern alt --driftCue paraphrase --horizon 4500 --cueMix "$mix" --worldSeeds vary \
    --worlds 6 --generations 40 --pop 24 --sigma 0.25 --lr 0.1 --seed "$seed" --workers 1 \
    > "$LOG/f22-$prior-$learner-$seed.log" 2>&1
  local rc=$?
  echo "done  $dir $(date '+%F %T') rc=$rc"
  return $rc
}

todo=()
for p in laya; do for l in b3off b3f1 b3f1c b3o1 b3f2 b3o2; do for s in 301 302 303 304 305 306 307 308; do
  [ -f "experiments/evo/f22-$p-$l-$s/final.json" ] || todo+=("$p:$l:$s")
done; done; done
echo "待运行 ${#todo[@]} 个，并发 $CONC"
for t in "${todo[@]}"; do
  IFS=: read -r p l s <<< "$t"
  run_one "$p" "$l" "$s" &
  while [ "$(jobs -rp | wc -l)" -ge "$CONC" ]; do sleep 5; done
done
wait
echo "全部完成 $(date '+%F %T')"
