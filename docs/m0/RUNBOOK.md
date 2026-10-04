# M0 本地运行手册

目标机器为 Apple Silicon。本机已运行的版本固定在 `requirements-m0.lock`；该锁文件含本轮库比较依赖，不代表所有库都会进入正式应用。所有命令从项目根目录执行。

## 环境与模型

```sh
python3 scripts/setup_m0.py
USE_TF=0 .venv/bin/python services/m0/download_model.py --repo convaiinnovations/laya --revision 55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851
```

下载器将写出 `experiments/m0/model-manifests/laya.json`。本次选择清单为 `experiments/m0/model-manifest.json`，两者在选定版本下内容一致；也可通过 `M0_MODEL_MANIFEST=experiments/m0/model-manifests/laya.json` 明确选择。模型保存在 `.models/`，不上传到 Git；下载器记录原始文件 SHA-256、字节数与模型卡许可。

本轮先比较了多语言 checkpoint，再选择英文 checkpoint；不同时常驻两份模型。SDK 对 tokenizer 的兼容修正发生在隔离的运行副本，不改原始下载。`USE_TF=0` 与离线标志为进程环境变量，不修改系统配置。

## 无模型检查

```sh
npm ci
npm run check:m0
npm run test:m0
.venv/bin/python -m pytest -q tests/test_m0_python.py
.venv/bin/python services/m0/bridge_benchmark.py
```

这些测试不下载或调用模型。故障注入使用标记清楚的测试 provider，仅用于错误路径；它们不计入真实模型证据。繁殖、竞争等 M1 机制没有在此环境中实现，不在本轮测试中伪造通过。

## 模型与学习实验

```sh
USE_TF=0 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 .venv/bin/python services/m0/model_evaluation.py --split all --label selected-english-rerun --benchmark
USE_TF=0 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 .venv/bin/python services/m0/run_experiment.py --pilot --output experiments/m0/evidence/pilot-rerun
USE_TF=0 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 .venv/bin/python services/m0/run_experiment.py --output experiments/m0/evidence/experiment-rerun
```

正式实验读取 `experiments/m0/config/learning.json`，使用三组训练种子和三组留出世界；`--pilot` 只使用开发种子 71/72 与 64 步预算，不参与正式收益结论。学习实验拒绝复用已有输出目录，保留每次运行原始日志。模型情境脚本的 label 也应使用新名称，避免覆盖历史证据。

每个体独立 PPO、参数、优化器、rollout 和 RNG；模型推理可批量执行。固定 Laya 采用模型返回动作，个体策略按自身合法分布采样。B 将完整 Laya 偏好作为小网络输入，允许小网络学习覆盖或忽略偏好；没有手写优先执行 Laya 的规则。无 Laya 组相应特征为零。该选择需通过对照判断价值。

原始 `*-decisions.jsonl` 保存真实模型输入输出、动作、执行后果与快照；checkpoint 含世界与独立学习状态。当前 runner 不提供整个实验中断后自动续跑的 CLI；恢复语义通过测试验证，失败运行须保留并另开尝试，不能假装从断点成功续跑。Torch 检查点只加载本项目生成且来源可信的文件。

## 本地服务与离线验证

```sh
USE_TF=0 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 .venv/bin/python services/m0/offline_probe.py
USE_TF=0 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 .venv/bin/python services/m0/http_probe.py
USE_TF=0 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 .venv/bin/python services/m0/joint_probe.py
USE_TF=0 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 .venv/bin/python services/m0/serve.py
```

服务只绑定 `127.0.0.1:8765`，提供 `/health` 和 `/decide`；不持有世界、不进行训练。并发忙碌或推理失败返回显式错误，不替换成规则。离线探针在该 Python 进程内禁止 socket 外连并启用 SDK 离线模式，不会切断用户的系统网络。两项真实集成结果以执行记录为准，命令存在不表示已验证。

HTTP 探针会临时占用 8765/8766，验证完成后关闭自己启动的服务，不终止已有进程；端口占用时显式失败。联合探针在 1/8 个独立世界分别运行 33 步，每个体完成一次更新。模型实验与这些探针顺序运行，避免同一台机器额外驻留多份权重影响预算测量。

## 结果分析与恢复审计

```sh
.venv/bin/python services/m0/summarize_experiment.py experiments/m0/evidence/experiment-01
.venv/bin/python services/m0/diagnose_behavior.py experiments/m0/evidence/experiment-01
.venv/bin/python services/m0/audit_records.py experiments/m0/evidence/experiment-01 --checkpoint experiments/m0/evidence/real-resume-source.pt
```

汇总按预定判据读取全部种子。行为诊断是明确标识的事后分析，不用于更换通过标准。动作审计重新执行记录动作、逐条比较完整 transition；恢复审计读取本轮在第 256 步保留的真实检查点，使用匹配观测的原始模型记录，比较两条独立恢复分支的下一次参数更新和执行。此处不重新推理，不把重复使用的模型记录当成新调用。

新实验若需要相同恢复审计，须在结束前保留一个仍存活的中途检查点，并通过 `--checkpoint` 指向它。runner 每 32 步原子更新当前检查点，但不会自动保留全部历史版本。

## 只读展示

实验结束后导出记录，再启动前端：

```sh
.venv/bin/python services/m0/export_view.py experiments/m0/evidence/experiment-01
npm run dev
```

打开 [运行记录](http://127.0.0.1:5173/m0/index.html)。开发服务器需要完整的 `index.html` 路径。导出读取真实日志，不重新运行模型或生成事件；三种外形仅改变绘制，不能改变记录。页面与原始 P0 动效页分别标记数据来源。正式结果完成后用其目录重新导出。

正式结果已导出为 27 条轨迹、8066 帧。生成报告配图的可选依赖与算法运行依赖分开：

```sh
.tools/bootstrap/uv-0.12.19.data/scripts/uv pip install --python .venv/bin/python -r requirements-m0-analysis.lock
.venv/bin/python services/m0/plot_results.py experiments/m0/evidence/experiment-01
```

图表包含每个预定种子，死亡后不填补曲线。`http_probe.py` 使用 loopback 无代理客户端，以免系统代理把本机请求送到外部；不修改系统代理设置。真实服务检查与联合预算已通过，详见 [结果](RESULTS.md)。

## 结论边界

M0 是接口、能力和预算预研；负结果照样记录。简单明确情境的准确率不能证明生态策略有效，参数更新不能证明学习收益，吞吐不能直接换算为已支持的生命体规模。最终状态和逐项证据见 [完成审计](ACCEPTANCE.md)。
