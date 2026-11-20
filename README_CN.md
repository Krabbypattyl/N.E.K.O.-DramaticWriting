# N.E.K.O.-DramaticWriting

[English](README.md)

N.E.K.O.-DramaticWriting 是 N.E.K.O 小剧场 `neko.story.numeric.v2` Story Package 的独立作者工作台。

无界面核心已迁入N.E.K.O的 `services/theater_workshop/sdk/`，本仓库保留网页、Flask API及自己的模型设置，并继续同步共享创作／评改规则；尚未冻结或改为SDK薄适配。本体SDK无需启动此工作台，也不使用这里的模型设置页面。当前合同见[生成器开发文档](docs/superpowers/specs/2026-08-06-neko-theater-numeric-v2-generator-design.md)，本体接入见[SDK说明](../N.E.K.O/services/theater_workshop/README.md)。

新建生成先确定故事框架，再逐幕写作并摘录开场三方状态，最后生成一个 Normal 结局。每阶段保存检查点，失败后可显式续写；旧整稿检查点沿用原协议。完整草稿通过当前 N.E.K.O 编译器后才替换正式地图。作者随后可以在故事地图中使用“终点先行”向导生成支线：先选择回到哪一幕、通往哪个已有结局，或先确认一个新结局，再由模型反推 1—3 幕过程。默认界面使用人类可读的触发语义，不要求作者手算隐藏数值阈值；原始条件仍保留在高级编辑中。节点“AI 完善”是显式的独立操作，只完善节点演绎约束，不修改路线。主线质量评分默认不运行，只有作者点击后才生成六维报告与逐节点修改方案。

## 当前边界

- 主线生成与质量评分完全分离；生成阶段只处理大纲和确定性结构收口，不自动评分或按分数改写；
- 数值由作者在故事地图中配置，不与主线一起交给模型生成；支线阈值、互补条件和 priority 由程序根据作者选择的语义状态确定性生成；
- 新结局严格先生成并确认结局草稿，再根据确认后的终点生成过程；支线生成不自动评分；
- 显式评分按节点和检查任务分段核对事实、离幕完成依据及合同覆盖，有问题时复核原文证据，再分段做文学评分；存在可执行修订候选时复核方案。各阶段使用对应事实与共享运行规则，文学评分不把编辑状态或回合预算当作文学质量；
- 六维评分覆盖完整剧情，包括人物塑造、情节构思、主题思想、文笔风格、叙事节奏和情感共鸣；每项满分 100、低于 75 为不合格，最终对白与真实玩家体验只评价设计潜力；
- 报告使用六维雷达图，同时给出数值指标应新增、删除或合并的数量建议，以及人物关系优化建议；不直接调整具体数值阈值；
- 评分只给报告和逐节点修改方案，不修改 Story Package；评分完成后，故事地图高亮所有可单节点执行的建议节点；作者点击节点并选择“是”后，系统才合并该节点的六维问题与人物关系建议，在报告当前、证据及方案有效、字段权限核验通过后，调用一次模型定向优化；选择“是”或“否”都会取消本轮全部高亮；
- 涉及新增、删除或重连节点、路线和条件的结构方案只展示为手动建议，不提供自动接受按钮；
- 定向节点优化不得修改节点 ID、类型、路线、数值、阈值、priority 或回合预算；完成后旧评分标记为过期，需要作者再次点击评分；
- 草稿应用前不修改正式地图；应用时重新校验 revision、上下文和当前 N.E.K.O 编译结果并原子提交；
- 每个非结局节点默认使用 `min_turns=3 / recommended_turns=3` 的短篇预算；作者可在故事地图的节点属性中逐幕选择建议收束回合，默认值为 3；生成 Prompt 以每幕 8 回合为软目标，短篇超过目标时会定向重写当前幕；模型声明的 `expected_turns` 只保留为作者侧节奏诊断，不会改变 Runtime 的三回合推荐值；“仅作观察者/无需决定”等非行动式离幕会被作者侧诊断；
- 新建数值默认范围为 `0—50`，预设状态区间从 `20` 和 `35` 处划分，方便短篇支线更早达到进入条件；
- `recommended_turns` 对玩家隐藏，只提示 Actor 聚焦和收束，不限制玩家输入次数，也不会强制跳幕；
- 所有数值均对玩家隐藏；
- 编译使用 N.E.K.O Numeric v2.2 确定性合同并一次返回全部问题；
- 导出和安装要求当前项目 revision 已通过 N.E.K.O 复验；
- 模型设置长期保存在仓库外的用户级配置中。

新的项目级环境变量使用 `NEKO_NUMERIC_DRAMA_*` 前缀。旧 `INKAI_*` 变量和旧模型设置目录只作为
兼容读取入口，避免改名后丢失已有本机配置；改名后仍使用 `NEKO_Numeric_drama` 配置目录及现有项目目录，不自动搬迁或改写用户数据。

共享创作、状态投影、事实与离幕合同、证据、文学、方案及受限修订规则以本机 N.E.K.O 的 `services/theater_workshop/sdk/` 为同步来源；网页、Flask API、模型设置和独立进程编译桥保留在本仓库。token 计数使用与本体一致的 `o200k_base`。

## 安装与启动

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python start_web.py
```

打开 `http://localhost:5000/`。

## 主要 API

```text
GET  /api/theater/numeric-v2/metric-presets
GET  /api/theater/numeric-v2/projects
POST /api/theater/numeric-v2/projects
POST /api/theater/numeric-v2/projects/{project_id}/generate
PATCH /api/theater/numeric-v2/projects/{project_id}
POST /api/theater/numeric-v2/projects/{project_id}/quality-assessment
POST /api/theater/numeric-v2/projects/{project_id}/quality-nodes/{node_id}/optimize
POST /api/theater/numeric-v2/projects/{project_id}/nodes/{node_id}/enhance
GET  /api/theater/numeric-v2/projects/{project_id}/nodes/{node_id}/branch-options
PUT  /api/theater/numeric-v2/projects/{project_id}/mainline-order
POST /api/theater/numeric-v2/projects/{project_id}/branch-ending-drafts
POST /api/theater/numeric-v2/projects/{project_id}/branch-drafts
GET  /api/theater/numeric-v2/projects/{project_id}/branch-drafts/{draft_id}
POST /api/theater/numeric-v2/projects/{project_id}/branch-drafts/{draft_id}/apply
POST /api/theater/numeric-v2/projects/{project_id}/compile
POST /api/theater/numeric-v2/projects/{project_id}/validate-neko
GET  /api/theater/numeric-v2/projects/{project_id}/export
POST /api/theater/numeric-v2/projects/{project_id}/install
```

模型设置：

```text
GET /api/settings/model
PUT /api/settings/model
```

API Key 不会通过读取接口返回，也不会写入 Story Package。

## 验证

```bash
PYTHONPATH=. .venv/bin/python -m pytest -q \
  tests/theater_generator/test_numeric_v2.py \
  tests/theater_generator/test_numeric_v2_generation.py \
  tests/theater_generator/test_staged_generation.py \
  tests/theater_generator/test_staged_api.py \
  tests/theater_generator/test_numeric_v2_branch.py \
  tests/theater_generator/test_numeric_v2_api.py \
  tests/theater_generator/test_numeric_v2_project_store.py \
  tests/theater_generator/test_numeric_v2_frontend.py \
  tests/theater_generator/test_imports.py

PYTHONPATH=. .venv/bin/python -m py_compile \
  theater_generator/api.py \
  theater_generator/generation/numeric_v2.py \
  theater_generator/generation/quality.py \
  theater_generator/numeric_v2.py \
  theater_generator/numeric_v2_branch.py \
  theater_generator/numeric_v2_project_store.py \
  start_web.py
```
