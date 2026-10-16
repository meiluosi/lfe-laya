# 先验模型替换调研（2026-10-17，只读核查）

状态：**只读调研 + 本机可核实项已核实**。未下载任何模型权重、未安装依赖、未跑推理、未改动模拟器或个体逻辑。

## 1. 为什么要做

现行"系统 1 直觉"用的是固定 checkpoint `convaiinnovations/laya`。所有确认性结论都绑定在这一个模型上，外部审阅必然要问：换一个先验模型，结论还在不在？本项目自己的证据（`docs/WORLD_COMPLEXITY.md` §14.11、`docs/PREREGISTRATION_08.md`）显示先验的**质量**会决定它有没有用（差的先验比没有更差，`docs/PREREGISTRATION_07.md`），所以"先验质量"本身值得作为变量检验。

## 2. 本机已核实的硬事实（这些不是检索来的，是直接读本机文件）

| 事实 | 证据 |
| --- | --- |
| Laya 的编码器是 `answerdotai/ModernBERT-large`，决策头 2 层，max_len 512 / head_max_len 192 | `.models/laya/55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851/rl_agent_config.json` |
| Laya 权重 842,609,210 B ≈ 803MB（fp32）→ 与文档所称 ~421M 参数一致 | 同目录 `model.safetensors` |
| Laya 是**从头微调**过的（`fine_tuned_from_checkpoint: true`，7313 次更新，1.96 小时） | 同目录 `rl_agent_config.json` 的 `training` 段 |
| 本机已缓存 `answerdotai/ModernBERT-base`（573MB）与 `BAAI/bge-small-en-v1.5`（1MB 指针） | `~/.cache/huggingface/hub/` |

**由此得到的结论（重要）**：Laya **不是**生成式语言模型，而是"预训练编码器（ModernBERT-large）+ 本项目微调的 2 层决策头"。因此：

1. **Laya 的"读得懂"来自编码器，不是来自它的决策头。** 用别的**生成式**小模型（Qwen3.5、MiniCPM、SmolLM 等）做先验，是**跨架构**比较：对方要先解决"如何把一个因果 LM 的输出校准成概率"，再谈语义能力，两者混在一起无法归因。
2. 真正同源的对照臂是**编码器系分类器**（ModernBERT/DeBERTa/Cross-Encoder NLI 等），而且必须是"预训练编码器 + 在同类判断任务上微调"的形态——即必须承认这个对比臂**也经过微调**，否则比的不是"语言直觉的强弱"，而是"微调过 vs 没微调过"。
3. 任何作为先验的模型，其判断都必须**只依赖文本**。用本项目的隐藏真值或评估世界数据去训练/微调先验，会破坏"隐藏真值不得进入行为或训练输入"的边界；这一点在 `AGENTS.md` 里是硬线。

## 3. 候选核查（检索核实；标注为"未能核实"的不得当事实）

**方法论限制**：本轮本机外网 egress 完全不可达（`huggingface.co` 与 `example.com` 均返回 000 / 超时，25 秒），HuggingFace JSON API 与 `web_fetch` 都失败。因此许可证信息只能来自检索命中的 HF 仓库页 / LICENSE 文件页 / raw README 片段，**没有任何一条来自 API 的 `license` 字段**。

| 候选 | 参数 | 许可证 | 16GB CPU | 判断 |
| --- | --- | --- | --- | --- |
| `autotrust/JEV-9B` | 9B | Apache-2.0（检索命中） | **不能**：9B×bf16 ≈ 18GB > 16GB 总内存；INT4 可装入但 10 核 CPU 跑十几万条不现实 | 概念上最贴近（同属决策/路由家族），**硬件出局** |
| `answerdotai/ModernBERT-base` | 149M | 未能核实 | **能，且本机已缓存（零下载）** | **最同源的对照臂**（Laya 编码器的 base 版） |
| `MoritzLaurer/ModernBERT-large-zeroshot-v2.0` | ~395M | 未能核实 | 能（fp32≈1.6GB） | 原生 NLI 二分类头，直接出 entailment 概率；同架构第三方微调 |
| `Qwen/Qwen3.5-0.8B` | 0.8B | Apache-2.0（检索命中） | 能（bf16≈1.6GB） | 新世代生成式小模型；**需 logit 差分**，跨架构 |
| `openbmb/MiniCPM4-0.5B` | 0.5B | Apache-2.0（检索命中） | 能 | 同"需 logit 差分" |
| `ibm-granite/granite-4.0-350m` | 350M | Apache-2.0（检索命中） | 能 | 同上 |
| `OpenBMB/MiniCPM5-2B` | 2B | **未能核实** | 勉强 | 拟用前必须先查清许可证 |
| `LiquidAI/LFM2-*`、`google/gemma-3-270m` | — | **非 OSI 专有许可** | 能 | 许可条款与项目开源计划需另行评估 |

## 4. 受外网阻断影响、无法在本机完成的事

1. 领取任何新权重（本项目当前**无法联网取模型**）。
2. 用 HF API 的一手 `license` 字段核对上表所有"未能核实"项。
3. 生成新先验模型在留出方言上的 AUC——需要先有权重，再写一个"文本 → P(能吃)"的生成脚本（产出与现有 `experiments/evo/laya-prior-v2/*.jsonl` 同格式的缓存表）。

## 5. 建议的推进顺序（不在本文档内执行，需先对齐）

1. **先修世界**（见 `docs/WORLD_COMPLEXITY.md` §14.11 的难度响应）：世界没有判别力时，任何先验模型的对比都是白烧算力。
2. **同源对照臂优先**：用本机已缓存的 `answerdotai/ModernBERT-base` + 在**同类判断任务**上训练的分类头（只用公开方言文本标签，不碰隐藏真值），作为"同架构、小一档"的先验，跑留出方言 AUC。这一步零下载、可立刻做。
3. **跨架构臂**（Qwen3.5-0.8B 一类）等有网窗口再取，且必须在文档里标明"生成式 LM + logit 差分"，与编码器系分开报告。
4. 无论走哪条，先验都必须按 `{text, pEat}` 缓存到磁盘（现有 Laya 就是这么做的），评估脚本不感知模型内部。
