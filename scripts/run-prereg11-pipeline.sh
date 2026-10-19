#!/usr/bin/env bash
# 预注册 11 的收尾流水线（可无人值守）：
#   1) 等 24 个 f11 基因组齐全（轮询，最长 12 小时）
#   2) 冻结 genome-hashes-11.json 并【先提交】（训练完成后、评估前）
#   3) 评估前等价性验证：分片驱动 vs 单进程参照，36 世界 × 3 字段，要求 0 处不一致
#   4) 8 分片并行评估（4608 个世界）+ --full 完整性闸门合并
# 用法：bash scripts/run-prereg11-pipeline.sh
set -u
cd "$(dirname "$0")/.."
OUT=experiments/evo/ripening11-eval-01
HASH=experiments/prereg/genome-hashes-11.json
LOG="$OUT/logs"
MARK="$OUT/.pipeline-status"
mkdir -p "$LOG"
stamp() { date '+%F %T'; }

# 1) 等待训练
echo "[$(stamp)] 等待 24 个基因组 …"
for i in $(seq 1 720); do
  n=0
  for p in laya none vader; do for s in 61 62 63 64 65 66 67 68; do [ -f "experiments/evo/f11-$p-$s/final.json" ] && n=$((n+1)); done; done
  if [ "$n" -eq 24 ]; then echo "[$(stamp)] 训练完成 24/24"; break; fi
  if [ "$i" -eq 720 ]; then echo "[$(stamp)] 等待超时，当前 $n/24" >&2; exit 1; fi
  sleep 60
done

# 2) 冻结哈希并提交
if [ ! -f "$HASH" ]; then
  node packages/evo/prereg-hash.ts "$HASH" experiments/evo/f11 laya none vader --seeds 61-68 || exit 1
  git add "$HASH" && git commit -q -m "预注册 11 基因组哈希冻结（训练完成后、评估前）

24 个基因组（laya/none/vader × 种子 61–68）的 final.json sha256，由
packages/evo/prereg-hash.ts 生成。本提交在确认性评估运行之前完成。
预注册 11 的世界为成熟周期 K=4（与预注册 10 的唯一差别是 K）。" || echo "哈希提交失败，继续"
else
  echo "[$(stamp)] $HASH 已存在，校验不覆盖"
fi

# 3) 评估前等价性验证（dry：测试方言，仅用种子 61/62）
echo "[$(stamp)] 等价性验证（分片 vs 单进程）"
rm -rf /tmp/v11-equiv && mkdir -p /tmp/v11-equiv
node packages/evo/ripening11-eval-shard.ts /tmp/v11-equiv --shard 1 --shards 2 --dry --seeds 2 > "$LOG/equiv-shard.log" 2>&1 || { echo "分片 dry 跑失败" >&2; exit 1; }
node -e '
const fs=require("fs");
const specs=[], base=350000;
for (const p of ["laya","none","vader"]) for (const s of [61,62]) for (const cues of ["language","off","shuffled"]) for (const inv of [0.25,0.4])
  specs.push({pool:"test",p,s,cues,inv,seq:1,base,dir:"experiments/evo/f11",K:4,harmCap:4,season:300,poolLimit:1000});
fs.writeFileSync("/tmp/v11-equiv/specs.json",JSON.stringify(specs));'
node packages/evo/ripening-refcheck.ts /tmp/v11-equiv/specs.json /tmp/v11-equiv/ref.json > "$LOG/equiv-ref.log" 2>&1 || { echo "参照跑失败" >&2; exit 1; }
node -e '
const fs=require("fs");
const ref=JSON.parse(fs.readFileSync("/tmp/v11-equiv/ref.json","utf8"));
const sh=JSON.parse(fs.readFileSync("/tmp/v11-equiv/shards/shard-01-of-2.json","utf8"));
let n=0,bad=0;
for(const r of sh.rows){const k=`test|${r.key}|${r.cues}|${r.inv}|${r.seq}`;const e=ref[k];if(!e){console.log("缺参照",k);continue;}n++;
  for(const f of ["fitness","toxicBites","survival"]) if(e[f]!==r[f]){bad++;console.log(`❌ ${k} ${f}`);}}
console.log(`等价性：${n} 世界 × 3 字段，${bad} 处不一致`);
fs.writeFileSync("experiments/evo/ripening11-eval-01/equivalence-check.json",JSON.stringify({checkedWorlds:n,checkedFields:n*3,mismatches:bad,result:bad===0?"等价":"不一致"},null,1));
process.exit(bad===0?0:1);' || { echo "等价性验证失败，拒绝运行正式评估" >&2; exit 1; }
echo "[$(stamp)] 等价性验证通过"

# 4) 正式评估
echo "[$(stamp)] 启动 8 分片评估"
pids=()
for i in 0 1 2 3 4 5 6 7; do
  node packages/evo/ripening11-eval-shard.ts "$OUT" --shard "$i" --shards 8 > "$LOG/shard-$i.log" 2>&1 &
  pids+=($!)
done
fail=0
for pid in "${pids[@]}"; do wait "$pid" || fail=$((fail+1)); done
echo "[$(stamp)] 分片结束，失败 $fail 个"

node packages/evo/ripening11-eval-merge.ts "$OUT" --full || { echo "[$(stamp)] 合并/闸门失败" >&2; exit 1; }
echo "[$(stamp)] DONE $OUT/results.json" | tee "$MARK"
