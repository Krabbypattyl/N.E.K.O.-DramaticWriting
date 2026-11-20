from __future__ import annotations

from copy import deepcopy
from types import SimpleNamespace

import pytest

import theater_generator.api as api
from numeric_v2_fixture import numeric_v2_story


@pytest.fixture
def publication(monkeypatch, tmp_path):
    monkeypatch.setattr(api, "NumericV2Generator", lambda: object())
    monkeypatch.setattr(api, "NumericV2QualityAssessor", lambda: object())
    app = api.create_app(project_root=tmp_path)
    app.config.update(TESTING=True)
    services = app.extensions["numeric_services"]
    project = services.numeric_v2_store.create()
    story = numeric_v2_story()
    project = services.numeric_v2_store.update(project["project_id"], base_revision=1, changes={"story": story})
    calls = []
    def install(value):
        calls.append("install")
        return {"story_id": value["meta"]["story_id"], "package_hash": "sha256:test"}
    def compile_story(value):
        calls.append("compile")
        return SimpleNamespace(package_hash="sha256:test", story_id=value["meta"]["story_id"], json_bytes=b"{}")
    services.numeric_v2_bridge = SimpleNamespace(install=install)
    services.numeric_v2_compiler = SimpleNamespace(compile=compile_story)
    services.numeric_v2_store._compiler = SimpleNamespace(compile_core=lambda value: SimpleNamespace(package_hash="sha256:test"))
    return app, services.numeric_v2_store, project, calls


@pytest.mark.parametrize("invalid", ["missing", "compile_failed", "old_revision", "hash_mismatch", "empty_hash", "validation_failed"])
@pytest.mark.parametrize("action", ["export", "install"])
def test_publication_rejects_same_invalid_receipts_before_bridge(publication, invalid, action):
    app, store, project, calls = publication
    revision = project["revision"]
    project["compile_result"] = {"success": True, "revision": revision, "package_hash": "sha256:test"}
    project["neko_validation"] = {"success": True, "package_hash": "sha256:test"}
    if invalid == "missing":
        project["compile_result"] = project["neko_validation"] = None
    elif invalid == "compile_failed":
        project["compile_result"]["success"] = False
    elif invalid == "old_revision":
        project["compile_result"]["revision"] = revision - 1
    elif invalid == "hash_mismatch":
        project["neko_validation"]["package_hash"] = "sha256:other"
    elif invalid == "empty_hash":
        project["compile_result"]["package_hash"] = project["neko_validation"]["package_hash"] = ""
    elif invalid == "validation_failed":
        project["neko_validation"]["success"] = False
    store._write(project)
    url = f"/api/theater/numeric-v2/projects/{project['project_id']}/{action}"
    client = app.test_client()
    response = client.get(url) if action == "export" else client.post(url, json={"base_revision": revision})
    assert response.status_code == 422
    assert response.get_json()["error"]["code"] == "current_neko_validation_required"
    assert calls == []


@pytest.mark.parametrize("action", ["export", "install"])
def test_legacy_hash_receipt_survives_content_neutral_save(publication, action):
    app, store, project, calls = publication
    project = store.record_compile(project["project_id"], {"success": True, "package_hash": "sha256:test"}, base_revision=project["revision"])
    project = store.record_validation(project["project_id"], {"package_hash": "sha256:test"}, base_revision=project["revision"])
    assert project["neko_validation"]["revision"] == project["revision"]
    project = store.update(project["project_id"], base_revision=project["revision"], changes={"editor": {"node_positions": {}}})
    url = f"/api/theater/numeric-v2/projects/{project['project_id']}/{action}"
    client = app.test_client()
    response = client.get(url) if action == "export" else client.post(url, json={"base_revision": project["revision"]})
    assert response.status_code == 200
    assert calls == (["compile"] if action == "export" else ["install"])


def _import_payload(app):
    story = numeric_v2_story()
    app.extensions["numeric_services"].numeric_v2_compiler = SimpleNamespace(
        compile=lambda value: SimpleNamespace(story=deepcopy(value), package_hash="sha256:test", warnings=()),
    )
    return {"story": story}


def test_import_saves_complete_compiled_project_once(publication, monkeypatch):
    app, store, _, _ = publication
    payload = _import_payload(app)
    writes = []
    original = store._write
    def record(project):
        writes.append(deepcopy(project))
        original(project)
    monkeypatch.setattr(store, "_write", record)
    response = app.test_client().post("/api/theater/numeric-v2/projects/import", json=payload)
    assert response.status_code == 201
    project = response.get_json()["data"]
    assert len(writes) == 1
    assert writes[0]["story"] == payload["story"]
    assert project["revision"] == 2
    assert project["compile_result"] == {"success": True, "package_hash": "sha256:test", "warnings": [], "revision": 2}
    assert project["neko_validation"] is project["install_result"] is None


def test_import_final_write_failure_leaves_no_blank_project(publication, monkeypatch):
    app, store, _, _ = publication
    payload = _import_payload(app)
    before = sorted(path.name for path in store.root.iterdir())
    original = store._write
    def fail_final(project):
        if project.get("story") is not None:
            raise OSError("isolated final write failure")
        original(project)
    monkeypatch.setattr(store, "_write", fail_final)
    with pytest.raises(OSError):
        app.test_client().post("/api/theater/numeric-v2/projects/import", json=payload)
    assert sorted(path.name for path in store.root.iterdir()) == before


def test_import_fsync_failure_cleans_temporary_file(publication, monkeypatch):
    app, store, _, _ = publication
    payload = _import_payload(app)
    before = sorted(path.name for path in store.root.iterdir())
    import theater_generator.numeric_v2_project_store as store_module
    def fail(*args):
        raise OSError("isolated fsync failure")
    monkeypatch.setattr(store_module.os, "fsync", fail)
    with pytest.raises(OSError):
        app.test_client().post("/api/theater/numeric-v2/projects/import", json=payload)
    assert sorted(path.name for path in store.root.iterdir()) == before


def test_import_compile_rejection_writes_nothing(publication):
    app, store, _, _ = publication
    before = sorted(path.name for path in store.root.iterdir())
    def reject(value):
        raise api.NekoV2BridgeError("numeric_v2_compile_failed")
    app.extensions["numeric_services"].numeric_v2_compiler = SimpleNamespace(compile=reject)
    response = app.test_client().post("/api/theater/numeric-v2/projects/import", json={"story": numeric_v2_story()})
    assert response.status_code == 422
    assert sorted(path.name for path in store.root.iterdir()) == before
