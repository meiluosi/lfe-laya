#!/usr/bin/env bash
# 排队：预注册 20 评估结束后 → 预注册 21 评估（8 进程）→ 预注册 22 训练（并发 8）。每一步只在上一步的进程全部结束后开始。
cd "$(dirname "$0")/.."
while pgrep -f "robust-eval.ts" > /dev/null; do sleep 60; done
echo "20 评估结束 $(date '+%F %T')"
mkdir -p experiments/evo/bayes-eval-01
for k in 0 1 2 3 4 5 6 7; do a=$((221+2*k)); b=$((222+2*k)); node packages/evo/bayes-eval.ts experiments/evo/bayes-eval-01 --prereg 21 --seeds $a,$b > experiments/evo/bayes-eval-01/run-$a.out 2>&1 & done
wait
echo "21 评估结束 $(date '+%F %T')"
bash scripts/run-f22.sh 8
echo "22 训练结束 $(date '+%F %T')"
