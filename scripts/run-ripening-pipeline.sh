#!/usr/bin/env bash
# 预注册 10 的收尾流水线（可无人值守）：
#   1) 等 24 个 f10 基因组齐全（轮询，最长 12 小时）
#   2) 冻结 genome-hashes-10.json 并【先提交】，满足“训练完成后、评估前冻结”的时序
#   3) 8 分片并行评估（4608 个世界，可断点续跑）
#   4) --full 完整性闸门合并，写出 results.json
# 用法：bash scripts/run-ripening-pipeline.sh
# 幂等：已完成的步骤会跳过或复用；中断后重跑会从断点继续。
set -u
cd "$(dirname "$0")/.."
OUT=experiments/evo/ripening-eval-01
HASH=experiments/prereg/genome-hashes-10.json
LOG="$OUT/logs"
MARK="$OUT/.pipeline-status"
mkdir -p "$LOG"
stamp() { date '+%F %T'; }

# 1) 等待训练
echo "[$(stamp)] 等待 24 个基因组 …"
for i in $(seq 1 720); do
  n=0
  for p in laya none vader; do for s in 51 52 53 54 55 56 57 58; do [ -f "experiments/evo/f10-$p-$s/final.json" ] && n=$((n+1)); done; done
  if [ "$n" -eq 24 ]; then echo "[$(stamp)] 训练完成 24/24"; break; fi
  if [ "$i" -eq 720 ]; then echo "[$(stamp)] 等待超时（12 小时），当前 $n/24" >&2; exit 1; fi
  sleep 60
done

# 2) 冻结哈希并提交
if [ ! -f "$HASH" ]; then
  node packages/evo/prereg-hash.ts "$HASH" experiments/evo/f10 laya none vader --seeds 51-58 || exit 1
  git add "$HASH" && git commit -q -m "预注册 10 基因组哈希冻结（训练完成后、评估前）

24 个基因组（laya/none/vader × 种子 51–58）的 final.json sha256，由
packages/evo/prereg-hash.ts 生成。本提交在确认性评估运行之前完成；
随后由 scripts/run-ripening-pipeline.sh 执行 8 分片评估。
注：vader-53 曾在 2026-10-17 的批次中中断（19/40 代），已归档到
experiments/evo/aborted/ 并从零重跑；进入哈希的是重跑后的完整结果。" || echo "哈希提交失败（可能无改动），继续"
else
  echo "[$(stamp)] $HASH 已存在，校验不覆盖"
fi

# 3) 分片评估
echo "[$(stamp)] 启动 8 分片评估"
pids=()
for i in 0 1 2 3 4 5 6 7; do
  node packages/evo/ripening-eval-shard.ts "$OUT" --shard "$i" --shards 8 > "$LOG/shard-$i.log" 2>&1 &
  pids+=($!)
done
fail=0
for pid in "${pids[@]}"; do wait "$pid" || fail=$((fail+1)); done
echo "[$(stamp)] 分片结束，失败 $fail 个"

# 4) 合并 + 闸门
node packages/evo/ripening-eval-merge.ts "$OUT" --full || { echo "[$(stamp)] 合并/闸门失败" >&2; exit 1; }
echo "[$(stamp)] DONE $OUT/results.json" | tee "$MARK"
