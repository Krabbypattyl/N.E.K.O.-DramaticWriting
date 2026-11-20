from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess

from theater_generator.api import create_app
from theater_generator.neko_v2_bridge import NekoV2Bridge


REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_ROOT = REPO_ROOT / "frontend" / "theater"


def test_numeric_v2_frontend_has_required_authoring_modules():
    expected = {
        "main.js",
        "router.js",
        "api.js",
        "state.js",
        "copy.js",
        "project-home.js",
        "workspace-shell.js",
        "setup-form.js",
        "metric-editor.js",
        "story-graph.js",
        "story-inspector.js",
        "publish-panel.js",
        "dialogs.js",
        "branch-wizard.js",
        "mainline-order.js",
        "styles.css",
    }

    assert expected.issubset({path.name for path in (FRONTEND_ROOT / "src").iterdir()})


def test_numeric_v2_frontend_uses_independent_product_name_and_professional_copy():
    source = "\n".join(
        path.read_text(encoding="utf-8")
        for path in [FRONTEND_ROOT / "index.html", *(FRONTEND_ROOT / "src").glob("*.js")]
    )

    assert "N.E.K.O.-DramaticWriting" in source
    assert "InkAI" not in source
    assert "傻瓜" not in source
    assert "支线创作功能" in source


def test_numeric_v2_frontend_does_not_reintroduce_runtime_authoring_fields():
    source = "\n".join(
        path.read_text(encoding="utf-8")
        for path in (FRONTEND_ROOT / "src").glob("*.js")
    )

    assert "interaction_rules" not in source
    assert "available_interaction_ids" not in source
    assert "recommended_input" not in source
    assert "primary_goal" not in source
    assert "Planner" not in source
    assert "Repair" not in source


def test_numeric_v2_workspace_routes_serve_the_same_frontend(tmp_path):
    client = create_app(project_root=tmp_path).test_client()

    root = client.get("/")
    project = client.get("/projects/project_example")

    assert root.status_code == 200
    assert project.status_code == 200
    assert b"Numeric v2" in root.data
    assert b'<div id="app"' in project.data


def test_served_setup_form_advertises_three_act_short_stories(tmp_path):
    """实际静态路由须交付新范围，避免只改源码而页面仍展示旧篇幅。"""

    client = create_app(project_root=tmp_path).test_client()
    page = client.get("/").get_data(as_text=True)
    assert '/theater-assets/src/main.js' in page
    response = client.get("/theater-assets/src/setup-form.js")
    assert response.status_code == 200
    source = response.get_data(as_text=True)
    assert '"short", "短篇", "3—6 个主线章节"' in source
    assert "4—6 个主线章节" not in source
    assert '"standard", "标准", "6—10 个主线章节"' in source
    assert '"long", "长篇", "10—16 个主线章节"' in source


def test_numeric_v2_frontend_exposes_canvas_drag_and_connect_controls():
    graph_source = (FRONTEND_ROOT / "src" / "story-graph.js").read_text(encoding="utf-8")

    assert "data-node-card" in graph_source
    assert "data-connect-source" in graph_source
    assert "pointerdown" in graph_source
    assert "node_positions" in graph_source


def test_numeric_v2_story_map_supports_zoom_and_real_viewport_fitting():
    graph_source = (FRONTEND_ROOT / "src" / "story-graph.js").read_text(encoding="utf-8")
    styles_source = (FRONTEND_ROOT / "src" / "styles.css").read_text(encoding="utf-8")

    assert "data-zoom-out" in graph_source
    assert "data-zoom-in" in graph_source
    assert "data-zoom-label" in graph_source
    assert "data-graph-stage" in graph_source
    assert "fitGraphToViewport" in graph_source
    assert "ResizeObserver" in graph_source
    assert "event.ctrlKey || event.metaKey" in graph_source
    assert "deltaX / zoom" in graph_source
    assert "transform: scale(" in graph_source
    assert "data-center-graph" not in graph_source
    assert "回到开场" not in graph_source
    assert ".graph-stage" in styles_source


def test_numeric_v2_frontend_does_not_offer_metric_visibility_controls():
    metric_source = (FRONTEND_ROOT / "src" / "metric-editor.js").read_text(encoding="utf-8")

    assert "玩家可见性" not in metric_source
    assert 'data-metric-field="visibility"' not in metric_source
    assert "玩家可见" not in metric_source


def test_numeric_v2_metric_delete_rerenders_from_current_project():
    metric_source = (FRONTEND_ROOT / "src" / "metric-editor.js").read_text(encoding="utf-8")

    assert "const currentMetrics = context.project.setup.metrics" in metric_source
    assert "context.schedule({ setup: context.project.setup })" in metric_source
    assert "currentMetrics.splice(currentIndex, 1)" in metric_source


def test_numeric_v2_workspace_uses_persistent_project_navigation():
    shell_source = (FRONTEND_ROOT / "src" / "workspace-shell.js").read_text(encoding="utf-8")
    copy_source = (FRONTEND_ROOT / "src" / "copy.js").read_text(encoding="utf-8")
    router_source = (FRONTEND_ROOT / "src" / "router.js").read_text(encoding="utf-8")

    assert 'class="workspace-sidebar"' in shell_source
    assert 'class="workspace-nav"' in shell_source
    assert 'class="stage-nav"' not in shell_source
    assert 'class="workspace-footer"' not in shell_source
    assert 'label: "项目总览"' in copy_source
    assert 'label: "故事地图"' in copy_source
    assert 'label: "检查交付"' in copy_source
    assert "branch_draft" in router_source
    assert "resumeBranchWizard" in shell_source


def test_numeric_v2_publish_panel_does_not_include_route_simulator():
    publish_source = (FRONTEND_ROOT / "src" / "publish-panel.js").read_text(encoding="utf-8")
    state_source = (FRONTEND_ROOT / "src" / "state.js").read_text(encoding="utf-8")
    shell_source = (FRONTEND_ROOT / "src" / "workspace-shell.js").read_text(encoding="utf-8")

    assert "路线模拟" not in publish_source
    assert "ROUTE SIMULATOR" not in publish_source
    assert "data-simulation-node" not in publish_source
    assert "data-reset-simulation" not in publish_source
    assert "simulationValues" not in state_source
    assert "simulationValues" not in shell_source


def test_numeric_v2_metrics_live_in_story_map_instead_of_project_overview():
    setup_source = (FRONTEND_ROOT / "src" / "setup-form.js").read_text(encoding="utf-8")
    graph_source = (FRONTEND_ROOT / "src" / "story-graph.js").read_text(encoding="utf-8")
    metric_source = (FRONTEND_ROOT / "src" / "metric-editor.js").read_text(encoding="utf-8")

    assert 'class="overview-grid"' in setup_source
    assert "metricEditorMarkup" not in setup_source
    assert "metricEditorMarkup(context.project.setup.metrics" in graph_source
    assert "data-select-metrics" in graph_source
    assert "隐藏数值规则" in metric_source
    assert "所有数值固定对玩家隐藏" in metric_source


def test_numeric_v2_overview_uses_workspace_generation_without_ai_expansion_button():
    setup_source = (FRONTEND_ROOT / "src" / "setup-form.js").read_text(encoding="utf-8")
    api_source = (FRONTEND_ROOT / "src" / "api.js").read_text(encoding="utf-8")
    shell_source = (FRONTEND_ROOT / "src" / "workspace-shell.js").read_text(encoding="utf-8")
    state_source = (FRONTEND_ROOT / "src" / "state.js").read_text(encoding="utf-8")

    assert "创作想法" in setup_source
    assert "data-expand-idea" not in setup_source
    assert "AI 扩写" not in setup_source
    assert "ideaCharacterCount" in setup_source
    assert "expandIdea" not in api_source
    assert "api.generate" in shell_source
    assert "ideaCharacterCount" in shell_source
    assert "numeric_v2_idea_expansion" not in setup_source
    assert setup_source.index('class="length-field"') < setup_source.index('data-setup-field="brief"')
    assert "生成成功后会替换这里的内容" not in setup_source
    assert "finally" in shell_source
    assert "button.disabled = false" in shell_source
    assert "visibleIdeaValue" in setup_source
    assert "visibleIdeaValue(root" in shell_source
    assert shell_source.index("visibleIdeaValue(root") < shell_source.index("ideaCharacterCount(visibleBrief)")
    assert "const saved = await workspace.flush()" in shell_source
    assert "if (!saved)" in shell_source
    assert "Promise.resolve(true)" in state_source
    assert "return false" in state_source


def test_numeric_v2_story_overview_displays_six_dimension_quality_report():
    inspector_source = (FRONTEND_ROOT / "src" / "story-inspector.js").read_text(encoding="utf-8")
    styles_source = (FRONTEND_ROOT / "src" / "styles.css").read_text(encoding="utf-8")

    assert "qualityAssessmentMarkup" in inspector_source
    for label in ("人物塑造", "情节构思", "主题思想", "文笔风格", "叙事节奏", "情感共鸣"):
        assert label in inspector_source
    assert "quality-assessment" in styles_source
    assert "qualityRadarMarkup" in inspector_source
    assert 'aria-label="六维评分雷达图"' in inspector_source
    assert "quality-radar-score" in inspector_source
    assert "quality-radar" in styles_source
    assert "metric_advice" in inspector_source
    assert "relationship_advice" in inspector_source
    assert "数值数量建议" in inspector_source
    assert "人物关系优化" in inspector_source
    assert "data-assess-quality" in inspector_source
    assert "modification_plan" in inspector_source
    assert "qualityOptimizationNodeIds" in inspector_source
    assert "已在故事地图标记" in inspector_source
    assert "data-repair-quality-issue" not in inspector_source
    assert "此方案需要手动调整，请在故事地图中处理" in inspector_source
    assert inspector_source.index("const button = event.currentTarget;") < inspector_source.index(
        "if (!(await context.flush()))"
    )
    assert 'assessment?.stale ? "重新评分"' in inspector_source
    graph_source = (FRONTEND_ROOT / "src" / "story-graph.js").read_text(encoding="utf-8")
    api_source = (FRONTEND_ROOT / "src" / "api.js").read_text(encoding="utf-8")
    assert "quality-suggested" in graph_source
    assert "quality-node-badge" in graph_source
    assert 'cancelLabel: "否"' in graph_source
    assert 'confirmLabel: "是，开始优化"' in graph_source
    assert "context.viewState.qualityHighlights = null" in graph_source
    assert "assessment && highlightState && assessment.stale !== true" in graph_source
    assert "optimizeQualityNode" in graph_source
    assert "optimizeQualityNode" in api_source
    assert "quality-suggested" in styles_source


def test_numeric_v2_frontend_exposes_narrative_focus_and_pacing_diagnostics():
    inspector_source = (FRONTEND_ROOT / "src" / "story-inspector.js").read_text(encoding="utf-8")
    branch_source = (FRONTEND_ROOT / "src" / "branch-wizard.js").read_text(encoding="utf-8")
    copy_source = (FRONTEND_ROOT / "src" / "copy.js").read_text(encoding="utf-8")

    assert "narrative_focus" in inspector_source
    assert "pacingDiagnosticsMarkup" in inspector_source
    assert "pacing_diagnostics" in branch_source
    assert "branch_natural_exit_player_action_missing" in copy_source
    assert "branch_natural_exit_player_action_not_actionable" in copy_source
    assert "scene_natural_exit_player_action_not_actionable" in inspector_source
    assert "scene_expected_turns_unknown" in copy_source
    assert "branch_expected_turns_exceed_40" in copy_source


def test_numeric_v2_publish_panel_labels_deterministic_route_analysis_warnings():
    source = (FRONTEND_ROOT / "src" / "publish-panel.js").read_text(encoding="utf-8")

    assert "ANALYSIS_WARNING_LABELS" in source
    assert "route_priority_shadowed" in source
    assert "route_pacing_difficult" in source
    assert "route_analysis_unknown" in source
    assert "route_transition_duplicate" in source
    assert "转场可辨识性" in source


def test_numeric_v2_transition_review_renders_current_draft_and_matches_neko_opening():
    beats = [
        {"opening_scene": "  第一行。\n第二行仍是开场。  ", "summary": "不能覆盖显式开场。"},
        {"opening_scene": "  ", "summary": "第一句。第二句是未来事件。"},
        {"summary": "先等一下！后续不应出现。"},
        {"summary": "What now? A future action."},
        {"summary": "First. Still the first sentence! Future."},
        {"summary": "第一行\n第二行"},
        {"summary": "**雨停了。**后续不可预演。"},
        {"opening_scene": "**完整开场。** `保留作者原文`"},
        {"summary": "\n\t", "catgirl_situation": "她正等着你？随后再出发。"},
        {"summary": None, "catgirl_situation": "没有句末标点"},
        {},
    ]
    bridge = NekoV2Bridge()
    # 直接比较当前 N.E.K.O 的共享提取函数，防止前端悄悄复制不同的旧包回退语义。
    expected = subprocess.run(
        [str(bridge.python), "-c", (
            "import json,sys; from services.theater.numeric_v2_context import scene_opening_text; "
            "print(json.dumps([scene_opening_text(beat) for beat in json.load(sys.stdin)], ensure_ascii=False))"
        )],
        input=json.dumps(beats, ensure_ascii=False),
        capture_output=True,
        text=True,
        cwd=bridge.neko_root,
        check=True,
    )
    node = shutil.which("node")
    assert node, "运行前端行为测试需要 Node.js"
    result = subprocess.run(
        [node, str(REPO_ROOT / "tests/frontend/numeric_v2_transition_review.mjs")],
        input=json.dumps({"beats": beats, "expected": json.loads(expected.stdout)}, ensure_ascii=False),
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_numeric_v2_workspace_resumes_saved_generation_checkpoint_after_three_attempts():
    shell_source = (FRONTEND_ROOT / "src" / "workspace-shell.js").read_text(encoding="utf-8")
    copy_source = (FRONTEND_ROOT / "src" / "copy.js").read_text(encoding="utf-8")
    setup_source = (FRONTEND_ROOT / "src" / "setup-form.js").read_text(encoding="utf-8")

    assert "继续生成剩余结构" in shell_source
    assert "正在继续生成剩余结构" in shell_source
    assert "generation_checkpoint?.available" in shell_source
    assert "error.details?.project" in shell_source
    assert "已自动尝试" in copy_source
    assert "已保存有效内容，可继续生成剩余结构" in copy_source
    assert "generation-resume-note" in setup_source
    assert "已经通过校验的内容和当前候选都已保存" in setup_source


def test_numeric_v2_home_describes_mainline_first_workflow():
    home_source = (FRONTEND_ROOT / "src" / "project-home.js").read_text(encoding="utf-8")

    assert "先生成主线与结局" in home_source
    assert "不需要手算路线阈值" in home_source
    assert "先写下故事和数值规则" not in home_source


def test_numeric_v2_story_map_exposes_endpoint_first_branch_wizard():
    graph_source = (FRONTEND_ROOT / "src" / "story-graph.js").read_text(encoding="utf-8")
    wizard_source = (FRONTEND_ROOT / "src" / "branch-wizard.js").read_text(encoding="utf-8")
    api_source = (FRONTEND_ROOT / "src" / "api.js").read_text(encoding="utf-8")

    assert "data-generate-branch" in graph_source
    assert "openBranchWizard" in graph_source
    assert "这条支线最后去哪" in wizard_source
    assert "回到哪一幕" in wizard_source
    assert "生成结局草稿" in wizard_source
    assert "根据结局生成过程" in wizard_source
    assert "先确认结局，再决定途中偏好" in wizard_source
    assert "lengths.map" in wizard_source
    assert "data-manage-mainline" in wizard_source
    assert "branchOptions" in api_source
    assert "generateBranchEnding" in api_source
    assert "generateBranchPath" in api_source
    assert "applyBranchDraft" in api_source
    assert "resumeBranchWizard" in wizard_source
    assert "setDraftPointer" in wizard_source


def test_numeric_v2_branch_wizard_defaults_to_semantics_and_keeps_raw_conditions_advanced():
    wizard_source = (FRONTEND_ROOT / "src" / "branch-wizard.js").read_text(encoding="utf-8")
    inspector_source = (FRONTEND_ROOT / "src" / "story-inspector.js").read_text(encoding="utf-8")

    assert "不需要填写数值、阈值或优先级" in wizard_source
    assert "高级条件" in wizard_source
    assert "branch_conditions" in wizard_source
    assert "intentionally_replaced" not in wizard_source
    assert 'role="dialog"' in wizard_source
    assert 'role="radiogroup"' in wizard_source
    assert 'aria-live="polite"' in wizard_source
    assert 'class="route-advanced"' in inspector_source


def test_numeric_v2_branch_wizard_surfaces_d7_pacing_diagnostics_without_exporting_them():
    wizard_source = (FRONTEND_ROOT / "src" / "branch-wizard.js").read_text(encoding="utf-8")
    copy_source = (FRONTEND_ROOT / "src" / "copy.js").read_text(encoding="utf-8")

    assert "pacing_diagnostics" in wizard_source
    assert "branch-pacing-notice" in wizard_source
    assert "branch_natural_exit_player_action_not_actionable" in wizard_source
    assert "8 回合内可达" in wizard_source
    assert "branch_pacing_partial_reachability" in copy_source
    assert "不会写入正式剧本或交给演绎模型" in wizard_source


def test_numeric_v2_mainline_order_follows_existing_routes_without_model_calls():
    source = (FRONTEND_ROOT / "src" / "mainline-order.js").read_text(encoding="utf-8")
    api_source = (FRONTEND_ROOT / "src" / "api.js").read_text(encoding="utf-8")

    assert "哪一幕仍属于主线" in source
    assert "不会重接路线，也不会调用模型" in source
    assert "route_gates" in source
    assert "api.saveMainlineOrder" in source
    assert "saveMainlineOrder" in api_source
    assert "generateBranch" not in source


def test_numeric_v2_story_map_does_not_render_a_second_left_navigation():
    graph_source = (FRONTEND_ROOT / "src" / "story-graph.js").read_text(encoding="utf-8")

    assert 'class="story-designer ${metricsOpen ? "metrics-open" : ""}"><main class="story-graph"' in graph_source
    assert 'class="story-outline"' not in graph_source


def test_numeric_v2_story_map_add_node_requires_scene_or_ending_type():
    graph_source = (FRONTEND_ROOT / "src" / "story-graph.js").read_text(encoding="utf-8")
    dialog_source = (FRONTEND_ROOT / "src" / "dialogs.js").read_text(encoding="utf-8")

    assert "data-add-node" in graph_source
    assert "data-add-scene" not in graph_source
    assert "data-add-ending" not in graph_source
    assert "nodeTypeDialog" in graph_source
    assert "幕节点" in dialog_source
    assert "结局节点" in dialog_source


def test_numeric_v2_story_map_exposes_node_ai_enhancement_without_editing_routes():
    inspector_source = (FRONTEND_ROOT / "src" / "story-inspector.js").read_text(encoding="utf-8")
    api_source = (FRONTEND_ROOT / "src" / "api.js").read_text(encoding="utf-8")

    assert "AI 完善幕节点" in inspector_source
    assert "AI 完善结局节点" in inspector_source
    assert "data-enhance-node" in inspector_source
    assert "api.enhanceNode" in inspector_source
    assert "/nodes/${nodeId}/enhance" in api_source
    assert "conditions: { all: [] }" in inspector_source


def test_numeric_v2_story_map_edits_soft_pacing_budget_without_hard_turn_limit():
    inspector_source = (FRONTEND_ROOT / "src" / "story-inspector.js").read_text(encoding="utf-8")
    graph_source = (FRONTEND_ROOT / "src" / "story-graph.js").read_text(encoding="utf-8")

    assert "建议收束回合" in inspector_source
    assert "默认 3，可逐幕调整" in inspector_source
    assert 'data-node-number-field="recommended_turns"' in inspector_source
    assert "不会强制跳幕" in inspector_source
    assert "recommended_turns" in graph_source
    assert "node.min_turns = DEFAULT_NODE_TURNS" in graph_source
    assert "node.recommended_turns = DEFAULT_NODE_TURNS" in graph_source
    assert "turn_limit" not in inspector_source
