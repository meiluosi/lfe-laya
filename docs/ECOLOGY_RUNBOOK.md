# 共享生态运行手册

更新：2026-10-01。对应 `/lab.html`，历史 P0 与 M0 保留各自入口。当前工程已可运行，完整实验矩阵和最终验收仍进行中；本手册不代表学习收益已通过。

## 启动与模式

在项目根目录运行前端：

```sh
npm ci
npm run dev -- --port 5173 --strictPort
```

打开 <http://127.0.0.1:5173/lab.html>。默认规则模式不需要 Python 或模型服务。推荐先单轮，选择生命、跟随，暂停后使用营养、障碍、擦除工具；滚轮缩放，拖动画布平移，全景恢复镜头。三种体型仅用于辨认，不预设智力或行为。实验详情内可开启“减少装饰动效”，画布同时遵从系统的减少动态效果偏好，真实世界继续正常推进。

本机已有 `.venv` 与本地 Laya 权重；安装来源、锁定依赖与模型准备见 [M0 运行手册](m0/RUNBOOK.md) 和 [本地 Laya](LOCAL_LAYA.md)。启动真实服务：

```sh
USE_TF=0 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 .venv/bin/python services/ecology/serve.py
```

服务仅监听 `127.0.0.1:8767`，前端由 Vite 转发 `/api`。加载期间等待就绪；`/health` 报告模型来源和状态。不要同时启动两份服务或在同一 GPU 上叠加完整实验与交互推理。

如果只想检查真实独立 PPO、恢复和前端接口，可明确选择不加载 Laya：

```sh
.venv/bin/python services/ecology/serve.py --without-laya
```

该服务只支持“独立小网络 · 无 Laya”及其暂停学习模式；固定 Laya 请求会失败，不会自动伪装成规则或模型输出。

| 页面模式 | 实际行为 |
| --- | --- |
| 规则大脑 / 随机合法策略 | 本地确定性规则或受控随机动作，无训练 |
| 固定 Laya · 当前观测 | 真实本地推理，屏蔽地点记忆，不更新权重 |
| 固定 Laya · 有限记忆 | 同一固定模型，加入有限地点记忆 |
| Laya + 个体学习 | 固定 Laya 提供偏好，每个个体独立 PPO 更新 |
| 独立小网络 · 无 Laya | 同预算独立 PPO，不调用 Laya |
| 暂停学习 | 冻结参数、优化器与训练计数；世界仍可继续行动 |
| 规则降级 | 用户显式选择的规则替代，记录保留降级来源 |
| 回放 | 执行已录制动作，不推理、不训练 |

“暂停世界”保留正在请求的结果但不提交下一轮。学习事务未结束时，先明确取消才能修改世界。提交确认丢失时重试同一事务，不能创建一笔新奖励。冻结与恢复学习会清除未训练的部分 PPO 批次，避免将冻结期间前后的经历误接成连续训练轨迹；已经完成的训练与世界记忆保留。

## 保存、恢复与比较

- **保存到本机**：保存动作记录至当前浏览器 IndexedDB；最多 32 条保存、总量 256 MiB。浏览器清理可能移除数据，重要记录另行导出。
- **导出记录 / 导入记录 / 校验回放**：JSON 包含初始世界、实际请求与动作、反馈及终态；严格回放逐轮比较固定模拟版本。动作日志不能继续训练。
- **保存完整学习状态**：服务保存世界、独立参数、优化器、部分经验、随机状态及模型身份；可下载 `.pt` 文件，后续导入并恢复为新世界。仅接受安全张量/基本容器，不执行任意 pickle。每包最多 256 MiB，服务检查点目录总额 2 GiB。
- **创建对照分支**：复制当前完整边界与随机状态，改变一个控制器或环境参数。学习分支基于完整检查点并暂停学习。最多保留四个分支；只有当前分支推进，表格时间不同不能直接比较。
- **导出比较**：包含各分支来源、配置、完整动作记录与结果。一次分支只说明这组初始条件，不等同于多种子收益。

未导出的世界与内存学习状态会在页面/服务重启后丢失；已落盘检查点不受服务重启影响。学习检查点位于 `.runtime/ecology/checkpoints/`，不入版本控制。服务最多同时保留八个学习运行，刷新页面可能遗留旧运行；先保存、下载再重启服务，不把刷新当成恢复训练。

## 故障与停止

模型超时或返回无效数据时，页面显示失败且世界保持在当前提交边界。普通模型请求可重试失败部分，也可显式切换规则降级；学习反馈失败只能重试该事务或按页面允许的方式取消。不要靠连续点击“开始”覆盖错误。事务进行中，重置、分支、恢复和干预会被阻止或串行执行，旧响应不应污染新世界。

当前录制上限为 2000 条、约 64 MiB 的完整前缀；达到阈值停止推进，先导出，不滚动覆盖并声称完整保存。事件面板只展示最近 512 条，种群曲线最近 400 个采样点；导出保留录制范围内的实际事件。个体和谱系容量达到上限时不再产生新生个体；退休学习策略超过 512 个时提交失败，需保存后开始新实验。各项容量不无限累积。

停止前先暂停世界并处理未完成事务，再保存所需记录/学习状态。终端中止前端或服务即可停止对应进程；无自动对外部署。实验进程与交互服务相互独立，停止页面不会停止无界面实验。

## 实验与验证

实验方案和预先冻结的门槛见 [共享生态实验方案](ECOLOGY_EXPERIMENT.md)。下面命令需要选择不存在的输出目录；脚本拒绝覆盖已有尝试，失败日志保留，不能把部分输出当成完成矩阵。

```sh
.venv/bin/python services/ecology/experiment.py experiments/ecology/config/development-features.json experiments/ecology/evidence/my-development-run
.venv/bin/python services/ecology/grouped_experiment.py experiments/ecology/config/development-residual.json experiments/ecology/evidence/my-residual-run
```

残差与留出配置中的检查点路径绑定本轮指定开发运行；复制实验时先显式修改新的配置副本，保留训练来源与哈希，不让“新实验”暗中读取旧训练产物。`heldout-01.json` 是本轮已经预注册的固定评估，不用留出结果反复调参。

分析与严格重放分别运行：

```sh
.venv/bin/python services/ecology/analyze.py experiments/ecology/evidence/development-features-01
.venv/bin/python services/ecology/verify_recording.py experiments/ecology/evidence/development-features-01/development-features-01-learning-313
```

分析会明确是否完整；重放不加载 Laya、不训练，但使用当前锁定 Python 依赖。原始源码、版本、模型身份、请求、执行结果、训练状态和失败尝试共同构成证据，只有摘要不够。

本地无模型检查：

```sh
node --test tests/ecology.test.mjs tests/session.test.mjs tests/history.test.mjs
.venv/bin/python -m pytest tests/test_ecology_python.py tests/test_ecology_learning.py tests/test_ecology_service.py tests/test_ecology_experiment.py -q
npm run build
```

这些测试验证工程不变量，不证明 Laya 理解情境或学习改善。模型能力、浏览器实际交互与多种子留出结果另行验收。性能仅报告本机、本规模实测；不外推为几十个体墙钟实时学习。

## 服务观测（2026-10-02）

`GET /health` 返回模型状态、学习运行数、检查点用量与各端点延迟统计；访问日志写到服务标准输出（`.runtime/ecology-service.log` 若按旧方式重定向）。检查点目录可用环境变量 `LFE_CHECKPOINT_DIR` 覆盖，端口用 `--port`。服务忙时请求最多排队 30 秒再返回 503。
