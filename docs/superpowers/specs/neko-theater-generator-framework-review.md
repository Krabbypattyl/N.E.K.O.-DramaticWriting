# 本地剧本工坊后台框架与结构审查

## 范围与结论

状态：**IB-01—04 已处理，匹配回归通过**；本地 Store 同步完成 WS-01 原子导入。实际优化与验收边界统一见 N.E.K.O [问题与处理 2.125](/Users/mac/Code/N.E.K.O/docs/design/neko-theater-issues-and-solutions.md)。下文保留优化前的审查证据、行号和建议；“当前”“本轮”及末尾检查数量均指审查时点，不是现行待办。未修改正式作者项目、模型设置文件或正式包。

审查基线为 InkAI- `main`、HEAD `475f470` 之上的**当前磁盘代码**。仓库已有大量修改、删除和未跟踪文件，全部保留；HEAD 本身不代表当前 Numeric v2 实现。依据为[生成器开发文档](./2026-08-06-neko-theater-numeric-v2-generator-design.md)第 1—20 节及当前调用链，历史实验编号不作为本轮自动实施授权。

检查入口包括 `start_web.py`、`theater_generator/api.py`、`numeric_v2*.py`、`generation/*`、`neko_v2_bridge.py`、`base_agent.py` 和 `config.py`。前端只用于核对后台接口消费者；Story Package 公共字段合同由公共结构审查负责。

| 编号 | 优先级 | 已确认的结构问题 | 实际影响 |
| --- | --- | --- | --- |
| IB-04 | P2 | 发布前提散落于多个入口，安装入口少了一组条件 | 未编译、未复验的编辑稿仍可进入安装桥 |
| IB-01 | P2 | 通用 JSON 修复越过语法边界修改字符串内容 | 格式错误被修复时，正文或固定原文可能同时被改写 |
| IB-02 | P2 | 无生产消费者的全局 token 账本仍在默认执行路径中 | 常驻服务持续保留每次调用记录，且不能形成当前请求结果 |
| IB-03 | P2 | 模型设置的内存副本和持久文件分别提交 | 保存报错后，本次进程已经开始使用新配置 |

这里的 P2 表示应纳入正常修复排期；本轮没有据此扩大到模型效果优化或整体重构。

## IB-04：发布前提重复维护，安装入口与导出、状态推导不一致

**状态：已统一发布前提检查；以下为优化前证据。优先级：P2。**

### 证据与调用链

- [API 的复验入口](/Users/mac/Code/InkAI-/theater_generator/api.py:783)在调用桥之前要求 `compile_result.success` 且 revision 当前有效（第 789—792 行）。
- [API 的导出入口](/Users/mac/Code/InkAI-/theater_generator/api.py:800)再次独立判断编译成功、当前 revision 和复验 hash（第 803—813 行）。
- [API 的安装入口](/Users/mac/Code/InkAI-/theater_generator/api.py:823)仅比较 `validation.get("package_hash") != compiled_result.get("package_hash")`（第 829—833 行），未要求两份结果存在、编译成功和 revision 当前有效。
- [项目状态推导](/Users/mac/Code/InkAI-/theater_generator/numeric_v2_project_store.py:242)有另一套成功、revision、hash 条件（第 250—262 行）；[记录安装结果](/Users/mac/Code/InkAI-/theater_generator/numeric_v2_project_store.py:728)也不补验上述发布前提。
- 真实消费者是 [publish-panel.js](/Users/mac/Code/InkAI-/frontend/theater/src/publish-panel.js:48) 的下载、安装按钮及第 69—76 行操作。按钮禁用依赖项目状态，不能替代后台的入口合同。

链路为：`编辑稿 → /install → bridge.install(story) → record_install`。当两份结果都是 `null` 时，API 都转换成空字典，两个 `.get()` 都是 `None`，比较结果相等，因此放行。

### 隔离复现

使用现有 `tests/theater_generator/numeric_v2_fixture.py:numeric_v2_story()`，在临时根目录创建项目并通过 store 保存正文；不执行 compile 或 validate。将 `numeric_v2_bridge.install` 替换成只记录调用、不写包的伪桥，再通过 Flask `test_client` 请求同一项目：

```text
status = editing
compile_result = null
neko_validation = null
GET /export  → 422 current_neko_validation_required
POST /install（当前 base_revision）→ 200，伪 install 被调用 1 次
```

这证明后台的作者发布流程可被绕过。**没有证明非法包能越过 N.E.K.O 编译器**：[真实桥](/Users/mac/Code/InkAI-/theater_generator/neko_v2_bridge.py:94)仍执行带 `--install` 的本体 CLI，最终合同复验继续存在。

### 最小精简建议与保留边界

把“当前项目可交付”的现有前提收敛到一个小型内部检查函数，由导出和安装共用；状态展示可消费相同的纯判断。先补齐存在性、成功、revision、非空 hash 等条件，再明确重复编译与最终安装复验各自职责。无需增加发布状态机或另一套缓存。

保留作者显式安装、CLI 隔离、本体写入前复验、不覆盖同 ID 包和 revision 冲突保护。不要为了减少重复工作删掉最终复验，也不把这项直接扩大为作者目录迁移或 SDK 改造。

**后续验证：** 同一批未编译、编译失败、复验缺失、旧 revision、hash 不匹配和有效项目同时验证 export/install；所有不满足条件的情况，桥调用次数必须为零。有效安装仍须验证正式写入前复验和失败不记成功结果。

## IB-01：JSON 自动修复承担内容改写，损坏正文后仍返回成功

**状态：已同步两端字符串保护；以下为优化前证据。优先级：P2。**

### 证据与调用链

[BaseAgent.parse_json_response](/Users/mac/Code/InkAI-/base_agent.py:435)先尝试标准 `json.loads`，失败后提取 JSON 片段并进入 `_fix_json_format`（第 464—472 行）。修复链在 [第 515 行](/Users/mac/Code/InkAI-/base_agent.py:515)对整个 JSON 字符串执行 `re.sub(r',(\s*[}\]])', r'\1', s)`，没有区分语法标点和字符串内容。后续只检查能否解析，不核对文本是否被改。

生产消费者包括 [主线初稿与续写](/Users/mac/Code/InkAI-/theater_generator/generation/numeric_v2.py:1640)（第 1640、1678 行）、节点完善（第 1989 行）及支线模型输出（第 2064 行）。主线模型结果还会投影 `fixed_narrations`，因此同一通用恢复机制能够作用于要求保留原文的字段；字段结构合法并不能发现字符串已被篡改。

### 精确触发与对照

以 AST 提取当前 `BaseAgent` 类，仅执行解析代码，不构造模型客户端。完整触发输入为：

```json
{"fixed_narrations":[{"text":"记录原文：,}；,]"}],}
```

这是**外层存在尾逗号的非法 JSON**，首次 `json.loads` 因此失败。通用修复同时删除外层尾逗号和 `text` 中两处逗号，最终得到：

```text
text = 记录原文：}；]
parse_error = false
```

对照输入删除外层尾逗号、保持相同 `text`，首次 `json.loads` 成功，原文完整保留。因此问题不应表述为“所有合法 JSON 都会被修改”，也未声称真实模型已经在具体作者稿中触发此样本。

### 最小精简建议与保留边界

先将修复职责收窄为不改字符串值的、可证明安全的语法处理。保持普通 JSON 和代码围栏提取；尾逗号等修复必须识别字符串边界，无法无损修复时返回现有解析失败，让生成器使用现有有界恢复预算。不要继续叠加猜测原文的正则，也不要另增模型修复阶段。

保留已有显式续写、固定旁白原文规则和正常 JSON 兼容。不能直接删除所有恢复能力来代替判断哪些修复可安全保留。

**两端影响：** N.E.K.O [sdk/json_response.py 第 88 行](/Users/mac/Code/N.E.K.O/theater_workshop/sdk/json_response.py:88)保留同一正则，[sdk/model.py](/Users/mac/Code/N.E.K.O/theater_workshop/sdk/model.py:54)由 `ModelAgent` 继承该解析器。这是同源问题，主立项保留在 IB-01；修复需同步核对 SDK，而不是只更新 InkAI 的解析器。质量评分的独立 `_parse_response` 使用标准 `json.loads`，不能未经核实扩大影响范围。

**后续验证：** 对两端执行同一组合法、带围栏和有限格式错误样本，覆盖普通正文及固定旁白内的 `,}`、`,]`、引号、反斜杠、换行；被接受的候选字符串必须逐字等于原输入中的对应值，无法做到时显式失败。保留已有多处缺失分隔符测试作为兼容对照。

## IB-02：旧全局 token 账本已无生产消费者，仍无界积累

**状态：已限制全局记录窗口，保留请求 capture；以下为优化前证据。优先级：P2。**

### 证据与调用链

[BaseAgent](/Users/mac/Code/InkAI-/base_agent.py:172)同时保留进程级 `_token_usage_records`、锁及请求级 `ContextVar`。所有成功响应通过第 257 行 `_record_token_usage`、无 usage 的失败通过第 263 行 `_record_unreported_attempt`，最终都到 [第 342—350 行](/Users/mac/Code/InkAI-/base_agent.py:342)：

1. 无条件向全局列表追加一份记录；
2. 开启 capture 时再向请求列表追加一份。

对当前磁盘生产 Python 代码搜索 `capture_token_usage / reset_token_usage / get_token_usage / summarize_token_usage / summarize_token_records`，除基类定义和其内部互调外无调用者；实际消费者位于测试文件。当前 `start_web.py → create_app → NumericV2Generator/NumericV2QualityAssessor` 没有请求结束时读取或释放全局记录的入口。注释中的旧 CLI 全流程不在当前磁盘生产代码中。

### 隔离复现

通过 AST 提取类，不创建模型客户端、不开启 capture，向真实 `_append_token_record` 连续提交 1000 条伪调用记录：

```text
capture_active = false
retained_records = 1000
```

这是保留对象数量的确定性证据；未进行长时间运行或内存耗尽压测，不声称当前服务已经发生 OOM。

### 最小精简建议与保留边界

明确当前需要的计量出口，再保留一种有生命周期的收集方式。可以让 Web 操作显式 capture 并返回/记录该次汇总；若外部诊断脚本仍依赖进程级 API，则把全局累积改为显式开启或有界保留，不让所有正常请求默认无限累积。无需引入遥测后台或新数据库。

保留成功/失败均计数、缺报标识、并发隔离及安全诊断，不删减统计含义。仓库外历史实验脚本未穷举，因此不能仅凭生产代码无调用就删除公开统计方法。

**两端分化：** N.E.K.O [sdk/model.py 第 68—81 行](/Users/mac/Code/N.E.K.O/theater_workshop/sdk/model.py:68)只在活动 capture 内追加 usage，没有这个默认全局列表。SDK 的局部计量提供了现成生命周期参照，不代表 InkAI 必须连带迁移模型配置入口。

**后续验证：** 未开启采集时重复伪调用不增加常驻历史；开启采集时保留准确的成功、失败和缺报统计；并发请求互不混入，结束后可释放。兼容性检查覆盖实际仍使用统计 API 的诊断入口。

## IB-03：模型配置有两份可变真源，持久化失败仍改变当前模型

**状态：已调整磁盘与内存提交顺序；以下为优化前证据。优先级：P2。**

### 证据与调用链

[get_model_config](/Users/mac/Code/InkAI-/config.py:170)每次读取持久文件，再用 `_runtime_config` 覆盖（第 174—178 行），因此内存不是文件的只读缓存，而是另一份优先级更高的可变配置。

[configure_model 第 218—229 行](/Users/mac/Code/InkAI-/config.py:218)先修改 `_runtime_config` 和 `_runtime_provider`，随后才调用 `_write_persisted_model_config`。写盘出错时没有回滚已生效的内存值。API 的 [PUT 模型设置入口](/Users/mac/Code/InkAI-/theater_generator/api.py:348)只处理参数校验和 `ValueError`；I/O 失败会返回错误，但下一次 [BaseAgent._refresh_model_config](/Users/mac/Code/InkAI-/base_agent.py:188)会读取此前已经更新的内存配置。

链路为：`设置页保存 → configure_model 改内存 → 写盘失败 → UI 请求失败 → 下一次模型调用读取新内存配置`。重启后又只能读取旧文件/环境值，形成不同结果。

### 隔离复现

在仓库外临时目录设置 `NEKO_NUMERIC_DRAMA_MODEL_SETTINGS_PATH`，使用虚构密钥及模型名。只把持久化函数替换为抛出 `OSError` 的函数，不创建真实模型、不写用户设置：

```text
configure_model(..., model="review-rejected-model") → OSError
get_model_config()["model"] → review-rejected-model
settings_file_exists = false
```

因此“保存失败但当前进程已切模型”是当前实现结果，不是对磁盘出错概率的推测。

### 最小精简建议与保留边界

在局部变量中解析完整新配置，先完成持久化，再更新内存；或使内存严格成为已成功持久化配置的缓存。先修两份状态的提交顺序，再判断是否需要取消每次读文件后的重复覆盖；无需增加新配置系统。

保留独立设置界面、环境变量和旧路径兼容、密钥不回传以及文件权限约束；不把本地工坊改成使用聊天模型，也不修改用户已有配置。与实际持久化行为相反的 `ModelSettingsPayload`“只保存在当前服务进程”注释（api.py 第 220 行）应在实施时一并校准，但文案过时本身不另算一条问题。

**后续验证：** 写入失败时内存与持久配置均保持原值，API 返回稳定错误；正常保存立即生效，重启后值一致；切换 provider、空密钥复用和旧路径兼容继续通过。不使用用户真实密钥进行故障注入。

## 必要复杂度与排除项

- **保留独立 Web、Flask、模型设置及 CLI 桥。** 设计明确允许原工作台继续存在；桥用独立解释器避免两仓库 `config/utils` 顶级模块缓存串包，不能仅凭多进程或层数判为过度设计。
- **不把所有“编译后再复验”当作冗余。** 写入前重新调用本体编译器是现行门禁。本轮确认的是发布前提散落并漏检，不批准删除最终复验或改变用户交付流程。
- **保留 branch prepare/finish/build 和 store 原子应用边界。** 它们隔离模型草稿、作者确认、固定 ID/互补条件与正式 revision；不是仅靠方法数量判断应合并。
- **保留事实、证据、文学、方案复核和受限节点修订的分工。** 各有当前消费者和禁止自动触发的业务边界；本轮未依据文件数量建议合成一个模型调用。
- **共享复制是维护成本，不自动等于当前缺陷。** 静态 AST 对照忽略导入、文档字符串和基类适配后，`numeric_v2_analysis.py` 及 `generation/evidence.py / facts.py / plan_review.py / repair.py / runtime_rules.py` 行为体一致。其余模块存在宿主、模型、store 适配差异，不能机械覆盖。InkAI 尚未改为 SDK 薄适配，本轮不启动迁移。
- `BaseAgent.validate_input/handle_error` 等目前缺少生产调用的旧助手方法，以及重复的 HTTP 错误类别枚举，只作范围观察。尚无足够高价值影响，不为凑数另立问题；更不能因此恢复或删除工作区已有文件。

## 已执行检查与未验证范围

四项隔离探针保存在仓库外：[probe.py](/var/folders/ht/z3xhrlbn76qdzmchn47tsyqc0000gn/T/inkai-framework-review-uyl8ofsb/probe.py)、[result.json](/var/folders/ht/z3xhrlbn76qdzmchn47tsyqc0000gn/T/inkai-framework-review-uyl8ofsb/result.json)。脚本只导入当前代码、提取解析类、使用临时项目根和伪安装桥；断言用于证明当前问题存在，修复后应改为对应保护断言。可用 InkAI 的 `.venv/bin/python -B` 执行；临时目录可能被系统清理。

- 当前磁盘调用链、前端接口消费者、跨仓库同源代码及既有测试覆盖的静态核对。
- 上述 4 项的无模型隔离复现；发布门禁另用现有 Story fixture 对照 export/install。所有项目文件在临时目录，安装桥为伪实现；未调用真正的安装、姓名 CLI 或模型服务。
- 以下既有回归在临时模型设置/项目根下执行，**18 passed**：

```bash
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q -p no:cacheprovider \
  tests/test_base_agent_token_usage.py \
  tests/test_model_settings_api.py \
  tests/test_qwen_provider.py
```

执行时另将 `NEKO_NUMERIC_DRAMA_MODEL_SETTINGS_PATH`、`NEKO_NUMERIC_DRAMA_PROJECT_ROOT` 指向仓库外临时目录，关闭 bytecode 和 pytest cache；模型密钥为测试值。**不要去掉配置隔离后直接重跑这些设置测试**：其中一个既有测试会调用 `configure_model` 写入所配置路径。

本轮未运行全量测试、真实模型、网页人工体验、正式包安装、TTS、跨平台发行物或长时间内存压力测试。18 项通过说明旧测试基线稳定，不代表 4 项新发现已被覆盖或修复，也不代表各剧本和路线体验通过。
