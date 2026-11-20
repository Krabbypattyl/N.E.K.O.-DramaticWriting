from __future__ import annotations

from test_numeric_v2_generation import _fact_review_payload, _quality_reply, _literary_block_payload

from prompt_support import prompt_payload

import json

from theater_generator.api import create_app
from theater_generator.generation.numeric_v2 import NumericV2GenerationError
from numeric_v2_fixture import numeric_v2_setup, numeric_v2_story


def _app(tmp_path):
    app = create_app(project_root=tmp_path)
    app.config.update(TESTING=True)
    # API 回归不读取开发机的真实角色；姓名来源另用专门的接入测试覆盖。
    app.extensions["numeric_services"].numeric_v2_bridge.authoring_names = lambda: {
        "player_name": "男主", "catgirl_name": "女主",
    }
    return app


def test_service_status_uses_independent_product_name(tmp_path):
    response = _app(tmp_path).test_client().get("/api/status")

    assert response.status_code == 200
    assert response.get_json()["data"]["service"] == "N.E.K.O.-DramaticWriting"


def test_numeric_v2_project_crud_and_revision_conflict(tmp_path):
    app = _app(tmp_path)
    client = app.test_client()

    created = client.post("/api/theater/numeric-v2/projects").get_json()["data"]
    response = client.patch(
        f"/api/theater/numeric-v2/projects/{created['project_id']}",
        json={
            "base_revision": created["revision"],
            "changes": {"title": "清河晚风", "setup": numeric_v2_setup()},
        },
    )
    assert response.status_code == 200
    updated = response.get_json()["data"]
    assert updated["revision"] == created["revision"] + 1

    conflict = client.patch(
        f"/api/theater/numeric-v2/projects/{created['project_id']}",
        json={"base_revision": created["revision"], "changes": {"title": "过期标题"}},
    )
    assert conflict.status_code == 409
    assert conflict.get_json()["error"]["details"]["project"]["title"] == "清河晚风"
    assert len(client.get("/api/theater/numeric-v2/projects").get_json()["data"]) == 1


def test_numeric_v2_project_accepts_editor_only_node_positions(tmp_path):
    app = _app(tmp_path)
    client = app.test_client()
    created = client.post("/api/theater/numeric-v2/projects").get_json()["data"]

    response = client.patch(
        f"/api/theater/numeric-v2/projects/{created['project_id']}",
        json={
            "base_revision": created["revision"],
            "changes": {"editor": {"node_positions": {"node_a": {"x": 100, "y": 220}}}},
        },
    )

    assert response.status_code == 200
    project = response.get_json()["data"]
    assert project["editor"]["node_positions"]["node_a"] == {"x": 100.0, "y": 220.0}


def test_numeric_v2_import_compile_validate_and_export(tmp_path):
    app = _app(tmp_path)
    client = app.test_client()
    imported_story = numeric_v2_story()
    imported_story["metric_schema"]["trust"]["visibility"] = "public"

    imported_response = client.post(
        "/api/theater/numeric-v2/projects/import",
        json={"story": imported_story},
    )
    assert imported_response.status_code == 201
    imported = imported_response.get_json()["data"]
    assert imported["status"] == "compiled"
    warning_codes = {item["code"] for item in imported["compile_result"]["warnings"]}
    assert "route_pacing_difficult" in warning_codes
    assert "route_transition_duplicate" in warning_codes

    validated_response = client.post(
        f"/api/theater/numeric-v2/projects/{imported['project_id']}/validate-neko",
        json={"base_revision": imported["revision"]},
    )
    assert validated_response.status_code == 200
    validated = validated_response.get_json()["data"]
    assert validated["status"] == "verified"

    exported = client.get(
        f"/api/theater/numeric-v2/projects/{imported['project_id']}/export"
    )
    assert exported.status_code == 200
    assert exported.headers["X-Numeric-V2-Package-Hash"].startswith("sha256:")
    exported_story = json.loads(exported.data)
    assert exported_story["schema"] == "neko.story.numeric.v2"
    assert exported_story["metric_schema"]["trust"]["visibility"] == "hidden"
    assert "editor" not in exported_story


def test_numeric_v2_compile_records_all_contract_issues(tmp_path):
    app = _app(tmp_path)
    client = app.test_client()
    story = numeric_v2_story()
    story["nodes"][0]["route_gates"][0]["target_node_id"] = "missing"
    project = app.extensions["numeric_services"].numeric_v2_store.import_story(story)

    response = client.post(
        f"/api/theater/numeric-v2/projects/{project['project_id']}/compile",
        json={"base_revision": project["revision"]},
    )

    assert response.status_code == 422
    payload = response.get_json()
    assert payload["error"]["code"] == "numeric_v2_compile_failed"
    assert any(
        issue["code"] == "unknown_target_node"
        for issue in payload["error"]["details"]["issues"]
    )
    current = client.get(
        f"/api/theater/numeric-v2/projects/{project['project_id']}"
    ).get_json()["data"]
    assert current["status"] == "invalid"


def test_numeric_v2_generate_uses_saved_setup_and_keeps_one_model_call(tmp_path):
    app = _app(tmp_path)
    client = app.test_client()
    services = app.extensions["numeric_services"]
    project = services.numeric_v2_store.create()
    project = services.numeric_v2_store.update(
        project["project_id"],
        base_revision=project["revision"],
        changes={"title": "清河晚风", "setup": numeric_v2_setup()},
    )
    calls = 0

    class FakeGenerator:
        def generate(self, *, title, setup, cast_names=None, checkpoint=None):
            nonlocal calls
            calls += 1
            assert title == "清河晚风"
            assert setup["metrics"][0]["id"] == "trust"
            return {
                "story": numeric_v2_story(),
                "mainline_node_ids": ["start"],
                "relationship_arc": {
                    "opening_relationship": "带着旧日误会的儿时邻居",
                    "long_term_direction": "通过核验旧信逐步重建信任",
                    "stages": [{
                        "chapter_index": 1,
                        "node_id": "start",
                        "stage_ceiling": "guarded",
                        "address_state": "known_before_story",
                        "known_player_facts": ["两人是旧识"],
                        "allowed_behaviors": ["礼貌核验"],
                        "forbidden_behaviors": ["直接宣告和解"],
                        "progress_opportunity": "核验旧信",
                    }],
                },
                "character_state_arc": {
                    "stages": [{
                        "node_id": "start",
                        "chapter_index": 1,
                        "catgirl_state": "女主记得开场前已经成立的旧信事实。",
                        "player_state": "男主尚未作出新的选择。",
                        "environment_state": "环境保持雨季花店现场。",
                    }],
                    "ending_stage": {
                        "catgirl_state": "女主保留已经核验的事实。",
                        "player_state": "男主保留玩家已经作出的选择。",
                        "environment_state": "环境进入雨停后的花店。",
                    },
                },
                "key_props": [{
                    "id": "dated_old_letter",
                    "name": "写有日期的旧信",
                    "purpose": "核对当年的收信记录",
                    "states": [{
                        "chapter_index": 1,
                        "owner": "catgirl",
                        "state": "由女主保管",
                    }],
                }],
                "setup_updates": {
                    "brief": "生成后的主线大纲",
                    "relationship": "带着旧日误会的儿时邻居",
                    "tone": ["克制", "温柔"],
                },
            }

        def generate_staged(self, *, save_checkpoint=None, **kwargs):
            return self.generate(**kwargs)

    class ForbiddenQualityAssessor:
        def assess(self, **_kwargs):
            raise AssertionError("默认生成不得触发评分")

    services.numeric_v2_generator = FakeGenerator()
    services.numeric_v2_quality = ForbiddenQualityAssessor()
    response = client.post(
        f"/api/theater/numeric-v2/projects/{project['project_id']}/generate",
        json={"base_revision": project["revision"]},
    )

    assert response.status_code == 200
    assert calls == 1
    generated = response.get_json()["data"]["project"]
    assert generated["story"]["schema"] == "neko.story.numeric.v2"
    assert generated["setup"]["brief"] == numeric_v2_setup()["brief"]
    assert generated["stage"] == "story"
    assert generated["authoring"]["relationship_arc"]["stages"][0]["node_id"] == "start"
    assert generated["authoring"]["character_state_arc"]["stages"][0]["node_id"] == "start"
    assert generated["authoring"]["key_props"][0]["id"] == "dated_old_letter"
    assert generated["authoring"]["quality_assessment"] is None


def test_numeric_v2_quality_assessment_is_explicit_and_optimizes_only_confirmed_node(tmp_path):
    app = _app(tmp_path)
    client = app.test_client()
    services = app.extensions["numeric_services"]
    created = services.numeric_v2_store.create()
    project = services.numeric_v2_store.finish_generation(
        created["project_id"],
        base_revision=created["revision"],
        story=numeric_v2_story(),
        mainline_node_ids=["start"],
    )
    calls = []

    class FakeQualityAssessor:
        def assess(self, *, story, setup, authoring):
            calls.append("assess")
            assert story["nodes"][0]["id"] == "start"
            return {
                "scope": "full_story_simple",
                "repair_plan_version": 3,
                "content_sha256": "c" * 64,
                "overall_score": 74.0,
                "scores": {},
                "strengths": ["开场关系明确"],
                "issues": [{
                    "issue_id": "quality_issue_01",
                    "dimension": "plot",
                    "severity": "major",
                    "target_node_ids": ["start"],
                    "problem": "转折缺少证据。",
                    "modification_plan": "在开场节点补充旧信日期证据。",
                    "expected_result": "转折由证据自然推出。",
                    "preserve": ["保留结局方向"],
                    "repair_scope": "text",
                    "repairable": True,
                }],
                "relationship_advice": [],
                "failed_dimensions": ["plot"],
                "passed": False,
                "stale": False,
            }

        def optimize_node(self, *, story, setup, authoring, assessment, node_id):
            calls.append(f"optimize:{node_id}")
            repaired = json.loads(json.dumps(story, ensure_ascii=False))
            repaired["nodes"][0]["story_beat"]["summary"] = "开场补充了旧信日期证据，并结合全部评分建议。"
            return repaired

    services.numeric_v2_quality = FakeQualityAssessor()
    assessed_response = client.post(
        f"/api/theater/numeric-v2/projects/{project['project_id']}/quality-assessment",
        json={"base_revision": project["revision"]},
    )

    assert assessed_response.status_code == 200
    assessed = assessed_response.get_json()["data"]["project"]
    assert calls == ["assess"]
    assert assessed["revision"] == project["revision"]
    assert assessed["authoring"]["quality_assessment"]["issues"][0]["modification_plan"].startswith("在开场")
    assert assessed["story"] == project["story"]

    repaired_response = client.post(
        f"/api/theater/numeric-v2/projects/{project['project_id']}/quality-nodes/start/optimize",
        json={"base_revision": assessed["revision"]},
    )

    assert repaired_response.status_code == 200
    repaired = repaired_response.get_json()["data"]
    assert calls == ["assess", "optimize:start"]
    assert repaired["optimized_node_id"] == "start"
    assert repaired["project"]["story"]["nodes"][0]["story_beat"]["summary"].startswith("开场补充")
    assert repaired["project"]["story"]["nodes"][1] == project["story"]["nodes"][1]
    assert repaired["project"]["authoring"]["quality_assessment"]["stale"] is True


def test_quality_api_reports_failed_phase_without_overwriting_previous_report(tmp_path):
    from copy import deepcopy
    from theater_generator.generation.quality import NumericV2QualityAssessor

    # 两阶段任一步失败均保留上次完整报告及版本；失败阶段供界面明确提示本次未完成。
    app = _app(tmp_path)
    services = app.extensions["numeric_services"]
    store = services.numeric_v2_store
    created = store.create()
    project = store.finish_generation(created["project_id"], base_revision=created["revision"],
                                     story=numeric_v2_story(), mainline_node_ids=["start"])
    project = store.record_quality_assessment(project["project_id"],
        {"scope": "full_story_simple", "overall_score": 83, "issues": []},
        base_revision=project["revision"])
    previous = deepcopy(project)
    for phase in ["facts", "literature"]:
        assessor = NumericV2QualityAssessor()
        calls = []
        def reply(messages, **kwargs):
            calls.append(kwargs["operation"])
            if phase == "literature" and kwargs["operation"] == "numeric_v2_fact_review":
                context = prompt_payload(messages[1]["content"])
                return json.dumps(_fact_review_payload(context, []))
            if phase == "literature" and kwargs["operation"].startswith("numeric_v2_literary_block"):
                return json.dumps(_literary_block_payload(prompt_payload(messages[1]["content"])))
            return "{}"
        assessor.call_llm = reply
        services.numeric_v2_quality = assessor
        response = app.test_client().post(
            f"/api/theater/numeric-v2/projects/{project['project_id']}/quality-assessment",
            json={"base_revision": project["revision"]},
        )
        assert response.status_code == 422
        assert response.get_json()["error"]["details"]["phase"] == phase
        assert calls.count("numeric_v2_fact_review_format_repair") == (1 if phase == "facts" else 0)
        assert calls[-1] == ("numeric_v2_fact_review_format_repair" if phase == "facts" else "numeric_v2_quality_assessment")
        assert store.get(project["project_id"]) == previous


def test_quality_api_persists_complete_fact_and_literary_report(tmp_path):
    from theater_generator.generation.quality import NumericV2QualityAssessor
    from test_numeric_v2_generation import _quality_story_context, _quality_payload, _quality_wire_payload

    # 走真实两阶段解析、API和存储，仅替换模型返回，验证合并证据不会在保存时丢失。
    app = _app(tmp_path)
    services = app.extensions["numeric_services"]
    story, _ = _quality_story_context()
    project = services.numeric_v2_store.import_story(story)
    assessor = NumericV2QualityAssessor()
    calls = []
    evidence = []
    def reply(messages, **kwargs):
        calls.append(kwargs["operation"])
        if len(calls) == 1:
            context = prompt_payload(messages[1]["content"])
            refs = []
            for field in ["summary", "opening_scene"]:
                source = context["story_outline"]["mainline"][0][field]
                refs.append(source["ref"])
                evidence.append({"path": f"/mainline/0/{field}", "quote": source["text"]})
            return json.dumps(_fact_review_payload(context, [{
                "category": "state", "severity": "major", "target_node_ids": ["mainline_01"],
                "problem": "测试事实报告保存", "modification_plan": "核对状态", "expected_result": "状态一致",
                "preserve": [], "repair_scope": "text", "evidence_refs": refs,
            }]), ensure_ascii=False)
        if kwargs["operation"] == "numeric_v2_fact_evidence_review":
            from test_numeric_v2_evidence import review_payload
            return json.dumps(review_payload(prompt_payload(messages[1]["content"])["proposed_issues"]))
        return _quality_reply(_quality_payload())(messages, **kwargs)
    assessor.call_llm = reply
    services.numeric_v2_quality = assessor
    response = app.test_client().post(
        f"/api/theater/numeric-v2/projects/{project['project_id']}/quality-assessment",
        json={"base_revision": project["revision"]},
    )
    assert response.status_code == 200
    saved = services.numeric_v2_store.get(project["project_id"])
    report = saved["authoring"]["quality_assessment"]
    assert calls[0] == "numeric_v2_fact_review"
    assert "numeric_v2_fact_evidence_review" in calls
    assert calls[-1] == "numeric_v2_quality_assessment"
    assert report["fact_check"]["issue_count"] == 1
    assert report["issues"][0]["evidence"] == evidence
    assert report["passed"] is False
    assert saved["story"] == project["story"]
    assert saved["revision"] == project["revision"]
    assert response.get_json()["data"]["project"]["authoring"]["quality_assessment"] == report


def test_numeric_v2_exposes_only_node_quality_optimization_route(tmp_path):
    routes = {rule.rule for rule in _app(tmp_path).url_map.iter_rules()}

    assert "/api/theater/numeric-v2/projects/<project_id>/quality-nodes/<node_id>/optimize" in routes
    assert not any("quality-issues" in route and route.endswith("/repair") for route in routes)


def test_old_report_and_outside_plan_candidate_never_overwrite_project(tmp_path):
    from theater_generator.generation.quality import NumericV2QualityAssessor
    # 真实API拒绝旧报告和越出已展示字段的候选，保留旧报告、剧本、版本和修改时间。
    app = _app(tmp_path)
    services = app.extensions["numeric_services"]
    store = services.numeric_v2_store
    created = store.create()
    project = store.finish_generation(created["project_id"], base_revision=created["revision"],
                                     story=numeric_v2_story(), mainline_node_ids=["start"])
    report = {"scope": "full_story_simple", "issues": [{"target_node_ids": ["start"],
        "repair_scope": "text", "repairable": True,
        "repair_targets": [{"node_id": "start", "field": "/summary"}],
        "problem": "测试范围", "modification_plan": "只改摘要。"}]}
    assessor = NumericV2QualityAssessor()
    calls = []
    def reply(*args, **kwargs):
        calls.append(kwargs["operation"])
        return json.dumps({"node_updates": [{"node_id": "start", "story_beat": {
            "opening_scene": "候选未经方案确认便重写开场。",
        }}]}, ensure_ascii=False)
    assessor.call_llm = reply
    services.numeric_v2_quality = assessor
    url = f"/api/theater/numeric-v2/projects/{project['project_id']}/quality-nodes/start/optimize"
    for old in [True, False]:
        if not old:
            # 下游越界测试显式使用已复核报告，旧版本单独验证。
            from test_numeric_v2_generation import _reviewed_fixture
            _reviewed_fixture(report, NumericV2QualityAssessor._assessment_context(project["story"], project["setup"], project["authoring"]))
        previous = store.record_quality_assessment(project["project_id"], report, base_revision=project["revision"])
        response = app.test_client().post(url, json={"base_revision": project["revision"]})
        assert response.status_code == (409 if old else 422)
        assert response.get_json()["error"]["code"] == ("quality_reassessment_required" if old else "quality_repair_outside_plan")
        assert store.get(project["project_id"]) == previous
    assert len(calls) == 1


def test_quality_state_patch_persists_and_invalid_permissions_leave_project_unchanged(tmp_path):
    from copy import deepcopy
    from theater_generator.generation.quality import NumericV2QualityAssessor

    # 使用真实修订解析和存储链路，验证状态补丁入库、报告失效以及越界补丁原子拒绝。
    app = _app(tmp_path)
    services = app.extensions["numeric_services"]
    store = services.numeric_v2_store
    created = store.create()
    story = numeric_v2_story()
    story["nodes"][0]["story_beat"]["opening_scene"] = "女主把旧信放在柜台上，抬头望向男主。"
    story["nodes"][0]["story_beat"]["character_state"] = {
        "catgirl_state": "女主手持旧信。",
        "player_state": "男主站在柜台旁。",
        "environment_state": "环境安静。",
        "continuity_from_previous": [],
        "scene_boundaries": ["双方仍是旧友。"],
    }
    project = store.finish_generation(created["project_id"], base_revision=created["revision"],
                                     story=story, mainline_node_ids=["start"])
    report = {"scope": "full_story_simple", "repair_plan_version": 3, "issues": [{"repairable": True, "target_node_ids": ["start"],
                          "repair_scope": "text", "repair_targets": [{"node_id": "start", "field": "/character_state/catgirl"}],
                          "problem": "开场已放下旧信，状态仍写手持。",
                          "modification_plan": "只修女主持物状态。"}]}
    from test_numeric_v2_generation import _reviewed_fixture
    _reviewed_fixture(report, NumericV2QualityAssessor._assessment_context(project["story"], project["setup"], project["authoring"]))
    project = store.record_quality_assessment(project["project_id"], report,
                                             base_revision=project["revision"])
    assessor = NumericV2QualityAssessor()
    services.numeric_v2_quality = assessor
    patch = {"catgirl_state": "女主双手空着，旧信已放在柜台上。"}
    assessor.call_llm = lambda *_args, **_kwargs: json.dumps({"node_updates": [{
        "node_id": "start", "story_beat": {"character_state": patch},
    }]}, ensure_ascii=False)
    url = f"/api/theater/numeric-v2/projects/{project['project_id']}/quality-nodes/start/optimize"
    response = app.test_client().post(url, json={"base_revision": project["revision"]})
    assert response.status_code == 200
    updated = store.get(project["project_id"])
    expected_story = deepcopy(project["story"])
    expected_story["nodes"][0]["story_beat"]["character_state"].update(patch)
    assert updated["story"] == expected_story
    assert updated["revision"] == project["revision"] + 1
    assert updated["authoring"]["quality_assessment"]["stale"] is True

    # 显式刷新报告后测试真正的非法补丁，避免仅被 stale 入口提前挡住。
    current = store.record_quality_assessment(updated["project_id"], report,
                                             base_revision=updated["revision"])
    patch = {"scene_boundaries": []}
    response = app.test_client().post(url, json={"base_revision": current["revision"]})
    assert response.status_code == 422
    assert response.get_json()["error"]["code"] == "invalid_quality_repair"
    assert store.get(current["project_id"]) == current


def test_numeric_v2_generate_persists_private_checkpoint_and_continues_same_revision(tmp_path):
    app = _app(tmp_path)
    client = app.test_client()
    services = app.extensions["numeric_services"]
    project = services.numeric_v2_store.create()
    project = services.numeric_v2_store.update(
        project["project_id"],
        base_revision=project["revision"],
        changes={"title": "续写测试", "setup": numeric_v2_setup()},
    )
    candidate = {"private_marker": "must_not_be_public"}
    received_checkpoints = []

    class FakeGenerator:
        def generate(self, *, title, setup, checkpoint=None, cast_names=None):
            received_checkpoints.append(checkpoint)
            if checkpoint is None:
                raise NumericV2GenerationError(
                    "invalid_mainline_generation",
                    issues=[{
                        "code": "required_text",
                        "path": "ending.summary",
                        "message": "结局摘要不能为空。",
                    }],
                    checkpoint={
                        "candidate": candidate,
                        "issues": [{"path": "ending.summary"}],
                    },
                    attempts=3,
                )
            assert checkpoint["candidate"] == candidate
            return {
                "story": numeric_v2_story(),
                "setup_updates": {"relationship": "续写完成", "tone": ["温柔"]},
                "mainline_node_ids": ["start"],
            }

        def generate_staged(self, *, save_checkpoint=None, **kwargs):
            return self.generate(**kwargs)

    services.numeric_v2_generator = FakeGenerator()
    first = client.post(
        f"/api/theater/numeric-v2/projects/{project['project_id']}/generate",
        json={"base_revision": project["revision"]},
    )

    assert first.status_code == 422
    first_payload = first.get_json()
    assert first_payload["error"]["details"]["attempts"] == 3
    failed_project = first_payload["error"]["details"]["project"]
    assert failed_project["generation_checkpoint"]["available"] is True
    assert "must_not_be_public" not in json.dumps(first_payload, ensure_ascii=False)

    second = client.post(
        f"/api/theater/numeric-v2/projects/{project['project_id']}/generate",
        json={"base_revision": failed_project["revision"]},
    )

    assert second.status_code == 200
    completed = second.get_json()["data"]["project"]
    assert received_checkpoints == [None, {"candidate": candidate, "issues": [{"path": "ending.summary"}]}]
    assert completed["generation_checkpoint"] is None
    assert completed["generation_state"] == "succeeded"
    assert completed["setup"]["relationship"] == "续写完成"


def test_numeric_v2_generate_rejects_incomplete_saved_setup_before_model(tmp_path):
    app = _app(tmp_path)
    client = app.test_client()
    services = app.extensions["numeric_services"]
    project = services.numeric_v2_store.create()

    response = client.post(
        f"/api/theater/numeric-v2/projects/{project['project_id']}/generate",
        json={"base_revision": project["revision"]},
    )

    assert response.status_code == 422
    assert response.get_json()["error"]["code"] == "generation_setup_invalid"


def test_numeric_v2_generate_does_not_require_metrics_or_relationship(tmp_path):
    app = _app(tmp_path)
    client = app.test_client()
    services = app.extensions["numeric_services"]
    project = services.numeric_v2_store.create()
    setup = numeric_v2_setup()
    setup["brief"] = "玩家回到封闭多年的旧剧院，与守护舞台秘密的猫娘重逢，两人必须在最后一次演出前查清火灾真相。"
    setup["relationship"] = ""
    setup["metrics"] = []
    project = services.numeric_v2_store.update(
        project["project_id"],
        base_revision=project["revision"],
        changes={"title": "最后一场演出", "setup": setup},
    )
    story = numeric_v2_story()
    story["metric_schema"] = {}
    story["initial_state"]["metrics"] = {}
    story["nodes"] = story["nodes"][:2]
    story["endings"] = story["endings"][:1]
    for node in story["nodes"]:
        node["route_gates"] = node["route_gates"][:1]
        for route in node["route_gates"]:
            route["conditions"] = {"all": []}

    class FakeGenerator:
        def generate(self, *, title, setup, cast_names=None, checkpoint=None):
            assert title == "最后一场演出"
            assert setup["relationship"] == ""
            assert setup["metrics"] == []
            return {
                "story": story,
                "setup_updates": {
                    "brief": "生成后的主线大纲",
                    "relationship": "因旧剧院秘密被迫重新合作的旧识",
                    "tone": ["悬疑", "克制"],
                },
            }

        def generate_staged(self, *, save_checkpoint=None, **kwargs):
            return self.generate(**kwargs)

    services.numeric_v2_generator = FakeGenerator()
    response = client.post(
        f"/api/theater/numeric-v2/projects/{project['project_id']}/generate",
        json={"base_revision": project["revision"]},
    )

    assert response.status_code == 200
    generated = response.get_json()["data"]["project"]
    assert generated["setup"]["metrics"] == []
    assert generated["setup"]["brief"] == setup["brief"]
    assert generated["setup"]["relationship"] == "因旧剧院秘密被迫重新合作的旧识"


def test_numeric_v2_generate_requires_more_than_thirty_characters(tmp_path):
    app = _app(tmp_path)
    client = app.test_client()
    store = app.extensions["numeric_services"].numeric_v2_store
    project = store.create()
    setup = numeric_v2_setup()
    setup["brief"] = "想" * 30
    project = store.update(
        project["project_id"],
        base_revision=project["revision"],
        changes={"setup": setup},
    )

    response = client.post(
        f"/api/theater/numeric-v2/projects/{project['project_id']}/generate",
        json={"base_revision": project["revision"]},
    )

    assert response.status_code == 422
    assert response.get_json()["error"]["code"] == "mainline_generation_input_too_short"


def test_numeric_v2_enhance_node_updates_only_ai_owned_story_beat_fields(tmp_path):
    app = _app(tmp_path)
    client = app.test_client()
    services = app.extensions["numeric_services"]
    story = numeric_v2_story()
    project = services.numeric_v2_store.import_story(story)
    calls = 0

    class FakeGenerator:
        def enhance_node(self, *, story, node_id, key_props):
            nonlocal calls
            calls += 1
            assert node_id == "ending_stay"
            assert story["nodes"][1]["type"] == "ending"
            assert key_props == []
            return {
                    "opening_scene": "雨停后，旧信与钥匙并排放在桌面上。",
                    "narrative_focus": "已经做出的选择正在把两人的关系推向一个可以收束的答案。",
                    "goals": [{
                    "id": "ending_stay_goal_01",
                    # 模拟成功输出也遵守终局交付合同，不能用待玩家执行任务当作合法结局。
                    "owner": "environment",
                    "description": "结局开场已展示桌面上并排的旧信与钥匙",
                    "evidence": {"mode": "semantic", "anchors": []},
                    "delivery": {
                        "type": "environment_fact",
                        "output_field": "scene_update",
                        "source_ids": ["opening.ending_stay"],
                        "timing": "opening",
                    },
                }],
                "must_not_happen": ["用突然出现的新证据改写旧信真相"],
                "catgirl_situation": "她仍有顾虑，但愿意让玩家参与未来安排。",
                "acting_contract": {
                    "cognition_state": "normal",
                    "memory_state": "available",
                    "self_reference_mode": "persona_allowed",
                    "persona_scope": "full",
                    "dialogue_policy": "required",
                    "allowed_behaviors": ["承接已经核验的旧信事实"],
                    "forbidden_behaviors": ["重新询问已经确认的身份"],
                },
                "transition_goal": "以克制而确定的方式收束两人的选择。",
            }

    services.numeric_v2_generator = FakeGenerator()
    original_node = story["nodes"][1]
    response = client.post(
        f"/api/theater/numeric-v2/projects/{project['project_id']}/nodes/ending_stay/enhance",
        json={"base_revision": project["revision"]},
    )

    assert response.status_code == 200
    assert calls == 1
    updated = response.get_json()["data"]["project"]
    node = next(item for item in updated["story"]["nodes"] if item["id"] == "ending_stay")
    assert updated["revision"] == project["revision"] + 1
    assert node["type"] == original_node["type"]
    assert node["chapter"] == original_node["chapter"]
    assert node["route_gates"] == original_node["route_gates"]
    assert node["ending_id"] == original_node["ending_id"]
    assert node["story_beat"]["opening_scene"] == "雨停后，旧信与钥匙并排放在桌面上。"
    assert node["story_beat"]["goals"][0]["owner"] == "environment"
    assert node["story_beat"]["acting_contract"]["memory_state"] == "available"
    ending = next(item for item in updated["story"]["endings"] if item["id"] == "stay")
    assert ending == story["endings"][0]


def test_numeric_v2_enhance_node_rejection_preserves_project_and_reports_issue(tmp_path):
    # 生成器拒绝坏结局后，API 必须呈现原因并保留旧稿、版本和报告，不能部分保存。
    app = _app(tmp_path)
    services = app.extensions["numeric_services"]
    project = services.numeric_v2_store.import_story(numeric_v2_story())
    issue = {"code": "ending_goal_contract_invalid", "path": "ordered_goals", "message": "结局不能新增普通回合任务。"}

    class RejectingGenerator:
        def enhance_node(self, **kwargs):
            raise NumericV2GenerationError("invalid_node_enhancement", issues=[issue])

    services.numeric_v2_generator = RejectingGenerator()
    response = app.test_client().post(
        f"/api/theater/numeric-v2/projects/{project['project_id']}/nodes/ending_stay/enhance",
        json={"base_revision": project["revision"]},
    )
    assert response.status_code == 422
    assert response.get_json()["error"]["details"]["issues"] == [issue]
    assert services.numeric_v2_store.get(project["project_id"]) == project


def test_numeric_v2_install_requires_verified_hash_and_records_result(tmp_path):
    app = _app(tmp_path)
    client = app.test_client()
    services = app.extensions["numeric_services"]
    compiled = services.numeric_v2_compiler.compile(numeric_v2_story())
    project = services.numeric_v2_store.import_story(compiled.story)
    project = services.numeric_v2_store.record_compile(
        project["project_id"],
        {"success": True, "package_hash": compiled.package_hash, "warnings": []},
        base_revision=project["revision"],
    )

    blocked = client.post(
        f"/api/theater/numeric-v2/projects/{project['project_id']}/install",
        json={"base_revision": project["revision"]},
    )
    assert blocked.status_code == 422

    services.numeric_v2_store.record_validation(
        project["project_id"],
        {"success": True, "package_hash": compiled.package_hash},
        base_revision=project["revision"],
    )

    class FakeBridge:
        def install(self, story):
            assert story["meta"]["story_id"] == "neko_numeric_drama_test"
            return {"story_id": "neko_numeric_drama_test", "path": str(tmp_path / "installed.json")}

    services.numeric_v2_bridge = FakeBridge()
    installed = client.post(
        f"/api/theater/numeric-v2/projects/{project['project_id']}/install",
        json={"base_revision": project["revision"]},
    )

    assert installed.status_code == 200
    assert installed.get_json()["data"]["install_result"]["story_id"] == "neko_numeric_drama_test"


def test_served_inspector_exposes_two_stage_scoring_and_failed_phase(tmp_path):
    # 页面实际引用源码模块，静态路由也必须交付新提示，不需要不存在的dist构建步骤。
    client = _app(tmp_path).test_client()
    assert '/theater-assets/src/main.js' in client.get('/').get_data(as_text=True)
    inspector = client.get('/theater-assets/src/story-inspector.js').get_data(as_text=True)
    copy = client.get('/theater-assets/src/copy.js').get_data(as_text=True)
    assert '先核对状态、行动主体和时间顺序' in inspector
    assert '原文依据' in inspector
    assert '上次完成的报告' in inspector
    assert '事实核对失败，文学评分尚未开始' in copy
    assert '事实已核对，文学评分失败' in copy
