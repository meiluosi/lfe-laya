# 引用核对记录（2026-10-21）

方法：对每条候选用 WebFetch 读取 arXiv 摘要页 / 出版方页面，或用 WebSearch 核对书目信息；只核对**书目信息和摘要层面的论点**，没有逐篇读全文。凡是只核对到摘要的，正文里只能写摘要层面的陈述。

## 已核对（进入 refs.bib）

| 键 | 条目 | 核对来源 | 允许的陈述（仅限） |
| --- | --- | --- | --- |
| hinton1987 | Hinton & Nowlan, *Complex Systems* 1:495–502 (1987) | Hinton 个人页、Complex Systems 页（检索） | 学习可以引导进化，模拟中有学习的个体进化更快（作者陈述） |
| fontanari2017 | Fontanari & Santos, *EPJ B* 90:186 (2017) | arXiv 1702.08411 摘要页 | 他们认为 Hinton–Nowlan 的模拟只表明“学习能力容易被选择”，并估计了学得的行为变为先天的概率与时间 |
| ackley1992 | Ackley & Littman, *Artificial Life II*, pp. 487–509 | 检索（书目 + 摘要） | 在人工环境中结合进化与学习，结合比单独任一种更成功（摘要） |
| le2019baldwin | Nam Le, AISB 2019, arXiv 1906.08854 | arXiv 摘要页 | 自教导网络在多智能体觅食与生存模拟中，进化加自教导优于单独任一 |
| roupassov2026 | Roupassov-Ruiz & Zuo, arXiv 2601.04365 | arXiv 摘要页 | 开源重现 1992 年 ALife 的进化强化学习测试平台；比较神经与程序化策略，4000 次试验的生存分析。**摘要未点名 Ackley & Littman，不能写成“重现了他们的平台”。** |
| yan2025llmprior | Yan et al., ICLR 2025, arXiv 2410.07927 | arXiv 摘要页；UCL Discovery 记录 ICLR 2025 pp. 30818–30842（二手） | 把 LLM 当作动作先验，经贝叶斯推断融入强化学习；作者报告离线场景样本需求减少超过 90% |
| arumugam2025 | Arumugam & Griffiths, arXiv 2504.20997（arXiv 备注：ICLR 2026） | arXiv 摘要页 | 让 LLM 显式实现强化学习的后验采样以改进探索。**摘要页不讨论先验设定错误（见下“纠正”）** |
| murugesan2020 | Murugesan et al., arXiv 2010.03790 | arXiv 摘要页 | 用 ConceptNet 常识知识让文本游戏智能体过滤不合理动作 |
| lehman2022 | Lehman et al., arXiv 2206.08896 | arXiv 摘要页 | 把代码 LLM 用作遗传编程的变异算子 |
| sygkounas2026 | Sygkounas et al., GECCO 2026, arXiv 2603.28386 | arXiv 摘要页 | LLM 生成策略与环境，二者在零和博弈中共同进化 |
| salimans2017 | Salimans et al., arXiv 1703.03864 | arXiv 摘要页 | 进化策略作为强化学习的可扩展替代 |
| garcia1966 | Garcia & Koelling, *Psychonomic Science* 4:123–124, doi 10.3758/BF03342209 | 检索（DOI + 摘要） | 线索的选择取决于随后的强化物（味觉与恶心配对） |
| kalat1973 | Kalat & Rozin, *JCPP* 83(2):198–207 | 检索（摘要性描述） | “习得的安全”机制解释长延迟味觉厌恶 |
| hutto2014 | Hutto & Gilbert, ICWSM 8(1):216–225, doi 10.1609/icwsm.v8i1.14550 | AAAI OJS 页（检索） | VADER：为微博文本构建与验证的基于词典和规则的情感模型 |
| nosek2018 | Nosek et al., *PNAS* 115(11):2600–2606, doi 10.1073/pnas.1708274114 | 检索（DOI + 摘要） | 预注册区分预测与事后分析 |
| colas2018 | Colas et al., arXiv 1806.08295 | arXiv 摘要页 | 关于深度强化学习实验需要多少随机种子的统计功效教程 |
| warner2024 | Warner et al., arXiv 2412.13663 | arXiv 摘要页 | ModernBERT：仅编码器模型 |
| laya | Convai Innovations，HF 模型卡 `convaiinnovations/laya` | WebFetch 读取模型卡 | Apache-2.0；英文根检查点以 ModernBERT-large 为骨干，421M；卡片称“可零样本使用”但**“是需要针对领域微调的底座，不是零样本决策引擎”**；其类型化决策基准上基础检查点接近随机（0.362），微调后 0.766 |

## 纠正（我之前的说法，已核对为不成立或需要收窄）

1. **Arumugam & Griffiths 与“先验设定错误”**：我此前依据一条检索摘要说它的附录讨论先验设定错误。arXiv 摘要页**没有**提这一点，我也没读全文，因此**不得**据此引用它讨论错误先验；如要引用，须先读全文附录。
2. **渗透测试论文（arXiv 2609.28940）**：我此前说它把 Jev/Laya 当作“系统一”决策层。核对后：该论文只在案例中使用 Jev；**Laya 并不在其实验中**，只是综述了规格。已从相关工作中删除，不引用。
3. **Roupassov-Ruiz & Zuo**：比较的是神经与程序化策略；“重现 Ackley & Littman 平台”的说法没有证据，只能写“1992 年的 ALife 进化强化学习测试平台”。
4. **Laya 的零样本能力**：模型卡明确说它是需要微调的底座，在其自己的类型化决策基准上零样本接近随机。本项目发现它在**食物描述的语义判断**上零样本区分力较高（AUC 0.775–0.909）；这是一个**与模型卡看似相反的观察**，论文里必须按“在我们的设定下观察到”来写，并披露两种选项顺序的处理。

## 仍未核对

NeurIPS 2026 “Think During Training, Act Without the LLM”（只有检索线索）；Jev 文档（docs.typesafe.ai）；Laya 的 GitHub 仓库与 Laya Playground；其余 `docs/RESEARCH.md` §10–11 中的条目。未核对的不得进入正文。
