from __future__ import annotations

from copy import deepcopy
from dataclasses import replace
import json
import pytest
from theater_generator.neko_v2_bridge import NekoV2Bridge as InProcessPackageGateway
from theater_generator.generation.numeric_v2 import NumericV2GenerationError, NumericV2Generator
from theater_generator.numeric_v2 import NumericV2Compiler
from theater_generator.numeric_v2_branch import NumericV2BranchError, NumericV2BranchService
from test_numeric_v2_branch import branchable_project, _ordered_goal, _path_result


"""New branches declare causal completion; legacy drafts keep their old mapping."""


def _case(project=None):
    project = project or branchable_project()
    service = NumericV2BranchService()
    options = service.options(project, "main_3")
    plan = service.prepare_path(
        project, source_node_id="main_3", endpoint_mode="mainline",
        endpoint_node_id="main_4", direction="先获准交付证物，再交付并致谢。",
        length=1, condition_selection={
            "mode": "fixed", "key": options["condition_candidates"][1]["key"],
        },
    )
    result = _path_result(plan)
    result["scenes"][0]["ordered_goals"] = [
        {**_ordered_goal("玩家允许将证物交给保管员。"), "owner": "player",
         "delivery_type": "player_action", "sources": ["player_input"]},
        {**_ordered_goal("保管员已经接稳证物。"), "owner": "environment",
         "delivery_type": "environment_fact"},
        _ordered_goal("猫娘感谢保管员。"),
    ]
    result["scenes"][0]["completion_facts"] = [
        {"id": fact_id, "description": text, "value_type": "bool",
         "target_value": True, "visibility": "public"}
        for fact_id, text in (
            ("handoff_allowed", "玩家允许将证物交给保管员。"),
            ("evidence_received", "保管员已经接稳证物。"),
            ("thanks_expressed", "猫娘感谢保管员。"),
        )
    ]
    # Courtesy is valid performance, but the author does not make it a prerequisite.
    result["transitions"][1]["trigger_fact_ids"] = ["handoff_allowed", "evidence_received"]
    return project, service, plan, result


def test_real_generator_preserves_explicit_completion_and_exit_choice():
    project, service, plan, result = _case()
    result["scenes"][0]["completion_facts"][1]["evidence_source"] = "performance"
    before = deepcopy(result)
    calls = []
    generator = NumericV2Generator()

    def model(messages, **kwargs):
        calls.append((messages, kwargs))
        return json.dumps(result, ensure_ascii=False)

    generator.call_llm = model
    actual = generator.generate_branch_path(context=plan["context"])
    assert actual == before
    assert len(calls) == 1
    prompt = calls[0][0][0]["content"]
    assert "completion_facts" in prompt
    example, _ = json.JSONDecoder().raw_decode(prompt.split("只输出 JSON object，不要 Markdown 或额外字段：\n", 1)[1])
    assert "evidence_source" not in example["scenes"][0]["completion_facts"][0]
    assert "玩家自主行动及由玩家单方作出的决定标 evidence_source=player_input" in prompt
    assert "trigger_fact_ids" in prompt
    assert "不能从最后一个感谢、回应或 ordered_goal 反推先前步骤已完成" in prompt
    assert "fallback_offer 与 accept_input 公开邀约、明确接受同一新安排" in prompt

    draft = service.finish_path(plan, actual)
    story, _, _ = service.build_story(project, draft)
    compiled = NumericV2Compiler(InProcessPackageGateway()).compile(story)
    facts = compiled.story["fact_contract"]["facts"]
    prefix = f"scene:{draft['scene_ids'][0]}:"
    assert facts[prefix + "evidence_received"]["evidence_source"] == "performance"
    assert "evidence_source" not in facts[prefix + "handoff_allowed"]


def test_legacy_draft_is_readable_but_cannot_be_returned_by_fresh_generation():
    project, service, plan, _ = _case()
    legacy = _path_result(plan)
    draft = service.finish_path(plan, legacy)
    story, _, _ = service.build_story(project, draft)
    key = f"scene:{draft['scene_ids'][0]}:branch_complete"
    assert story["fact_contract"]["facts"][key]["description"] == legacy["scenes"][0]["ordered_goals"][-1]["description"]
    assert "completion_facts" not in draft["scenes"][0]
    generator = NumericV2Generator()
    generator.call_llm = lambda *_args, **_kwargs: json.dumps(legacy, ensure_ascii=False)
    with pytest.raises(NumericV2GenerationError):
        generator.generate_branch_path(context=plan["context"])


@pytest.mark.parametrize("damage,path", [
    ("missing_facts", "scenes[0].completion_facts"),
    ("empty_facts", "scenes[0].completion_facts"),
    ("type", "scenes[0].completion_facts[0]"),
    ("duplicate", "scenes[0].completion_facts[1]"),
    ("missing_triggers", "transitions[1].trigger_fact_ids"),
    ("empty_triggers", "transitions[1].trigger_fact_ids"),
    ("unknown_trigger", "transitions[1].trigger_fact_ids"),
])
def test_new_generation_rejects_incomplete_or_invalid_completion_contract(damage, path):
    _, _, plan, result = _case()
    scene, transition = result["scenes"][0], result["transitions"][1]
    if damage == "missing_facts":
        del scene["completion_facts"]
    elif damage == "empty_facts":
        scene["completion_facts"] = []
    elif damage == "type":
        scene["completion_facts"][0]["target_value"] = 1
    elif damage == "duplicate":
        scene["completion_facts"][1]["id"] = scene["completion_facts"][0]["id"]
    elif damage == "missing_triggers":
        del transition["trigger_fact_ids"]
    elif damage == "empty_triggers":
        transition["trigger_fact_ids"] = []
    else:
        transition["trigger_fact_ids"] = ["unwritten_result"]
    generator = NumericV2Generator()
    generator.call_llm = lambda *_args, **_kwargs: json.dumps(result, ensure_ascii=False)
    with pytest.raises(NumericV2GenerationError) as caught:
        generator.generate_branch_path(context=plan["context"])
    assert caught.value.issues[0]["path"] == path


def test_explicit_completion_cannot_silently_fall_back_when_a_draft_is_malformed():
    project, service, plan, result = _case()
    draft = service.finish_path(plan, result)
    draft["transitions"][1]["trigger_fact_ids"] = ["unwritten_result"]
    before = deepcopy(project)
    with pytest.raises(NumericV2BranchError):
        service.build_story(project, draft)
    assert project == before


def test_new_branch_display_completion_preserves_original_text_without_semantic_surrogate():
    project, service, plan, result = _case()
    scene = result["scenes"][0]
    scene["fixed_narrations"] = [{
        "id": "receipt", "text": "交接记录：\n编号 07；保管方已签收。",
        "trigger": {"type": "entry"}, "after": [], "required_before_exit": False,
    }]
    scene["completion_facts"].append({
        "id": "receipt_displayed", "description": "交接记录原文已经展示。",
        "value_type": "bool", "target_value": True, "visibility": "public",
        "fixed_narration_id": "receipt",
    })
    result["transitions"][1]["trigger_fact_ids"].append("receipt_displayed")
    draft = service.finish_path(plan, result)
    story, _, _ = service.build_story(project, draft)
    compiled = NumericV2Compiler(InProcessPackageGateway()).compile(story)
    node = next(node for node in compiled.story["nodes"] if node["id"] == draft["scene_ids"][0])
    assert node["completion_contract"]["all"][-1] == {"fixed_narration_id": "receipt"}
    assert node["story_beat"]["fixed_narrations"] == scene["fixed_narrations"]
    assert f"scene:{node['id']}:receipt_displayed" not in story["fact_contract"]["facts"]


@pytest.mark.parametrize("field,value", [
    ("id", "含糊标识"), ("value_type", "object"), ("visibility", "private"),
    ("description", ""), ("fixed_narration_id", "missing"),
])
def test_explicit_branch_fact_rejects_invalid_declarations(field, value):
    _, service, plan, result = _case()
    result["scenes"][0]["completion_facts"][0][field] = value
    with pytest.raises(NumericV2BranchError) as caught:
        service.finish_path(plan, result)
    assert caught.value.details["path"] == "scenes[0].completion_facts[0]"
