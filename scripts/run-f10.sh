#!/usr/bin/env bash
# 预注册 10 训练批次运行器：按 docs/PREREGISTRATION_10.md §2 的冻结命令模板逐条执行。
# 用法：bash scripts/run-f10.sh <并发数>
# 已有 final.json 的运行会跳过，便于中断后续跑；每条命令的参数与协议逐项一致。
set -u
cd "$(dirname "$0")/.."
CONCURRENCY="${1:-3}"
OUT=experiments/evo

run_one() {
  local prior="$1" seed="$2" dir="$OUT/f10-$1-$2"
  if [ -f "$dir/final.json" ]; then echo "skip $dir（已完成）"; return 0; fi
  local log="experiments/evo/logs-f10"
  mkdir -p "$log"
  echo "start $dir $(date '+%F %T')"
  node packages/evo/semantic-evolve.ts "$dir" \
    --prior "$prior" --learning on --agent structured --pool on --K 16 --harmCap 4 \
    --ripening on --cues language --seasonTicks 300 --ripeLimit 3000 --inversions 0.25,0.4 \
    --worlds 6 --generations 40 --pop 24 --sigma 0.25 --lr 0.1 --seed "$seed" --workers 1 \
    > "$log/f10-$prior-$seed.log" 2>&1
  echo "done  $dir $(date '+%F %T') rc=$?"
}

# 先验 × 种子，按协议顺序编号（先验 laya/none/vader，种子 51–58）
running=0
for prior in laya none vader; do
  for seed in 51 52 53 54 55 56 57 58; do
    run_one "$prior" "$seed" &
    running=$((running + 1))
    if [ "$running" -ge "$CONCURRENCY" ]; then wait -n 2>/dev/null || wait; running=$((running - 1)); fi
  done
done
wait
echo "全部完成 $(date '+%F %T')"
ls -d "$OUT"/f10-* 2>/dev/null | wc -l
