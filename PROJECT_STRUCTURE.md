# N.E.K.O.-DramaticWriting Numeric v2 剧本生成器项目结构

本图仅描述独立 N.E.K.O.-DramaticWriting 工作台。无界面核心已经迁入N.E.K.O的 `services/theater_workshop/sdk/`，宿主为 `services/theater_workshop/host.py`；两端共享规则继续同步，网页与API不属于SDK。详见[当前生成器合同](docs/superpowers/specs/2026-08-06-neko-theater-numeric-v2-generator-design.md)。

```text
N.E.K.O.-DramaticWriting/
├── frontend/theater/
│   ├── src/                         # 项目纵览、故事地图、数值、支线向导、发布和设置
│   │   ├── branch-wizard.js         # 终点先行、结局确认、过程预览和草稿恢复
│   │   └── mainline-order.js        # 旧项目的确定性主线顺序确认
│   └── index.html                   # 作者工作台入口
├── theater_generator/
│   ├── api.py                       # Numeric v2 项目与发布 API
│   ├── generation/numeric_v2.py     # 主线、节点完善、支线结局和过程模型调用
│   ├── generation/staged.py         # 框架、逐幕生成、开场状态摘录和检查点续写
│   ├── generation/staged_prompts.py # 与 SDK 同步的框架和状态提示词
│   ├── contracts.py                 # HTTP 与项目存储共用的 SDK 输入合同
│   ├── generation/quality.py        # 事实、证据、文学和方案编排；限定节点修订
│   ├── generation/runtime_rules.py  # 两端共享运行规则
│   ├── generation/facts.py          # 事实检查
│   ├── generation/evidence.py       # 原文证据复核
│   ├── generation/repair.py         # 字段权限与保护范围
│   ├── generation/plan_review.py    # 可执行方案复核
│   ├── generation/exit_review.py    # 离幕事实绑定和完成依据检查
│   ├── prompt_data.py              # 无损提示词数据分段
│   ├── runtime_contract.py         # 作者侧复用的本体合同辅助规则
│   ├── tokenize.py                 # 与本体一致的同步 token 计数
│   ├── numeric_v2.py                # 作者 DTO、数值预设和合同桥
│   ├── numeric_v2_branch.py         # 支线资格、上下文、确定性路线和应用前构造
│   ├── numeric_v2_project_store.py  # 项目 revision、主线元数据、草稿与原子持久化
│   └── neko_v2_bridge.py            # 调用 N.E.K.O v2.2 编译、复验和安装
├── tests/theater_generator/         # v2.2 合同、生成、API、前端和项目存储测试
├── base_agent.py                    # 模型调用与 JSON 响应解析
├── config.py                        # 用户级模型配置
└── start_web.py                     # Web 服务启动入口
```

运行和验证命令以 [README_CN.md](README_CN.md) 为准。
