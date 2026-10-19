#!/usr/bin/env bash
# 预注册 10 评估启动器：等 24 个 final.json 齐全 → 冻结基因组哈希 → 8 分片并行评估。
# 用法：bash scripts/run-ripening-eval.sh
# 说明：哈希文件已存在时校验并复用（不覆盖），符合“训练完成后、评估前冻结”的时序；
#       分片可断点续跑；合并时用 --full 完整性闸门。
set -u
cd "$(dirname "$0")/.."
OUT=experiments/evo/ripening-eval-01
HASH=experiments/prereg/genome-hashes-10.json
LOG="$OUT/logs"
mkdir -p "$LOG"

echo "== 1) 检查 24 个基因组 =="
done_n=0
for p in laya none vader; do for s in 51 52 53 54 55 56 57 58; do [ -f "experiments/evo/f10-$p-$s/final.json" ] && done_n=$((done_n+1)); done; done
echo "已完成 $done_n/24"
if [ "$done_n" -ne 24 ]; then echo "训练尚未完成，退出" >&2; exit 1; fi

echo "== 2) 冻结基因组哈希 =="
if [ -f "$HASH" ]; then
  echo "$HASH 已存在，校验而不覆盖"
  node -e '
const fs=require("fs"),c=require("crypto");
const h=JSON.parse(fs.readFileSync("experiments/prereg/genome-hashes-10.json","utf8"));
let bad=0;
for(const p of ["laya","none","vader"]) for(const s of [51,52,53,54,55,56,57,58]){
  const f=`experiments/evo/f10-${p}-${s}/final.json`;
  const sh=c.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
  if(h[`${p}-${s}`]!==sh){bad++;console.log("❌ 哈希不符",p,s);}
}
console.log(bad===0?"✅ 24 个哈希与当前基因组一致":"❌ 有基因组在冻结后被改动");
process.exit(bad===0?0:1);'
else
  node packages/evo/prereg-hash.ts "$HASH" experiments/evo/f10 laya none vader --seeds 51-58
fi

echo "== 3) 8 分片并行评估（4608 个世界）=="
pids=()
for i in 0 1 2 3 4 5 6 7; do
  node packages/evo/ripening-eval-shard.ts "$OUT" --shard "$i" --shards 8 > "$LOG/shard-$i.log" 2>&1 &
  pids+=($!)
done
fail=0
for pid in "${pids[@]}"; do wait "$pid" || fail=$((fail+1)); done
echo "分片结束，失败 $fail 个"

echo "== 4) 合并 + 完整性闸门 =="
node packages/evo/ripening-eval-merge.ts "$OUT" --full
echo "完成：$OUT/results.json"
