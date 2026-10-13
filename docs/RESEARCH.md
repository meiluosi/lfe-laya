# 相关项目与研究依据

检索日期：2026-09-28。以下依据公开文档和项目页面，未逐个运行，也不等于独立复现其性能或行为结论。

工具复用、许可证、维护/兼容证据及具体采用建议另见 [开源复用调研](OPEN_SOURCE.md)。本文保留相关工作背景，不将研究原型等同可直接接入的工程组件。

## 1. Jev 与 Laya

- [Jev 官方文档](https://docs.typesafe.ai/introduction)：从状态和有类型的问题返回选择、评分或真假相关结果。适合有限决策接口，但不因此保证游戏策略质量。
- [Laya 项目](https://github.com/NandhaKishorM/laya)：开放的结构化决策模型，提供选择、评分等能力。具体 checkpoint、批量接口和运行后端在实施时核实。
- [用户提供的 Jev/Laya 对比文章](https://www.jxxy.net/ai/articles/yibie-2101553680889598094/)：小规模中文客服分类及级联实验。其准确率、耗时和置信度阈值不能直接迁移到生态模拟。

设计推论：让模型选择有限行为，模拟器负责执行与资源约束。性能和策略有效性需要使用本项目情境评估。

## 2. 直接的 Laya 游戏参考

[Laya Playground](https://github.com/wdobry/laya-playground) 提供 Flappy、跑道躲避和俄罗斯方块，通过局部游戏描述提出结构化问题。本地版运行模型，公开站点展示录制回放。

可借鉴：状态转为简短决策输入、真实调用与录制模式区分、记录与回放工具。该项目支持游戏集成的可行性，不能证明多生命体长期生态行为。

## 3. 浏览器人工生命

[LIFE — Digital Evolution Observatory](https://github.com/dominikvytisk/life-simulation) 描述了浏览器内的遗传、循环神经网络、记忆和通信模拟，并提供观测与谱系功能。

可借鉴：把渲染和模拟分开、跟踪个体及长期演化、以对照验证复杂行为。其大脑路线与调用固定的预训练 Laya 不同。README 中关于涌现的结论需结合实际实验审视。

## 4. 生态引擎与可替换模型

[līlā](https://github.com/hellolifeforms/lila) 使用性状定义生态实体，包含资源与种群机制，提供浏览器及 Godot 客户端。文档区分已实现的运动模型接口与处于设计阶段的行为、叙事层。

可借鉴：环境规则和模型接口分工，模型不拥有整个世界。暂不决定复用其代码，避免过早继承较重的架构。

## 5. AI 搜索人工生命规则

[ASAL：Automating the Search for Artificial Life with Foundation Models](https://sakana.ai/asal/) 利用视觉语言模型评价模拟结果，搜索目标行为、新颖性和多样性，覆盖生命游戏、Lenia 等系统。

可借鉴：AI 也可以用作世界规则的搜索与评价工具。它与“每个生命体调用决策模型”是不同路线；自动搜索不列入首版。

## 6. 形态与再生参考

- [Lenia](https://chakazul.github.io/lenia.html)：连续元胞自动机与生命样形态。
- [Growing Neural Cellular Automata](https://distill.pub/2020/growing-ca/)：通过训练局部神经更新规则产生生长、维持和再生。

可以借鉴视觉和局部机制，首版不将简单精灵动画当作这类真实形态动力学。

## 7. 关于新颖性的边界

本次检索没有核实到成熟的“Jev/Laya + 持续生态演化 + 完整观察前端”项目，但检索缺失不能证明不存在。

[JevBook](https://jevbook.dev/) 页面出现 Game of Life 字样，同时有本地引擎与后续接入相关说明。现有页面证据不足以证明其中生命游戏由真实 Jev 驱动，不作为确认案例。

项目价值应通过真实集成、观察体验与可复现实验体现，不以“全球首个”等无法验证的表述宣传。

## 8. 本项目需要验证的假设

| 假设 | 验证办法 |
| --- | --- |
| Laya 能理解简短局部状态并选择合法动作 | 留出情境集 + 真实响应记录 |
| 行为倾向参数能影响模型选择 | 控制其他输入的成对情境测试 |
| 决策吞吐能支撑几十个生命体 | 本机不同批量和输入长度实测 |
| 模型能产生相对于规则有意义的差异 | 多种子、统一环境与动作空间比较 |
| 用户能理解并喜欢观察这个世界 | 完整交互原型后进行用户审核 |
| 基础规则允许多代持续与策略差异 | 长时间运行、账本检查和性状统计 |
| 个体小策略能从有限生命周期经验中学习 | 同一个体轨迹、冻结参数对照、留出环境评估 |
| Laya 先验比小网络单独学习有额外价值 | 去除 Laya 的消融，报告表现及计算成本 |
| 环境变化后能够继续学习并保留旧能力 | A/B/A、适应速度、旧能力恢复与遗忘测量 |
| 学习收益不是记忆变化或自然选择造成 | 简化 A 与冻结 B 对照，早期关闭繁殖/变异并统计全部初始个体 |

这些均为待验证假设，不是已经获得的结果。

## 9. Laya 训练能力与持续学习

- [Laya 官方微调说明](https://github.com/NandhaKishorM/laya#fine-tuning) 提供领域数据训练与校准流程。其决策目标训练不等于已具备持续生态强化学习系统。
- [浏览器动作决策微调案例](https://nandhakishorm.github.io/laya/finetune_browser_agent/) 展示特定决策领域的适配。可支持路线 C 的技术探索，但不能外推为长期生存策略已经可训练成功。
- [A Definition of Continual Reinforcement Learning](https://arxiv.org/abs/2307.11046) 讨论持续强化学习的问题定义。持续运行、一次领域微调与持续适应是不同概念。
- [A Study of Plasticity Loss in On-Policy Deep Reinforcement Learning](https://arxiv.org/abs/2405.19153) 研究持续训练中的可塑性丧失与缓解方法。持续更新不能保证持续进步，相关方法仍需在本项目验证。

项目选择是工程假设：共享固定 Laya 并让每个个体的小策略独立学习，以控制资源并保留个体经历差异。这不是上述项目已经证明的结论。路线、奖励、对照和成长展示见 [持续学习方案](LEARNING.md)。

## 10. 面向论文的补充检索（2026-10-11，初步，非系统综述）

检索方式：网络检索 5 次（Baldwin 效应与进化智能体、语言模型先验与强化学习、Jev/Laya 的现有用法、欺骗性提示）。结果不构成穷尽性检索，写论文前须按 `docs/PUBLICATION_PLAN.md` 做系统检索并更新本节。

| 方向 | 代表工作 | 与本项目的关系 |
| --- | --- | --- |
| 进化 + 学习（Baldwin 效应） | [Evolving Self-taught Neural Networks](https://arxiv.org/pdf/1906.08854)；[Embodied Intelligence via Learning and Evolution](https://arxiv.org/pdf/2102.02202)；Ackley & Littman 的经典人工生命实验 | 先天 / 后天框架与 2×2 消融思路的来源，这部分不是新的 |
| 语言模型作为强化学习先验 | [Efficient Reinforcement Learning with Large Language Model Priors](https://arxiv.org/pdf/2410.07927)（ICLR 2025）；[Cache-Efficient Posterior Sampling for RL with LLM-Derived Priors](https://arxiv.org/pdf/2505.07274)；[Toward Efficient Exploration by LLM Agents](https://dilipa.github.io/papers/psrl_llms.pdf) | **最接近的工作**：LLM 作为动作先验，提高样本效率。区别：它们没有进化，没有“先天 / 后天 / 感知”三来源的分离，也没有测先验被欺骗时的代价 |
| 常识知识与文本强化学习 | [Text-based RL Agents with Commonsense Knowledge](https://ojs.aaai.org/index.php/AAAI/article/view/17090)；[自然语言强化学习综述](https://arxiv.org/pdf/1906.03926) | 用知识图谱而非预训练模型；提出过“语言中的人类先验” |
| LLM 智能体的终身学习 | [Lifelong Learning of LLM-based Agents: A Roadmap](https://arxiv.org/pdf/2501.07278)；[LifelongAgentBench](https://arxiv.org/abs/2505.11942) | 讨论更新智能体本身，不涉及进化 |
| Jev / Laya 的现有用法 | 游戏演示（Doom、Tetris、Flappy；[Laya Playground](https://github.com/wdobry/laya-playground)）；[渗透测试智能体中作为“系统一”决策层](https://arxiv.org/pdf/2609.28940) | 单智能体、直接调用或任务微调；未见进化或终身学习研究 |

观察：
1. 未检索到“固定的预训练决策模型 + 进化出的使用方式 + 个体终身学习，并分离度量三个来源”的受控研究；但 LLM 先验 + 强化学习是活跃方向，须在论文中把 Yan et al. 等工作作为主要对比对象。
2. 未检索到“先验被欺骗时的代价”的系统测量；这是本项目的一个切入点（硬先验在 25% 欺骗下有害，自适应信任可缓解）。
3. Laya 模型卡与二手来源称其是需要任务微调的底座、零样本接近随机；本项目发现固定 Laya 在食物描述的语义判断上零样本即有较高区分力（AUC 0.775–0.909，见 RESEARCH_SUMMARY）。这需要谨慎表述，并披露选项顺序偏差及其处理（两种顺序取平均）。
4. 新颖性表述建议：“据我们检索所及，尚未见到……”，不使用“首个”。

## 11. 补充检索（第二轮，2026-10-13）

仍是初步检索（网络检索 9 次累计），部分条目来自二手摘要；**引用前须逐条核对原文**。目的：补足第 10 节没有覆盖的四个方面。

| 方面 | 工作 | 与本项目的关系 |
| --- | --- | --- |
| 进化 + 基础模型 | [Evolution through Large Models](https://arxiv.org/pdf/2206.08896)（Lehman et al., 2022）：用代码 LLM 作为遗传编程的变异算子 | 与我们的方向相反：它让 LLM 做变异；我们让固定模型做先验、进化决定如何使用。可作为“进化与基础模型结合”的背景 |
| 进化学习强化学习的复现 | [Salimans et al., Evolution Strategies as a Scalable Alternative to RL](https://arxiv.org/abs/1703.03864)；[Roupassov-Ruiz & Zuo, 2026，对 1992 年 ALife 进化 + 学习测试平台的开源重现与生存分析](https://arxiv.org/abs/2601.04365) | 我们使用 OpenAI-ES；后者是与我们的“进化 + 学习 + 生存”设计最近的复现类工作，可对比其生存分析指标 |
| 错误 / 误导性语言先验 | [Arumugam & Griffiths, Toward Efficient Exploration by LLM Agents](https://arxiv.org/pdf/2504.20997)（附录讨论先验设定错误）；[Navigating Noisy Feedback: RL with Error-Prone Language Models](https://arxiv.org/html/2410.17389v1)；[Certified Predictive Value-of-Advice Gating](https://arxiv.org/pdf/2609.29548) | 它们讨论语言模型建议出错时的处理（门控、不确定性加权、仅在根节点注入）。我们的结果是：先验在即时反馈世界里中性、延迟世界里有益、强欺骗削弱收益，并有自适应信任 |
| 延迟后果的学习（生物学类比） | Garcia 效应 / 条件性味觉厌恶：食物与数十分钟后的不适也能建立联想（Garcia & Koelling, 1966；Kalat & Rozin, 1973）；演化解释是它提高对延迟毒性的生存率 | 与我们的“延迟信用窗口”基因高度相似，是极好的生物学动机：延迟后果下，先验 + 专门的信用分配机制才有价值。可在讨论里作类比，但不能声称我们的模型模拟了生物机制 |
| 预注册 | [The pre-registration experiment: an alternative publication model for machine learning research](https://neurips.cc/virtual/2020/workshop/16158)（NeurIPS 2020 研讨会） | 机器学习中预注册的先例；我们没有检索到预注册的 ALife / 进化强化学习研究 |

补充观察：
1. 未检索到“先验被误导（欺骗）时的代价”在进化个体上的受控测量；Arumugam & Griffiths 的附录是最接近的讨论，但对象是 LLM 智能体而非进化个体。
2. Garcia 效应的类比有价值但需谨慎：其机制（味觉特异性、后味痕迹）与我们的信用窗口是不同层面的，二者只在“延迟后果需要被归因于此前吃过的食物”这一点上相同。
3. 仍未检索：层次 / 相似度共享信念（我们的层次信念无增益，属负面结果，不需要对比文献）；Jev / Laya 之外的“系统一”决策模型（可在论文相关工作中简述）。
