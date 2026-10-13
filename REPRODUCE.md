# 复现说明

本文说明如何从仓库复现论文用到的结果。**只想核对统计结果时，不需要 Laya 模型、也不需要 GPU**：Laya 的先验与嵌入已缓存在仓库中。

## 0. 环境

- Node.js 24（本项目在 24.7.0 下运行；`.ts` 文件由 Node 的类型剥离直接执行，不使用参数属性与枚举），`npm install`。
- 重新计算 Laya 先验 / 嵌入或运行生态服务才需要 Python 3.12 与 `requirements.txt`（Apple Silicon / MPS；Laya 权重按其官方渠道与许可获取，见 `docs/LOCAL_LAYA.md`）。

## 1. 验证代码本身

```bash
scripts/verify.sh        # 黄金测试、模拟器 / 语义 / 结构化 / 层次信念测试、Python 测试、构建
```

## 2. 复现预注册评估（只需 Node；约一至数小时）

每个预注册的协议、冻结哈希与结果都在 `docs/PREREGISTRATION_0N.md` 与 `experiments/prereg/`。评估脚本在基因组或数据哈希与冻结记录不一致时拒绝运行。

| 预注册 | 内容 | 命令 |
| --- | --- | --- |
| 02 | 留出方言，4 个进化个体 | `node packages/evo/heldout-eval.ts <新目录> --dialect heldout` |
| 03 | 3 个训练种子的重复 | `node packages/evo/heldout-rep-eval.ts <新目录> --dialect heldout` |
| 04 | 更长延迟 / 更强欺骗（8 种子） | `node packages/evo/heldout-long-eval.ts <新目录> --dialect heldout` |
| 05 | 事实方言上的先验质量 | `node packages/evo/prior-quality-pool.ts <新目录> --dialect factual` |
| 06 | 匹配训练 × 层次信念（2×2×2） | `node packages/evo/factorial-eval.ts <新目录>` |
| 07 | Laya 与词典；延迟 80 趋势 | `node packages/evo/lexicon-eval.ts <新目录>` |

原始结果在 `experiments/evo/*/results.json`；复现得到的 `results.json` 应与之逐项一致（评估使用固定的随机种子与模拟器版本）。

## 3. 重新训练个体（只需 Node；每个约数小时 CPU）

训练命令模板写在各预注册的“被测系统”一节，例如：

```bash
node packages/evo/semantic-evolve.ts experiments/evo/f6-laya-flat-d40-21 \
  --prior laya --learning on --agent structured --pool on --K 32 --harmCap 4 \
  --delay 40 --delayAll on --inversions 0.25,0.4 --worlds 6 --generations 40 --pop 24 \
  --sigma 0.25 --lr 0.1 --seed 21 --workers 1
```

训练结果依赖浮点与线程调度，同一命令重跑得到的基因组会略有不同；论文中的结论基于仓库内冻结的基因组（其哈希见 `experiments/prereg/`）。

## 4. 重新生成数据（可选）

- 方言文本：`packages/evo/ontology/dialects.json`；词池：`node packages/evo/make-pools.ts`（确定性生成）。
- Laya 先验表：`services/ecology/laya_prior_pool.py <pool.json> <输出.jsonl>`（需要 Laya 与 MPS；每 4000 条约 15–20 分钟）。
- Laya 嵌入：`services/ecology/embed_pool.py <输出目录> 32`。

## 5. 已知限制

见 `docs/RESEARCH_SUMMARY.md` §5 与各预注册的“已知限制”。留出方言池在多个预注册中被评估过（只看汇总，未用于调参）。
