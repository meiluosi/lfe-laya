#!/usr/bin/env bash
# 预注册 21 训练批次的运行器（可重入）：32 次独立进化，先验 laya × 学习器 {bayes,bayes-off} × 种子 221–236，
# 参数与 docs/PREREGISTRATION_21.md §2 的冻结命令模板逐项一致。
# 用法：bash scripts/run-f21.sh [并发数，默认 6]
set -u
cd "$(dirname "$0")/.."
CONC="${1:-6}"
LOG=experiments/evo/logs-f21
mkdir -p "$LOG"

run_one() {
  local prior="$1" learner="$2" seed="$3" dir="experiments/evo/f21-$1-$2-$3"
  if [ -f "$dir/final.json" ]; then echo "skip  $dir（已完成）"; return 0; fi
  if [ -d "$dir" ]; then echo "abort $dir（目录已存在但无 final.json，拒绝覆盖）" >&2; return 1; fi
  echo "start $dir $(date '+%F %T')"
  node packages/evo/semantic-evolve.ts "$dir" \
    --prior "$prior" --learning on --agent structured --learner "$learner" --pool on --K 6 --harmCap 1 --inversions 0 \
    --driftAll on --driftFraction 1 --driftPhase 1200 --driftPattern mix --driftCue paraphrase --worldSeeds vary \
    --worlds 6 --generations 40 --pop 24 --sigma 0.25 --lr 0.1 --seed "$seed" --workers 1 \
    > "$LOG/f21-$prior-$learner-$seed.log" 2>&1
  local rc=$?
  echo "done  $dir $(date '+%F %T') rc=$rc"
  return $rc
}

todo=()
for p in laya; do for l in bayes bayes-off; do for s in 221 222 223 224 225 226 227 228 229 230 231 232 233 234 235 236; do
  [ -f "experiments/evo/f21-$p-$l-$s/final.json" ] || todo+=("$p:$l:$s")
done; done; done
echo "待运行 ${#todo[@]} 个，并发 $CONC"
for t in "${todo[@]}"; do
  IFS=: read -r p l s <<< "$t"
  run_one "$p" "$l" "$s" &
  while [ "$(jobs -rp | wc -l)" -ge "$CONC" ]; do sleep 5; done
done
wait
echo "全部完成 $(date '+%F %T')"
