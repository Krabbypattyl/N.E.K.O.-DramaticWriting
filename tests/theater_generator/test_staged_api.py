"""Exercise the standalone HTTP adapter with the SDK's real staged pipeline."""

from copy import deepcopy

import pytest

from base_agent import LLMCallFailure
from numeric_v2_fixture import numeric_v2_story
from prompt_support import prompt_payload
from test_numeric_v2_api import _app
from test_numeric_v2_generation import _generation_setup, _idea_outline
from test_staged_generation import staged_reply
from theater_generator.neko_v2_bridge import NekoV2BridgeError


def prepared_project(app):
    store = app.extensions["numeric_services"].numeric_v2_store
    project = store.create()
    return store.update(project["project_id"], base_revision=project["revision"], changes={
        "title": "逐幕续写", "setup": _generation_setup(), "story": numeric_v2_story(),
    })


def test_http_resume_after_reopen_keeps_completed_phases_and_old_story(tmp_path):
    app = _app(tmp_path)
    services = app.extensions["numeric_services"]
    project = prepared_project(app)
    outline = _idea_outline(3)
    calls = []

    def model(messages, **options):
        operation = options["operation"]
        context = prompt_payload(messages[1]["content"])
        calls.append((operation, context.get("chapter_index")))
        if operation == "numeric_v2_chapter_generation" and context["chapter_index"] == 2:
            return LLMCallFailure("offline", error_code="model_connection_failed", exception_type="ConnectionError")
        return staged_reply(messages, operation, outline)

    services.numeric_v2_generator.call_llm = model
    path = f"/api/theater/numeric-v2/projects/{project['project_id']}/generate"
    response = app.test_client().post(path, json={"base_revision": project["revision"]})
    assert response.status_code == 502
    saved = services.numeric_v2_store.get(project["project_id"])
    assert saved["story"] == project["story"]
    assert saved["revision"] == project["revision"]
    assert saved["generation_checkpoint"]["available"] is True
    assert "_generation_checkpoint" not in saved
    assert services.numeric_v2_store.generation_checkpoint(project["project_id"])["completed_chapters"] == 1

    reopened = _app(tmp_path)
    services = reopened.extensions["numeric_services"]
    calls.clear()

    def resume_model(messages, **options):
        context = prompt_payload(messages[1]["content"])
        calls.append((options["operation"], context.get("chapter_index")))
        return staged_reply(messages, options["operation"], outline)

    services.numeric_v2_generator.call_llm = resume_model
    response = reopened.test_client().post(path, json={"base_revision": project["revision"]})
    assert response.status_code == 200, response.get_json()
    completed = response.get_json()["data"]["project"]
    assert len(calls) == 6
    assert ("numeric_v2_story_frame", None) not in calls
    assert ("numeric_v2_chapter_generation", 1) not in calls
    assert completed["generation_checkpoint"] is None
    assert completed["revision"] == project["revision"] + 1
    assert completed["story"]["meta"]["story_id"] == project["story"]["meta"]["story_id"]
    services.numeric_v2_compiler.compile(completed["story"])


def test_final_compile_failure_preserves_map_and_schedules_only_affected_scene(tmp_path, monkeypatch):
    app = _app(tmp_path)
    services = app.extensions["numeric_services"]
    project = prepared_project(app)
    outline = _idea_outline(3)
    services.numeric_v2_generator.call_llm = lambda messages, **options: staged_reply(messages, options["operation"], outline)
    original_compile = services.numeric_v2_compiler.compile

    def reject(_story):
        raise NekoV2BridgeError("numeric_v2_compile_failed", {"issues": [{
            "code": "native_scene_invalid", "path": "nodes[1].story_beat.summary", "message": "检查第二幕。",
        }]})

    monkeypatch.setattr(services.numeric_v2_compiler, "compile", reject)
    path = f"/api/theater/numeric-v2/projects/{project['project_id']}/generate"
    response = app.test_client().post(path, json={"base_revision": project["revision"]})
    assert response.status_code == 422
    assert services.numeric_v2_store.get(project["project_id"])["story"] == project["story"]
    checkpoint = services.numeric_v2_store.generation_checkpoint(project["project_id"])
    assert checkpoint["stage"] == "repair"
    assert checkpoint["repairs"] == [1]
    monkeypatch.setattr(services.numeric_v2_compiler, "compile", original_compile)
    calls = []

    def repair(messages, **options):
        context = prompt_payload(messages[1]["content"])
        calls.append((options["operation"], context.get("chapter_index")))
        return staged_reply(messages, options["operation"], outline)

    services.numeric_v2_generator.call_llm = repair
    response = app.test_client().post(path, json={"base_revision": project["revision"]})
    assert response.status_code == 200, response.get_json()
    assert [index for operation, index in calls if operation == "numeric_v2_chapter_generation"] == [2]
    assert not any(operation in {"numeric_v2_story_frame", "numeric_v2_ending_generation"} for operation, _ in calls)


def test_unexpected_generation_error_does_not_leave_running_state(tmp_path, monkeypatch):
    app = _app(tmp_path)
    services = app.extensions["numeric_services"]
    project = prepared_project(app)
    previous = deepcopy(project)

    def fail(**_kwargs):
        raise RuntimeError("test technical failure")

    monkeypatch.setattr(services.numeric_v2_generator, "generate_staged", fail)
    with pytest.raises(RuntimeError, match="test technical failure"):
        app.test_client().post(f"/api/theater/numeric-v2/projects/{project['project_id']}/generate",
                               json={"base_revision": project["revision"]})
    saved = services.numeric_v2_store.get(project["project_id"])
    assert saved["generation_state"] == "failed"
    assert saved["generation_error"]["code"] == "generation_technical_failed"
    assert saved["story"] == previous["story"]
    assert saved["revision"] == previous["revision"]
