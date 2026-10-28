---
name: lfe-paper-rules
description: "lfe-laya 项目的论文写作约束补丁。写、改、审本项目的论文/摘要/相关工作/结果/局限/披露时与 academic-paper、academic-paper-reviewer 同时使用；决定哪些结论能写、数字从哪来、引用如何核对。触发：写论文、论文大纲、摘要、结果章节、局限、引用检查、arXiv、投稿。"
---

# lfe-laya 论文写作约束

通用写作流程（大纲、修订、引用格式、LaTeX/PDF、审稿模拟）交给 `academic-paper` 与 `academic-paper-reviewer`。本 skill 只补充**本项目特有的硬约束**；冲突时以本文件和 AGENTS.md 为准。

## 事实来源（只从这里取数，不凭记忆）

- 论文定位、可主张/不可主张：`docs/PUBLICATION_PLAN.md` §1
- 证据与限制：`docs/RESEARCH_SUMMARY.md` §4–§5；大纲 §7
- 效应量与分类：`docs/EFFECT_SIZES.md`；原始数字来自各预注册的 `results.json`
- 预注册原文：`docs/PREREGISTRATION_0x.md`，冻结时间以 git 提交为准，不改写历史
- 每个数字、表格、图都要能追到 `experiments/` 下的原始文件；追不到就不写

## 主张规则

1. 只写有证据的结论。`PUBLICATION_PLAN.md` 列为“不能主张”的（先验稳定提升适应度、Laya 优于词典的普遍适应度收益、“首个”），除非后续预注册支持，一律不写。
2. 负面与开发期失败必须写：H3 不成立、预注册 03 的大效应未稳定复现、进化个体相对手写学习者无显著优势、朴素学习崩溃、软先验无用。
3. **方向确认与幅度确认分开报告**（见 `EFFECT_SIZES.md` 的分类）。“方向确认、幅度不定”不得写成“显著提升”。
4. 事后、探索性、描述性分析必须标明，不得与确认性结果混排成同一级结论。
5. `laya − none` 的差异含“读得懂 vs 读不懂”成分，不能当作公平的学习比较（`RESEARCH_SUMMARY.md` §5.2）。
6. 先验价值只对“描述需要读懂”的世界成立，措辞须带条件（延迟、方言、训练档位）。

## 必须披露

- 留出词池在预注册 02、03、04 中被多次评估（只看汇总，未用于调参）；W5 事实方言为只评估一次的新池。
- 方言由作者撰写，三套同一作者；手写控制器阈值为开发期选定；测试方言已反复使用，只算开发集。
- 世界是模板化食物场景，模拟而非真实生物；Laya 为 421M 模型（ModernBERT-large + 微调决策头），吞吐不外推。
- 种子数小（多为 6–8），区间为种子间 bootstrap。
- 区分三个来源：先天（基因组，决策层初始参数）、后天（个体一生内学习）、Laya 感知（固定权重）。基因变异不等于 Laya 权重进化。
- 预言机/隐藏真值只用于度量上限，不进入个体输入——方法章节要明确写出。
- AI 协助写作按目标期刊/arXiv 的政策披露（`academic-paper` 的 disclosure 模式）；作者署名与声明以 `PUBLICATION_PLAN.md` §3 为准。

## 引用规则（最高优先级）

- **不得凭记忆或由模型生成引用。** 每条参考文献必须：①有可检索的 DOI/arXiv 编号/URL；②已读原文（或至少摘要+相关段落）；③确认被引处确实支持该论点。
- 未核对的条目在草稿中标 `[UNVERIFIED]`，定稿前清零。
- `docs/RESEARCH.md` 与 `docs/PRIOR_MODEL_SURVEY.md` 里的文献是检索线索，不是已核对引用。
- 主要对比对象：Yan et al.（ICLR 2025，LLM 作为强化学习动作先验）、Baldwin 效应的进化 + 学习文献；引用前仍需核对原文。
- 可使用 academic-paper 的 citation-check 与 `academic-research-skills` 的公开文献库查询（Semantic Scholar/OpenAlex/Crossref/arXiv，仅发送 DOI/标题）；查询结果同样要人工抽查。

## 流程约束

- 对外发布（上传 arXiv、公开仓库、投稿）需用户另行明确指示；本 skill 只产出草稿。
- 使用中文讨论，论文正文语言由用户决定（arXiv 默认英文，先确认）。
- 外部 skill 套件的许可证为 CC BY-NC 4.0：其文件不得复制进本仓库提交；本仓库只保存自己的草稿与本补丁。
- 图表由统一绘图脚本从原始结果生成，不手工改数。
