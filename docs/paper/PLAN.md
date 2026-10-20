# Paper plan (section by section) — 草稿，待作者确认

状态：**计划，不是正文。** 依据 `academic-paper` 的 plan 模式结构（Paper Configuration Record → 贡献声明 → 逐节计划 → 论证压力测试），并受 `lfe-paper-rules` 约束。所有数字来自 `docs/EFFECT_SIZES.md` 及各预注册 `results.json`；所有引用在核对前标 `[UNVERIFIED]`。正文语言：English。

## A. Paper Configuration Record（需要你确认；确认前不进入写作）

| 项 | 暂定值 | 备注 |
| --- | --- | --- |
| 论文类型 | Empirical study with pre-registered confirmatory evaluations | 非综述、非方法提出型 |
| 学科 | Artificial life / evolutionary computation / language-model priors | arXiv 主类建议 **cs.NE**（Neural and Evolutionary Computing），交叉 **cs.AI、cs.LG**；最终由你定 |
| 目标 | arXiv preprint（不投稿）；之后可改投会议/期刊 | 上传需你另行明确指示 |
| 引用格式 | **author–year（natbib）**，参考文献用 BibTeX；备选：numeric | 请你选 |
| 输出 | LaTeX + BibTeX → PDF；图用 `figures/*.pdf` | `rsvg-convert` 已装 |
| 篇幅 | 正文约 8–10k words + 附录（协议、全部预注册表、复现） | arXiv 无硬限制 |
| 作者 | Feng Yu（冯宇），independent researcher | 无单位 |
| 披露 | AI-assisted writing and analysis disclosure | 用 `academic-paper` 的 disclosure 模式生成 |
| 代码与数据 | Apache-2.0 / CC BY 4.0（见 `LICENSE`、`DATA_LICENSE.md`） | 公开仓库需你另行指示 |

## B. 贡献声明（draft，作者须确认或改写；只写有确认性证据支持的）

1. **A controlled testbed.** A consequence-delay ecology with a generative ontology and four author-written dialects in which three sources of competence (innate genome, lifetime learning, frozen-model perception) can be separated, together with a pre-registration workflow (protocol freeze → training → hash freeze → one-shot evaluation) applied to ≈230 independent evolutionary runs.
2. **Conditional value of a frozen prior.** Confirmatory evidence that the prior's net value depends on the world: neutral without consequence delay (non-inferiority confirmed), growing with delay (+0.049 at delay 40, +0.073 at delay 80), and zero when experience alone can learn the task (fair world: −0.005, interval contains 0).
3. **Semantics, not sentiment.** The frozen model beats a lexicon only where descriptions require world knowledge (factual dialect, +0.050), its learned trust transfers across dialects while lexicon-driven trust does not; where a lexicon can read the text there is no distinguishable difference.
4. **Cues are used, and wrong cues cost.** Individuals that read language cues (neighbour appearance, ripening phrases) gain when cues are true and lose when mismatched, only through the prior's reading.
5. **Null and negative results, reported with effect-size tiers.** Hierarchical belief sharing, in-domain training, and the early large effect that did not replicate; directional and magnitude evidence reported separately.

（不写：先验稳定提升适应度；Laya 普遍优于词典；“first”；`laya − none` 当作公平的学习比较。）

## C. 逐节计划（paragraph-level）

### Abstract（≈200 words）
P1 问题：fixed pretrained decision model as "System 1" for evolved agents；P2 方法：ecology、三来源分离、预注册、≈230 runs；P3 结果：条件性价值（延迟、公平世界为零、语义 vs 情感、线索）；P4 局限：模拟、作者方言、种子数小；不写“首个”。

### 1 Introduction
- P1 动机：当一个固定的预训练模型能直接给出“这个能不能吃”的直觉，进化与终身学习还需要做什么？System 1 / innate / acquired 的概念对应（Baldwin 效应 `[UNVERIFIED]`）。
- P2 缺口：LLM 作为 RL 先验的工作（Yan et al. `[UNVERIFIED]`）测样本效率，但没有分离先天与后天、没有测“先验出错或不必要”的代价；进化 + 基础模型的工作多以 LLM 为变异算子（Lehman et al. `[UNVERIFIED]`）。
- P3 我们做什么：一个让三种来源可分离的生态；每个比较先预注册；种子层面的统计。
- P4 贡献（§B 五条）。
- P5 结论预告（含负面）：价值是条件性的。
- P6 论文结构。

### 2 Related work
- 2.1 Evolution plus learning（Baldwin 效应；Ackley & Littman 类生存模拟；最近的开源重现 `[UNVERIFIED]`）。
- 2.2 Language models as priors for agents（RL 先验、后验采样、错误先验的门控 `[UNVERIFIED]`）。
- 2.3 Delayed consequences and credit assignment（Garcia 效应作类比，不声称模拟了机制 `[UNVERIFIED]`）。
- 2.4 Evaluation practice（种子数、预注册在机器学习中的先例、等价检验 `[UNVERIFIED]`）。
- 定位句：“据我们检索所及，尚未见到……”，不写“首个”。

### 3 The ecology and the individuals
- 3.1 Shared ecology simulator（模拟器拥有世界状态，模型只提交动作；能量账本闭合；隐藏真值不入观测）。
- 3.2 Semantic food and generative ontology（隐藏属性 → 文本生成器；四个方言；致命 / 延迟 / 欺骗；成熟周期；社会观察）。表 2：世界参数。
- 3.3 The frozen model as System 1（Laya = ModernBERT-large + 微调决策头，421M；只作缓存先验与嵌入，**未在决策环里逐步调用**；位置偏差与两种顺序取平均）。
- 3.4 Structured individuals and genomes（规则骨架 + 9–10 个基因；先天 / 后天 / 感知三来源；基因变异≠Laya 权重进化）。表 3：基因。
- 3.5 Evolution strategy training（OpenAI-ES 变体 `[UNVERIFIED]`、世界种子、匹配训练 / 评估制度）。
- 3.6 Controls（none、shuffled、VADER、oracle 仅度量上限）。

### 4 Evaluation protocol
- 4.1 Pre-registration workflow 与哈希冻结；程序性偏离的披露（预注册 04 并列 p、09 哈希晚提交与分片）。
- 4.2 Unit of analysis = training seed；exact sign-flip test；Holm（仅基于 p）；效应量阈值事先固定。
- 4.3 Tiered reading of results（directional / magnitude / non-inferiority；`EFFECT_SIZES.md`）。
- 4.4 What the held-out pools are（多次评估只看汇总）。

### 5 Results
- 5.1 Prior quality（图 4）：情感方言 Laya .909 vs VADER .689；事实方言 .775 vs .583。
- 5.2 Value of the prior vs. delay（图 2）：delay 0 非劣效（+0.015）；40 → +0.049；80 → +0.073；D80−D40 +0.035；**错配训练产生“先验有害”的假象**（预注册 04 的 −0.085/−0.136 在匹配训练后消失）。
- 5.3 Laya vs. a lexicon：事实方言 + delay 40 +0.050；跨方言迁移（事实训练的 laya 0.333 对情感训练 0.334；词典 0.271 对 0.307）；词典也能读的描述无差别（成熟周期 +0.005）；公平世界略负（−0.014）。
- 5.4 Cues（图 3）：社会外观 +0.047、错配代价 +0.101；成熟阶段短语 +0.081；无先验个体不使用线索；**错配是一致性重新标记**。
- 5.5 When experience suffices（预注册 10 → 11）：none 75% 停在“不吃”，公平世界 laya − none = −0.005。放正文。
- 5.6 Null results：层次信念 +0.0005；事实方言训练 −0.0015；预注册 02 的大效应（seed 1）未复现；稳定性假设被推翻（laya 的跨种子 SD 是 none 的 2.2 倍）。
- 图 1（森林图）放在 5 的开头作总览；表 1 列出全部假设与正式结论。

### 6 Discussion
- P1 先验的价值是“条件性”的：经验昂贵（延迟、致命）、线索可靠、描述需要读懂。
- P2 对“系统 1 + 进化”框架的含义：进化学到的是“信任多少”，不是知识本身；Laya 的可靠性跨方言稳定。
- P3 与已有工作的关系（Yan et al. 等；仅限核对后的表述）。
- P4 生物学类比（Garcia 效应）：只作类比。
- P5 对设计者的启示：何时值得用固定先验。

### 7 Limitations（必须逐条）
作者撰写的方言（同一作者）；模板化食物场景、模拟；世界难度在开发期调整（成熟周期）；手写阈值；Laya 只作缓存先验；个体是手工结构（9–10 个基因）；种子数小（6–8）、区间粗略；留出池多次评估、多重检验未跨预注册校正；`laya − none` 含“读得懂”成分；吞吐不外推。

### 8 Reproducibility and data
`REPRODUCE.md`；冻结哈希；许可；先验与嵌入缓存可复现评估而无需模型。

### Appendices
A 全部预注册协议摘要与程序性偏离；B 效应量总表；C 世界与基因细节；D 开发期结果（明确标注非确认性）；E AI 披露与作者声明。

## D. 论证压力测试（最可能的质疑与回应位置）

| 质疑 | 回应 | 位置 |
| --- | --- | --- |
| 世界是你手调的，结论只对这个世界成立 | 承认；主张只限“条件性”；预注册 11 在公平世界给出零净值；W7 难度调整已披露 | §7、§5.5 |
| 个体是手工结构，收益来自你的信念更新 | 对照 none / vader 共用同一结构；先验只改变 v0 | §3.4、§7 |
| `laya − none` 是“读得懂 vs 读不懂”，不公平 | 明确承认；公平比较是预注册 11 | §4、§5.5 |
| 种子少、区间粗 | 方向用精确符号翻转（8/8），幅度用区间，均标明；不外推 | §4.3、§7 |
| 多重检验与留出池反复使用 | 披露；只看汇总、未调参；效应量总表；建议外部复现 | §4.4、§7 |
| Laya 不是生成式模型，结论能否推广到 LLM | 不推广；明确是编码器 + 决策头；模型替换调研为后续工作 | §3.3、§7 |
| 与 Yan et al. 等工作的区别 | 我们分离三来源、测先验出错 / 不必要的代价、用预注册 | §2.2、§6 |

## E. 待做（按顺序）

1. 你确认 §A（引用格式、arXiv 类别）与 §B（贡献声明）。
2. 方法与结果章先行（证据最稳固）；用 `academic-paper` 的 outline / full 模式写，`draft_writer` 的 Phase 4a/4b 与评估器 6a/6b 合约不被绕过。
3. 引用核对：`citation-check`；清单见 `OUTLINE.md` §5。
4. 先天线性头实验结果出来后决定是否加一节（Baldwin 式同化），目前不写进主线。
5. 模拟审稿（`academic-paper-reviewer`）一轮，再修订。
6. AI 披露（`disclosure` 模式）与作者声明；上传 arXiv 需你另行明确指示。
