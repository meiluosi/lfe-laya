#!/usr/bin/env bash
# 开发期（非确认性）：A/B/A 完全反转世界里的小规模进化试训，用来定假设阈值。2 个种子 × {plain,dual,regime} × {laya,none}。
set -u; cd "$(dirname "$0")/.."; CONC="${1:-6}"; mkdir -p experiments/evo/logs-dev-aba
run_one() { local p="$1" l="$2" s="$3" d="experiments/evo/dev-aba-$1-$2-$3"; [ -f "$d/final.json" ] && return 0; [ -d "$d" ] && { echo "abort $d" >&2; return 1; }
  node packages/evo/semantic-evolve.ts "$d" --prior "$p" --learning on --agent structured --learner "$l" --pool on --K 6 --harmCap 1 --inversions 0 --driftAll on --driftFraction 1 --driftPhase 1200 --worldSeeds vary --worlds 6 --generations 40 --pop 24 --sigma 0.25 --lr 0.1 --seed "$s" --workers 1 > "experiments/evo/logs-dev-aba/$p-$l-$s.log" 2>&1; }
for p in laya none; do for l in plain dual regime; do for s in 201 202; do
  run_one "$p" "$l" "$s" &
  while [ "$(jobs -rp | wc -l)" -ge "$CONC" ]; do sleep 5; done
done; done; done; wait; echo done
