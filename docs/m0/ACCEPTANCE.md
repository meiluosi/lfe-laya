# M0 完成审计表

状态：**已完成 M0 技术预研与预定实验，2026-09-29**。按原阶段范围核对；工程通过、探索性收益与完整持续学习分别表述。结果与预算见 [RESULTS](RESULTS.md)，重跑命令见 [RUNBOOK](RUNBOOK.md)。

以下原始证据均位于 `experiments/m0/`。7 项 TS 测试、8 项 Python 测试、类型检查、生产构建和实际浏览器走查已完成。

| 原要求 | 权威证据与实际验证范围 | 结论 |
| --- | --- | --- |
| 环境、SDK/checkpoint、许可、下载与资源 | evidence/environment.json、dependency-licenses.json、requirements-m0.lock、model-manifests；integrity-check.json 校验原始模型文件 | 已验证；独立 Python 3.12，未修改系统 Python |
| 真实本地推理与设备、输入输出 | real-smoke.jsonl、selected-english/model-context-results.jsonl、experiment-01/*-decisions.jsonl | 已调用真实 Laya MPS；无 CPU 回退或规则替代 |
| 局部输入、有限候选、provider 与错误契约 | world-tests.txt、python-tests.txt；白名单、候选映射、过期/重复/非法请求拒绝 | 已验证；全局位置、日程与其他个体隐藏信息不进入模型 |
| 30–50 情境、开发与留出分离 | 36 情境，每半 12 明确题 + 6 无唯一答案策略题；开发比较后选择英文模型 | 已完成；明确题留出 12/12，模板覆盖很窄，限制已披露 |
| 冷/热、批量 1/8/16/32/48、内存与失败 | selected-english/model-benchmark-raw.jsonl、model-evaluation-summary.json；offline-probe.json | 每档三次；脚本开始到冷首次执行 27.08 秒；内存口径分开 |
| 离线缓存与真实本地执行 | offline-probe.json：Python socket 外连被拒绝、SDK 离线标志、真实 accepted transition | 已验证进程级条件；未声称关闭 OS 网络 |
| HTTP 健康、失败、显式重试 | http-probe.json、http-probe-rerun.log：实际 loopback 服务、缺模型/忙碌 503、输入 422、恢复成功、迟到与重复提交拒绝 | 已验证；代理导致的首轮失败保留在 post-validation.log |
| 最小世界、能量与后果 | 同一 TS MicroWorld、能量账本、真实 transition、世界测试 | 已验证；不包括繁殖、竞争等 M1 机制 |
| 真实偏好与真实反馈驱动独立更新 | experiment-01/report.json、原始记录、检查点：B 与无 Laya 各 36 次更新 | 已验证工程闭环；参数更新不是单独的收益证据 |
| 个体参数/优化器/经验/RNG 隔离 | Python 测试；record-audit.json 的六个真实检查点 | 更新甲不改变乙；恢复后更新和下一步行动一致 |
| 冻结、去重、过期 revision 与失败回滚 | Python 专项测试；真实恢复审计；正式 12 条冻结轨迹参数未变；frozen-optimizer-audit.json 核对全部 9 个留出检查点的参数/优化器/revision | 已验证；模型与冻结评估不训练 |
| 奖励、算法、预算及预定标准 | config/learning.json、frozen-sha256.json、experiment-01/source-sha256.json、integrity-check.json | 配置未变；实际实验运行源码一致，旁路工具变更如实列出 |
| 六种在线对照、冻结留出、多种子与失败保留 | 18 条在线 + 9 条留出轨迹，8066 次动作；完整 report/analysis 与曲线 | 已完成；不删死亡，不把开发试跑算收益 |
| A/B/A、适应/保留/遗忘与成本 | 每阶段均奖、20 步窗口、返回 A 代理指标、全体能量曲线、实际耗时 | 已按预定指标报告；没有充分证据宣称持续适应，未虚构恢复时间 |
| Gymnasium/SB3 与 TorchRL 复用比较（V2/V3） | library-probe/report.json：512 步真实 TS 反馈训练、掩码/恢复；TorchRL loss/gradient 探针 | 选择 SB3-Contrib；未把组件探针当作两库效果排名 |
| TS/Python 桥接与世界一致性（V4） | bridge-benchmark.json；record-audit.json 全部 8066 次 transition 相同 | 已验证；没有第二份 Python 世界规则 |
| 完整学习状态续接 | 第 256 步真实 source checkpoint、六个实例的优化器/经验/RNG 恢复与后续更新 | 已验证同一运行时；当前无整个长实验自动续跑 CLI，不承诺跨硬件逐位复现 |
| 联合推理/训练预算，默认规模与频率 | joint-probe.json、joint-1/8.jsonl、config/runtime-budget.json | 1/8 实例 × 33 步并更新；后续初始预算 8，每模拟秒一次决策，墙钟不保证实时 |
| 只读真实展示与三种外形（M0-F） | public/m0/index.html、latest.json、export-audit.json、UI_VERIFICATION.md | 27 条轨迹/8066 帧与原日志一致；浏览器验证播放、暂停、单步、死亡、皮肤、入口及窄屏 |
| 可重跑命令、版本、来源、限制与文档 | RUNBOOK、RESULTS、依赖锁、清单、源码摘要；README/实施/学习/架构同步 | 已交付；没有自动提交、发布、部署或扩展 M1–M5 |

## 收益判据的结论

- B 对初始化冻结 B：平均奖励差 +0.6533，3/3 正差，死亡不增加，达到预定探索性门槛。
- B 对无 Laya 学习器：平均差 +1.6727，2/3 正差、1/3 数值并列，死亡 0/3 对 1/3，达到同一门槛。均值明显受种子 703 的死亡影响。
- 世界种子配对，探索 RNG 延续不同历史；三个种子不是统计显著性证明。场景宽松、奖励受末尾能量影响、简单情境覆盖不足等限制见 RESULTS。
- M0 的完成不代表 M5 持续学习目标完成，也不自动通过全部 P0/M1 进入条件。算法改进建议作为下一轮草案保留。
