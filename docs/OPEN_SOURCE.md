# 开源复用调研与选型建议

首轮调研快照：2026-09-28，当时完成官方文档、仓库说明、部分依赖清单与许可证核查，尚未运行。以下候选表保留当时建议；后续实际选型和测量见下一段及 M0 结果。

2026-09-29 补充：P0 已使用 React 19.2.0、PixiJS 8.21.0、ECharts 6.0.0、Vite 8.3.1；M0 已运行 Laya 0.3.21、Gymnasium 1.3.0、SB3/SB3-Contrib 2.9.0 以及 TorchRL 0.14.0 组件探针。版本分别锁于 package-lock.json 与 requirements-m0.lock，证据见 [P0 记录](p0/VERIFICATION.md) 和 [M0 执行记录](m0/PROGRESS.md)。下文的版本与候选表保留首轮调研快照，不能覆盖本机实测状态。

## 1. 结论

有足够多的开源组件可以减少基础开发。优先复用渲染、图表、存储、RL 环境协议、算法基线和训练组件，把自研集中在生态规则、个体独立学习、世界与训练的一致性，以及成长体验上。

推荐起点：

- P0/M2：React 界面沿用原方案，世界画布优先 PixiJS，曲线用 ECharts，浏览器存档用 Dexie。
- M0：真实 Laya 官方接口，参考 Laya Playground 的集成方式；用 Gymnasium + SB3 建立最小任务基线。
- 路线 B：验证 TorchRL 的损失、轨迹与采集组件能否节省工作；不要默认采用共享策略的多智能体示例。CleanRL 作为可审查的算法实现参考。
- 多个体环境：优先借鉴 PettingZoo Parallel API 的接口与测试工具；长期出生死亡需要专门适配，不直接承诺完全兼容。
- 实验记录：先用本地 TensorBoard 查看训练指标，产品内用 ECharts 展示用户关心的变化；动作日志和完整学习快照仍由项目定义。
- 整体生态框架：Mesa 与 līlā 留作架构备选；当前不直接 fork 一个大项目作为基座。

节省范围明确，但尚不能估计节省多少天或百分比：省下的基础能力会被部分集成、生命周期与回放工作抵消，需用 M0 的小验证确定净收益。

## 2. 候选矩阵

“优先”表示进入验证名单，不表示已完成兼容验证。许可证按此次查看的仓库或文件记录，采用时还需固定版本并核对具体复制文件、权重和素材的来源。

| 项目与一手来源 | 许可记录 | 能省下什么 | 与本项目的边界 | 建议 |
| --- | --- | --- | --- | --- |
| [Laya](https://github.com/NandhaKishorM/laya) | Apache-2.0，权重以实际 checkpoint 为准 | 结构化动作偏好推理、现有批量接口 | 不自带我们的生态 RL、个体记忆和奖励 | 按原方案接入，M0 实测 |
| [Laya Playground](https://github.com/wdobry/laya-playground) | MIT；不包含 Laya 模型所有权 | 短状态到动作、服务、录制与回放的参考 | 展示站播放录制，本地才接真实模型；不能照搬网站录制作为我们的效果 | 选择性参考 |
| [Gymnasium](https://gymnasium.farama.org/api/env/) | [MIT](https://github.com/Farama-Foundation/Gymnasium/blob/main/LICENSE) | 单体任务协议、空间定义和检查工具 | 不提供生态逻辑，也不解决多体生命周期 | M0 基线优先 |
| [PettingZoo](https://pettingzoo.farama.org/api/parallel/) | [MIT](https://github.com/Farama-Foundation/PettingZoo/blob/master/LICENSE) | 同时行动的多体协议与 API 测试 | 环境协议不是训练算法；动态出生的 ID 范围需适配 | 多体接口候选 |
| [Stable-Baselines3](https://github.com/DLR-RM/stable-baselines3) | MIT | PPO/DQN 等基线、训练、评估和模型保存 | 常规模型管理不等于每个生物各有参数；保存模型不含完整生态快照 | M0 基线首选 |
| [SB3-Contrib MaskablePPO](https://sb3-contrib.readthedocs.io/en/master/modules/ppo_mask.html) | [MIT](https://github.com/Stable-Baselines-Team/stable-baselines3-contrib/blob/master/LICENSE) | 有限候选的非法动作屏蔽 | 当前文档明确不支持 recurrent policies；不能假定动作屏蔽和循环策略能直接组合 | 按需验证 |
| [TorchRL](https://github.com/pytorch/rl) | [MIT](https://github.com/pytorch/rl/blob/main/LICENSE) | 可组合的损失、价值估计、采集与缓冲组件 | TensorDict/批维与生命周期适配有成本；官方仍标注 beta，可能有破坏性变化 | 路线 B 组件候选 |
| [CleanRL](https://github.com/vwxyzjn/cleanrl) | [MIT](https://github.com/vwxyzjn/cleanrl/blob/master/LICENSE) | 容易审查和修改的单文件算法参考 | 官方说明并非供直接 import 的模块库；依赖不能原样并入当前栈 | 参考算法，不整套装入主应用 |
| [Avalanche RL](https://github.com/ContinualAI/avalanche-rl) | [MIT 文本](https://github.com/ContinualAI/avalanche-rl/blob/master/LICENSE) | 持续 RL 任务流和评估思路 | 现有 requirements 锁定旧版 Avalanche/Gym；当代依赖组合未验证 | 研究参考，暂不作核心依赖 |
| [Mesa](https://github.com/mesa/mesa) | [Apache-2.0](https://github.com/mesa/mesa/blob/main/LICENSE) | Python ABM 的空间、实体与数据收集基础 | 要让其成为权威世界，会改变当前 TS Worker 模拟方案；不直接带来我们的美术和学习系统 | Python 世界备选 |
| [PixiJS](https://github.com/pixijs/pixijs) | [MIT](https://github.com/pixijs/pixijs/blob/dev/LICENSE) | 2D 渲染、场景对象、事件与资源管理 | 不是生态模拟器；生命状态和学习逻辑不进入渲染树 | P0/M2 优先 |
| [Apache ECharts](https://github.com/apache/echarts) | Apache-2.0 | 曲线、缩放、提示与交互图表 | 不自动解释曲线因果，也不代替事件关联 | 成长和对照图表优先 |
| [Dexie](https://dexie.org/docs) | [Apache-2.0](https://github.com/dexie/Dexie.js/blob/master/LICENSE) | IndexedDB 事务、查询和版本管理 | 不自动保存 Python 优化器或完成跨进程原子快照；不需要 Dexie Cloud | 浏览器存储优先 |
| [TensorBoard](https://github.com/tensorflow/tensorboard) | Apache-2.0 | 本地训练曲线与诊断 | 面向开发者；不是产品的成长面板，也不是训练状态数据库 | M0 起按需使用 |
| [līlā](https://github.com/hellolifeforms/lila) | Apache-2.0 | 生态机制、性状与客户端分工参考 | 模型适配的不同层成熟度不同；整体接管有架构与回归成本 | 备选基座，先做小验证 |
| [LIFE](https://github.com/dominikvytisk/life-simulation) | 本轮未核实到清晰的项目许可证 | 浏览器生命观察、谱系和神经个体的产品参考 | 公开可读不等于已确认可复制；自身学习机制也不等同路线 B | 参考体验，暂不复制代码或资产 |

## 3. 维护与兼容性证据

不按星数推断稳定性。此次未能通过 GitHub API 获取统一的最近提交/归档数据：请求返回匿名限流。改用公开发布页、文档与原始依赖文件；没有可靠证据的项目不宣称“活跃维护”或“已停止维护”。

| 对象 | 本次可核实的信息 | 对采用的影响 |
| --- | --- | --- |
| SB3 | [发布页](https://github.com/DLR-RM/stable-baselines3/releases)展示 v2.9.0，包含 Gymnasium 范围调整及 PyTorch 最低版本变更 | 有具体发布与依赖维护证据；与 Laya 的组合仍需锁版本验证 |
| PettingZoo | [发布页](https://github.com/Farama-Foundation/PettingZoo/releases)展示 1.27.0，含注册接口变化与旧 API 弃用说明 | 不直接照抄旧教程的创建接口 |
| PixiJS | [发布页](https://github.com/pixijs/pixijs/releases)展示 v8.21.0 与变更说明 | 优先同一主版本的代码与文档，避免混用旧版教程 |
| TorchRL | [README](https://github.com/pytorch/rl)描述 0.13 周期与 beta 状态 | 可组合性较好，但需验证版本联动与迁移成本 |
| CleanRL | [pyproject.toml](https://github.com/vwxyzjn/cleanrl/blob/master/pyproject.toml)中读取到 Python `>=3.8,<3.11`、torch `2.4.1`、Gymnasium `0.29.1` | 这是依赖快照，不与 SB3 当前要求直接拼装；选定单文件参考后针对目标栈改造验证 |
| Avalanche RL | [requirements.txt](https://github.com/ContinualAI/avalanche-rl/blob/master/requirements.txt)锁定 avalanche-lib `0.3.1` 与 Gym `0.23.1` | 不能把“持续 RL”名称当作当前环境开箱可用；移植成本可能超过收益 |
| ECharts / Dexie / TensorBoard | 查到项目文档与许可，未完成本机版本组合验证 | 属于优先候选，安装时才确定版本和实际运行结果 |
| līlā / LIFE / Laya Playground | 项目说明提供功能与运行路径，但未独立复现 | 不把 README 行为声明或展示录像作为我们的性能与学习证据 |

上述版本仅记录调研页面所见，不是依赖锁文件，也不声称它们必然是所有渠道最新版本。Laya、训练库和 PyTorch 的 CPU/MPS 后端组合需用真实目标机器核实；不假定 CUDA 示例可以原样用于当前环境。

## 4. 哪些部分最值得复用

### 前端和原型：直接节省通用实现

PixiJS 负责画布与场景交互，ECharts 负责指标图表，Dexie 负责浏览器存储。我们实现领域状态到视觉的映射、生命体造型、事件关联、学习前后比较和对照操作。

P0 可以直接用这些候选中的必要部分做可点击界面，减少后续重做；不为了原型一次引入全部库。P0 的示例依旧醒目标识，UI 工具不会把示例变成真实学习。

### 强化学习：复用基线与组件，明确训练语义

SB3 适合快速确认简单任务、奖励和单体策略能否学习。TorchRL 适合需要控制轨迹、损失和个体状态的组合实现。二者先分别在小验证中比较，不一开始维护两个生产训练栈。

需要自己补的包括个体出生/死亡、每个体独立参数与优化器、Laya 偏好融合、候选映射、按模拟时间折扣、反馈归属、更新去重、跨组件检查点和 A/B/A 评估。

向量化多个环境来训练一套参数，与一个世界中每个生命拥有独立参数，是不同需求。不能把共享模型多智能体示例直接称作个体成长。

### 持续学习：复用方法，不许诺现成答案

此次未找到可以直接插入现有架构、同时满足长期出生死亡、个体隔离、变化环境与完整恢复的现成持续 RL 系统。Avalanche RL 可参考任务流设计；遗忘和可塑性问题仍按本项目的对照实验验证。

路线 B 不要求我们从数学公式重新发明 PPO；但训练器的默认重置、经验采集、记忆和保存行为必须被审查。跨时间的世界演化与优化器更新由项目协议约束。

## 5. 会影响架构的两个决定

### TS 世界如何接 Python RL 生态

当前权威模拟器拟为 TS Worker，常见 RL 工具运行于 Python。环境适配器必须调用同一套世界规则，不能为了训练再写一份不同的 Python 生态。

M0 简化资源任务可以用 Python 独立验证算法，但它只是能力与接口试验。进入 M1 前比较两条工程路径：

1. 保留 TS 模拟核心，让其能在浏览器 Worker 和无界面的 Node 进程运行，Python 通过批量本地协议驱动同一实现；衡量序列化与往返成本。
2. 若 Python ABM/RL 的复用收益明显更高，提出将权威世界迁至 Python、前端仅消费快照的具体方案；Mesa 可参与小范围验证。

当前不自动改架构。选择依据是最小验证的代码适配量、吞吐、状态恢复和浏览器体验，不是哪个库功能更多。若需要改变世界归属，先更新架构并按用户既定审核方式处理。

### PettingZoo 的动态生命身份

[Parallel API](https://pettingzoo.farama.org/api/parallel/)允许当前 agents 增减，但 possible_agents 和每个 agent 的空间有固定约束。无限世代的唯一生命 ID 不能直接假设完全满足该模型。

M0/M1 验证时使用有限、预声明身份或有界无繁殖实验，运行其 API 测试；长期繁殖需明确 adapter 的身份映射、终止事件与策略状态隔离。复用槽位不能让新生命继承死亡个体的优化器、经验或隐藏状态。若包装成本过高，保留项目原生多体协议，PettingZoo 只作为有限实验适配层。

## 6. 整体项目 fork 与轻量组合的比较

| 方式 | 潜在收益 | 代价 | 当前判断 |
| --- | --- | --- | --- |
| 直接 fork 类似人工生命项目 | 很快看到已有世界和界面 | 继承既有生态、学习、渲染和存储假设；许可证及数据来源待核实 | 暂不优先 |
| Mesa / līlā 作为基座 | 减少部分世界与数据基础设施 | 可能改变 TS 模拟架构，仍需实现个体学习与产品体验 | M0 的有条件备选 |
| 通用组件 + 小型领域核心 | 保留产品与实验边界，逐项复用 | 生态规则和关键交接仍需实现 | 当前优先 |

“世界基础设施可复用”不代表生态平衡、奖励、合作或持续学习效果已经被别人替我们解决。

## 7. 进入实际采用前的短验证

下表为首轮提出的验证规格。V1 已在 P0 完成；V2–V4 已在 M0 完成，当前选择 SB3-Contrib MaskablePPO 与同一 TS 核心的 JSONL 桥。TorchRL 保留为组件比较依赖，不作为第二套正式训练栈。V5 随 M3/M5 的浏览器存储实现验证。详见 [M0 审计](m0/ACCEPTANCE.md)。

| 验证 | 范围与产物 | 采用条件 |
| --- | --- | --- |
| V1 前端组件 | PixiJS 的选择/镜头与 ECharts 曲线切换，示例数据 | 能支持 P0 核心流程；组件版本与体积合理 |
| V2 最小 RL | Gymnasium + SB3 跑资源小任务，按需试动作掩码 | 环境检查通过，真实反馈可训练，终止/截断和保存语义明确 |
| V3 个体隔离 | 用选定训练组件运行两个独立小策略，只更新其中一个；接真实 Laya 偏好 | 另一方参数/优化器/经验不变；候选与策略概率可追溯；更新可恢复 |
| V4 世界桥接 | 同一 TS 核心的无界面进程与 Python 批量交互；若收益不足再试 Python ABM 小切片 | 不重复世界规则；实测吞吐与恢复足以支持目标规模 |
| V5 持久化 | Dexie 保存世界清单及学习检查点引用，导出完整恢复包 | 明确事务边界、容量、校验和缺失文件处理；浏览器 DB 不冒充完整训练存档 |

V2 不等于正式选定 PPO，V3 不等于学习有效性已得到证明。完成后只锁定实际使用的一个训练方案和必要组件，记录版本、来源、适配量、测量与弃选原因。

## 8. 采用后仍由我们负责的内容

生态能量账本与冲突规则、个体学习归属、奖励与延迟反馈、出生死亡、Laya 与小策略融合、训练和决策版本、完整快照、原生世界与 RL 适配一致性、成长证据，以及可理解的产品体验。

这些是项目价值和主要风险所在；复用应让时间集中到这些工作上。
