"""Flask API for the N.E.K.O Numeric story generator."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import asdict, dataclass
from io import BytesIO
import os
from pathlib import Path
from typing import Any, Literal
import uuid

from flask import Flask, jsonify, request, send_file, send_from_directory
from flask_cors import CORS
from pydantic import Field, ValidationError, field_validator

import config

from .generation.numeric_v2 import NumericV2GenerationError, NumericV2Generator
from .generation.quality import NumericV2QualityAssessor, QualityAssessmentError
from .neko_v2_bridge import NekoV2Bridge, NekoV2BridgeError
from .numeric_v2 import NumericV2Compiler, normalize_metric_drafts, preset_metric_catalog
from .numeric_v2_branch import NumericV2BranchError, NumericV2BranchService
from .tokenize import count_tokens
from .numeric_v2_project_store import (
    NumericV2ProjectError,
    NumericV2ProjectNotFoundError,
    NumericV2ProjectStore,
    NumericV2RevisionConflictError,
)


from .contracts import (
    StrictPayload,
    RevisionPayload,
    ProjectUpdatePayload,
    NumericV2ImportPayload,
    NumericV2AllocateIdPayload,
    BranchConditionSelectionPayload,
    BranchGoalContractPayload,
    BranchActingContractPayload,
    BranchCharacterStatePayload,
    BranchEndingContractPayload,
    BranchEndingDraftPayload,
    BranchPathDraftPayload,
    BranchApplyPayload,
    MainlineOrderPayload,
    MetricBandPayload,
    MetricPayload,
    NumericV2SetupPayload,
)



class ModelSettingsPayload(StrictPayload):
    """模型设置成功持久化到本机后，才更新当前服务进程。"""

    provider: Literal["qwen", "zhipu"]
    api_key: str = Field(default="", max_length=512)
    model: str = Field(default="", max_length=160)
    base_url: str = Field(default="", max_length=512)

    @field_validator("api_key", "model", "base_url")
    @classmethod
    def strip_model_setting(cls, value: str) -> str:
        return value.strip()


@dataclass
class NumericServices:
    """当前应用唯一持有的剧本生成服务。"""

    numeric_v2_bridge: NekoV2Bridge
    numeric_v2_compiler: NumericV2Compiler
    numeric_v2_generator: NumericV2Generator
    numeric_v2_quality: NumericV2QualityAssessor
    numeric_v2_branch: NumericV2BranchService
    numeric_v2_store: NumericV2ProjectStore


def _ok(data: Any):
    return jsonify({"success": True, "data": data})


def _error(code: str, *, status: int, details: dict[str, Any] | None = None):
    payload: dict[str, Any] = {"success": False, "error": {"code": code}}
    if details:
        payload["error"]["details"] = details
    return jsonify(payload), status


def _model_generation_status(code: str) -> int:
    """把模型服务错误映射为稳定 HTTP 状态。"""

    return {
        "model_timeout": 504,
        "model_connection_failed": 502,
        "model_provider_error": 502,
        "model_auth_failed": 502,
        "model_rate_limited": 429,
        "model_request_invalid": 422,
    }.get(code, 422)


def _model_generation_details(error: NumericV2GenerationError) -> dict[str, Any]:
    """只返回可公开的模型诊断和确定性合同问题。"""

    details: dict[str, Any] = {}
    if error.issues:
        details["issues"] = [
            asdict(issue) if hasattr(issue, "__dataclass_fields__") else dict(issue)
            for issue in error.issues
        ]
    if error.provider_details:
        details["provider"] = error.provider_details
    if error.attempts:
        details["attempts"] = error.attempts
    return details


def _project_summary(project: dict[str, Any]) -> dict[str, Any]:
    story = project.get("story") or {}
    return {
        "project_id": project["project_id"],
        "revision": project["revision"],
        "title": project["title"],
        "updated_at": project["updated_at"],
        "stage": project["stage"],
        "status": project["status"],
        "brief": (project.get("setup") or {}).get("brief", ""),
        "metric_count": len((project.get("setup") or {}).get("metrics") or []),
        "node_count": len(story.get("nodes") or []),
        "ending_count": len(story.get("endings") or []),
    }


def _require_current_neko_validation(project: dict[str, Any]) -> dict[str, Any]:
    """Share delivery prerequisites while accepting existing hash-bound receipts."""
    compiled = project.get("compile_result") or {}
    validation = project.get("neko_validation") or {}
    package_hash = compiled.get("package_hash")
    if (
        compiled.get("success") is not True
        or compiled.get("revision") != project["revision"]
        or not isinstance(package_hash, str)
        or not package_hash.strip()
        or validation.get("success") is not True
        or validation.get("package_hash") != package_hash
    ):
        raise NumericV2ProjectError("current_neko_validation_required")
    return compiled


def create_app(*, project_root: Path | None = None) -> Flask:
    """创建只暴露 Numeric 能力和模型设置的应用。"""

    frontend_root = Path(__file__).resolve().parents[1] / "frontend" / "theater"
    app = Flask(
        __name__,
        static_folder=str(frontend_root),
        static_url_path="/theater-assets",
    )
    CORS(app)

    # 主线生成只产出作者草稿；交付统一使用 Numeric v2 确定性编译器。
    bridge = NekoV2Bridge()
    v2_compiler = NumericV2Compiler(bridge)
    resolved_project_root = Path(
        project_root
        or os.environ.get("NEKO_NUMERIC_DRAMA_PROJECT_ROOT", "")
        or os.environ.get("INKAI_NUMERIC_V2_PROJECT_ROOT", "")
        or (Path(__file__).resolve().parents[1] / "data" / "numeric_v2_projects")
    )
    services = NumericServices(
        numeric_v2_bridge=bridge,
        numeric_v2_compiler=v2_compiler,
        numeric_v2_generator=NumericV2Generator(),
        numeric_v2_quality=NumericV2QualityAssessor(),
        numeric_v2_branch=NumericV2BranchService(token_counter=count_tokens),
        numeric_v2_store=NumericV2ProjectStore(resolved_project_root, compiler=v2_compiler),
    )
    app.extensions["numeric_services"] = services

    @app.get("/")
    def service_index():
        return send_from_directory(frontend_root, "index.html")

    @app.get("/projects/new")
    @app.get("/projects/<project_id>")
    def workspace_index(project_id: str | None = None):
        return send_from_directory(frontend_root, "index.html")

    @app.get("/api/status")
    def service_status():
        return _ok({"service": "N.E.K.O.-DramaticWriting", "schema": "neko.story.numeric.v2"})

    @app.get("/api/settings/model")
    def get_model_settings():
        return _ok(config.public_model_config())

    @app.put("/api/settings/model")
    def update_model_settings():
        try:
            payload = ModelSettingsPayload.model_validate(request.get_json() or {})
            config.configure_model(
                payload.provider,
                api_key=payload.api_key,
                model=payload.model,
                base_url=payload.base_url,
            )
        except ValidationError as error:
            return _error(
                "invalid_model_settings",
                status=422,
                details={
                    "fields": error.errors(
                        include_url=False,
                        include_context=False,
                        include_input=False,
                    )
                },
            )
        except ValueError as error:
            code = str(error)
            message = (
                "请填写 API Key 后再保存。"
                if code == "model_api_key_required"
                else "暂不支持该模型服务商。"
            )
            return _error(code, status=422, details={"message": message})
        except OSError:
            return _error("model_settings_save_failed", status=500)
        return _ok(config.public_model_config())

    @app.get("/api/theater/numeric-v2/metric-presets")
    def numeric_v2_metric_presets():
        return _ok(preset_metric_catalog())

    @app.get("/api/theater/numeric-v2/projects")
    def list_numeric_v2_projects():
        return _ok([_project_summary(project) for project in services.numeric_v2_store.list()])

    @app.post("/api/theater/numeric-v2/projects")
    def create_numeric_v2_project():
        return _ok(services.numeric_v2_store.create()), 201

    @app.post("/api/theater/numeric-v2/projects/import")
    def import_numeric_v2_project():
        payload = NumericV2ImportPayload.model_validate(request.get_json() or {})
        compiled = services.numeric_v2_compiler.compile(payload.story)
        project = services.numeric_v2_store.import_story(
            compiled.story,
            compile_result={
                "success": True,
                "package_hash": compiled.package_hash,
                "warnings": [asdict(item) for item in compiled.warnings],
            },
        )
        return _ok(project), 201

    @app.get("/api/theater/numeric-v2/projects/<project_id>")
    def get_numeric_v2_project(project_id: str):
        return _ok(services.numeric_v2_store.get(project_id))

    @app.post("/api/theater/numeric-v2/projects/<project_id>/allocate-id")
    def allocate_numeric_v2_id(project_id: str):
        services.numeric_v2_store.get(project_id)
        payload = NumericV2AllocateIdPayload.model_validate(request.get_json() or {})
        return _ok({"id": f"{payload.kind}_{uuid.uuid4().hex[:10]}"})

    @app.patch("/api/theater/numeric-v2/projects/<project_id>")
    def update_numeric_v2_project(project_id: str):
        payload = ProjectUpdatePayload.model_validate(request.get_json() or {})
        return _ok(services.numeric_v2_store.update(
            project_id,
            base_revision=payload.base_revision,
            changes=payload.changes,
        ))

    @app.delete("/api/theater/numeric-v2/projects/<project_id>")
    def delete_numeric_v2_project(project_id: str):
        payload = RevisionPayload.model_validate(request.get_json() or {})
        current = services.numeric_v2_store.get(project_id)
        if current["revision"] != payload.base_revision:
            raise NumericV2RevisionConflictError(current)
        services.numeric_v2_store.delete(project_id)
        return _ok({"project_id": project_id, "deleted": True})

    @app.post("/api/theater/numeric-v2/projects/<project_id>/generate")
    def generate_numeric_v2_project(project_id: str):
        payload = RevisionPayload.model_validate(request.get_json() or {})
        project = services.numeric_v2_store.get(project_id)
        if project["revision"] != payload.base_revision:
            raise NumericV2RevisionConflictError(project)
        if not project["title"].strip():
            return _error("generation_setup_invalid", status=422, details={"fields": [{"loc": ["title"], "msg": "请填写剧本标题。"}]})
        try:
            normalized_setup = dict(project["setup"])
            normalized_setup["metrics"] = normalize_metric_drafts(list(normalized_setup.get("metrics") or []))
            setup = NumericV2SetupPayload.model_validate(normalized_setup)
        except ValidationError as error:
            return _error(
                "generation_setup_invalid",
                status=422,
                details={"fields": error.errors(include_url=False, include_context=False, include_input=False)},
            )
        except ValueError as error:
            # 作者在保存阶段填写越界限幅时直接指出 v2.2 规则，不让异常变成 500。
            code = str(error) or "generation_setup_invalid"
            return _error(code, status=422)
        checkpoint = services.numeric_v2_store.generation_checkpoint(project_id)
        # 姓名来自本体而非前端；同一失败候选续写沿用其快照，旧检查点保持旧槽位。
        cast_names = (
            checkpoint.get("cast_names") if checkpoint is not None
            else services.numeric_v2_bridge.authoring_names()
        )
        services.numeric_v2_store.begin_generation(project_id, base_revision=payload.base_revision)
        try:
            generation_args = {
                "title": project["title"], "setup": setup.model_dump(),
                "cast_names": cast_names, "checkpoint": checkpoint,
            }
            if checkpoint is not None and checkpoint.get("flow") != "staged.v1":
                result = services.numeric_v2_generator.generate(**generation_args)
            else:
                result = services.numeric_v2_generator.generate_staged(
                    **generation_args,
                    save_checkpoint=lambda state: services.numeric_v2_store.record_generation_checkpoint(
                        project_id, base_revision=payload.base_revision, checkpoint=state,
                    ),
                )
                checkpoint = services.numeric_v2_store.generation_checkpoint(project_id)
            previous_story_id = ((project.get("story") or {}).get("meta") or {}).get("story_id")
            result["story"]["meta"]["story_id"] = previous_story_id or (
                "story_" + project_id.removeprefix("project_")
            )
            services.numeric_v2_compiler.compile(result["story"])
        except NumericV2RevisionConflictError:
            raise
        except NekoV2BridgeError as error:
            if checkpoint is not None and checkpoint.get("flow") == "staged.v1" and checkpoint.get("stage") == "complete":
                from .generation.staged import set_native_repair_phase

                set_native_repair_phase(checkpoint, list(error.details.get("issues") or []))
            failed = services.numeric_v2_store.fail_generation(
                project_id, base_revision=payload.base_revision,
                error={"code": error.code, "details": error.details},
                checkpoint=checkpoint, source_project=project,
            )
            return _error(error.code, status=422, details={**error.details, "project": failed})
        except NumericV2GenerationError as error:
            details = _model_generation_details(error)
            failed = services.numeric_v2_store.fail_generation(
                project_id,
                base_revision=payload.base_revision,
                error={"code": error.code, "details": details},
                checkpoint=error.checkpoint,
                source_project=project,
            )
            details["project"] = failed
            return _error(error.code, status=_model_generation_status(error.code), details=details)
        except Exception as error:
            services.numeric_v2_store.fail_generation(
                project_id, base_revision=payload.base_revision,
                error={"code": "generation_technical_failed", "exception_type": type(error).__name__},
                checkpoint=getattr(error, "checkpoint", checkpoint), source_project=project,
            )
            raise
        generated_setup = setup.model_dump()
        # 创作想法始终保留作者原文；主线模型只允许回填派生的关系和基调。
        setup_updates = result.get("setup_updates") or {}
        for field in ("relationship", "tone"):
            if field in setup_updates:
                generated_setup[field] = setup_updates[field]
        updated = services.numeric_v2_store.finish_generation(
            project_id,
            base_revision=payload.base_revision,
            story=result["story"],
            setup=generated_setup,
            mainline_node_ids=list(result.get("mainline_node_ids") or []),
            relationship_arc=result.get("relationship_arc") or {},
            character_state_arc=result.get("character_state_arc") or {},
            key_props=list(result.get("key_props") or []),
            pacing_diagnostics=result.get("pacing_diagnostics"),
        )
        return _ok({"project": updated})

    @app.get("/api/theater/numeric-v2/projects/<project_id>/nodes/<node_id>/branch-options")
    def numeric_v2_branch_options(project_id: str, node_id: str):
        project = services.numeric_v2_store.get(project_id)
        return _ok(services.numeric_v2_branch.options(project, node_id))

    @app.post("/api/theater/numeric-v2/projects/<project_id>/quality-assessment")
    def assess_numeric_v2_quality(project_id: str):
        """只在作者显式点击后评分；本接口不修改 Story Package。"""

        payload = RevisionPayload.model_validate(request.get_json() or {})
        project = services.numeric_v2_store.get(project_id)
        if project["revision"] != payload.base_revision:
            raise NumericV2RevisionConflictError(project)
        if not isinstance(project.get("story"), dict):
            return _error("project_story_required", status=422)
        try:
            assessment = services.numeric_v2_quality.assess(
                story=project["story"],
                setup=project["setup"],
                authoring=project["authoring"],
            )
        except QualityAssessmentError as error:
            status = 422
            if error.code in {
                "model_timeout",
                "model_connection_failed",
                "model_provider_error",
                "model_auth_failed",
                "model_rate_limited",
                "model_request_invalid",
            }:
                status = _model_generation_status(error.code)
            return _error(
                error.code,
                status=status,
                # 沿用先完整评分后保存的边界；前端需要知道哪一步未完成，不能显示半份分数。
                details={**({"provider": error.provider_details} if error.provider_details else {}),
                         **({"phase": error.phase} if error.phase else {})},
            )
        updated = services.numeric_v2_store.record_quality_assessment(
            project_id,
            assessment,
            base_revision=payload.base_revision,
        )
        return _ok({"project": updated})

    @app.post("/api/theater/numeric-v2/projects/<project_id>/quality-nodes/<node_id>/optimize")
    def optimize_numeric_v2_quality_node(project_id: str, node_id: str):
        """作者在故事地图确认后，合并建议并只优化所点击的节点。"""

        payload = RevisionPayload.model_validate(request.get_json() or {})
        project = services.numeric_v2_store.get(project_id)
        if project["revision"] != payload.base_revision:
            raise NumericV2RevisionConflictError(project)
        assessment = (project.get("authoring") or {}).get("quality_assessment")
        if not isinstance(assessment, dict):
            return _error("quality_assessment_required", status=422)
        if assessment.get("stale") is True:
            return _error("quality_assessment_stale", status=409)
        # 旧报告缺少本轮证据、字段及方案复核，用户已确认须重新评分后再开放优化。
        if assessment.get("repair_plan_version") != 3:
            return _error("quality_reassessment_required", status=409)
        try:
            story = services.numeric_v2_quality.optimize_node(
                story=project["story"],
                setup=project["setup"],
                authoring=project["authoring"],
                assessment=assessment,
                node_id=node_id,
            )
        except QualityAssessmentError as error:
            status = 422
            if error.code == "quality_issue_stale":
                status = 409
            elif error.code in {
                "model_timeout",
                "model_connection_failed",
                "model_provider_error",
                "model_auth_failed",
                "model_rate_limited",
                "model_request_invalid",
            }:
                status = _model_generation_status(error.code)
            return _error(
                error.code,
                status=status,
                details=({"provider": error.provider_details} if error.provider_details else None),
            )
        updated = services.numeric_v2_store.update(
            project_id,
            base_revision=payload.base_revision,
            changes={"story": story},
        )
        return _ok({"project": updated, "optimized_node_id": node_id})

    @app.put("/api/theater/numeric-v2/projects/<project_id>/mainline-order")
    def update_numeric_v2_mainline_order(project_id: str):
        payload = MainlineOrderPayload.model_validate(request.get_json() or {})
        project = services.numeric_v2_store.set_mainline_order(
            project_id,
            base_revision=payload.base_revision,
            node_ids=payload.node_ids,
        )
        return _ok(project)

    @app.get("/api/theater/numeric-v2/projects/<project_id>/branch-drafts/<draft_id>")
    def get_numeric_v2_branch_draft(project_id: str, draft_id: str):
        return _ok(services.numeric_v2_store.get_branch_draft(project_id, draft_id))

    @app.post("/api/theater/numeric-v2/projects/<project_id>/branch-ending-drafts")
    def create_numeric_v2_branch_ending_draft(project_id: str):
        payload = BranchEndingDraftPayload.model_validate(request.get_json() or {})
        project = services.numeric_v2_store.get(project_id)
        if project["revision"] != payload.base_revision:
            raise NumericV2RevisionConflictError(project)
        plan = services.numeric_v2_branch.prepare_ending(
            project,
            source_node_id=payload.source_node_id,
            ending_direction=payload.ending_direction,
            condition_selection=payload.condition_selection.model_dump(),
        )
        try:
            generated = services.numeric_v2_generator.generate_branch_ending(context=plan["context"])
        except NumericV2GenerationError as error:
            details = _model_generation_details(error)
            return _error(error.code, status=_model_generation_status(error.code), details=details)
        draft = services.numeric_v2_branch.finish_ending(plan, generated)
        saved = services.numeric_v2_store.save_branch_draft(
            project_id,
            base_revision=payload.base_revision,
            draft=draft,
        )
        return _ok({"draft": saved})

    @app.post("/api/theater/numeric-v2/projects/<project_id>/branch-drafts")
    def create_numeric_v2_branch_draft(project_id: str):
        payload = BranchPathDraftPayload.model_validate(request.get_json() or {})
        project = services.numeric_v2_store.get(project_id)
        if project["revision"] != payload.base_revision:
            raise NumericV2RevisionConflictError(project)
        ending_draft = None
        if payload.endpoint_mode == "new_ending":
            ending_draft = services.numeric_v2_store.get_branch_draft(
                project_id,
                str(payload.ending_draft_id),
            )
        plan = services.numeric_v2_branch.prepare_path(
            project,
            source_node_id=payload.source_node_id,
            endpoint_mode=payload.endpoint_mode,
            endpoint_node_id=payload.endpoint_node_id,
            direction=payload.direction,
            length=payload.length,
            condition_selection=(
                payload.condition_selection.model_dump()
                if payload.condition_selection is not None
                else None
            ),
            ending_draft=ending_draft,
            confirmed_ending=payload.ending.model_dump(exclude_unset=True) if payload.ending is not None else None,
        )
        try:
            generated = services.numeric_v2_generator.generate_branch_path(context=plan["context"])
        except NumericV2GenerationError as error:
            details = _model_generation_details(error)
            return _error(error.code, status=_model_generation_status(error.code), details=details)
        draft = services.numeric_v2_branch.finish_path(plan, generated)
        saved = services.numeric_v2_store.save_branch_draft(
            project_id,
            base_revision=payload.base_revision,
            draft=draft,
        )
        return _ok({"draft": saved})

    @app.post("/api/theater/numeric-v2/projects/<project_id>/branch-drafts/<draft_id>/apply")
    def apply_numeric_v2_branch_draft(project_id: str, draft_id: str):
        payload = BranchApplyPayload.model_validate(request.get_json() or {})
        if payload.draft_id != draft_id:
            return _error("branch_draft_invalid", status=400)
        project = services.numeric_v2_store.get(project_id)
        draft = services.numeric_v2_store.get_branch_draft(project_id, draft_id)
        if draft.get("status") == "applied":
            return _ok({
                "project": project,
                "draft_id": draft_id,
                "created_node_ids": draft.get("created_node_ids") or [],
            })
        story, route_semantics, key_props = services.numeric_v2_branch.build_story(project, draft)
        try:
            services.numeric_v2_compiler.compile(story)
        except NekoV2BridgeError as error:
            return _error(error.code, status=422, details=error.details)
        updated = services.numeric_v2_store.commit_branch_draft(
            project_id,
            draft_id=draft_id,
            base_revision=payload.base_revision,
            story=story,
            route_semantics=route_semantics,
            key_props=key_props,
        )
        return _ok({
            "project": updated,
            "draft_id": draft_id,
            "created_node_ids": draft.get("created_node_ids") or [],
        })

    @app.post("/api/theater/numeric-v2/projects/<project_id>/nodes/<node_id>/enhance")
    def enhance_numeric_v2_node(project_id: str, node_id: str):
        """节点完善失败时不写项目；成功时只替换 AI 负责的 v2.2 演绎字段。"""

        payload = RevisionPayload.model_validate(request.get_json() or {})
        project = services.numeric_v2_store.get(project_id)
        if project["revision"] != payload.base_revision:
            raise NumericV2RevisionConflictError(project)
        if not isinstance(project.get("story"), dict):
            return _error("project_story_required", status=422)
        try:
            enhancement = services.numeric_v2_generator.enhance_node(
                story=project["story"],
                node_id=node_id,
                key_props=list((project.get("authoring") or {}).get("key_props") or []),
            )
        except NumericV2GenerationError as error:
            details = _model_generation_details(error)
            status = 404 if error.code == "node_not_found" else _model_generation_status(error.code)
            return _error(error.code, status=status, details=details)

        story = deepcopy(project["story"])
        node = next((item for item in story.get("nodes") or [] if item.get("id") == node_id), None)
        if not isinstance(node, dict):
            return _error("node_not_found", status=404)
        beat = node.setdefault("story_beat", {})
        previous_goals = beat.get("goals") or []
        previous_goal_refs = {f"goal.{goal['id']}" for goal in previous_goals if goal.get("id")}
        previous_final_ref = f"goal.{previous_goals[-1]['id']}" if previous_goals and previous_goals[-1].get("id") else None
        for field in (
            "opening_scene",
            "narrative_focus",
            "goals",
            "must_not_happen",
            "catgirl_situation",
            "transition_goal",
        ):
            beat[field] = deepcopy(enhancement[field])
        if "character_state" in enhancement:
            beat["character_state"] = deepcopy(enhancement["character_state"])
        if "acting_contract" in enhancement:
            beat["acting_contract"] = deepcopy(enhancement["acting_contract"])
        beat.pop("must_happen", None)
        goals = beat.get("goals") or []
        current_goal_refs = {f"goal.{goal['id']}" for goal in goals if goal.get("id")}
        current_final_ref = f"goal.{goals[-1]['id']}" if goals and goals[-1].get("id") else None
        for route in node.get("route_gates") or []:
            contract = route.get("transition_contract") or {}
            refs = contract.get("source_ids") or []
            if any(ref in previous_goal_refs for ref in refs) and (
                previous_goal_refs != current_goal_refs or previous_final_ref != current_final_ref
            ):
                replaced_refs = previous_goal_refs.difference(current_goal_refs) | {previous_final_ref}
                if any(ref in replaced_refs for ref in refs):
                    refs = [ref for ref in refs if ref not in replaced_refs]
                    if goals:
                        refs.append(f"goal.{goals[-1]['id']}")
                    contract["source_ids"] = list(dict.fromkeys(refs))
        try:
            services.numeric_v2_compiler.compile_core(story)
        except NekoV2BridgeError as error:
            issues = error.details.get("issues")
            if not issues:
                raise
            previous_issues = []
            try:
                services.numeric_v2_compiler.compile_core(project["story"])
            except NekoV2BridgeError as previous_error:
                previous_issues = previous_error.details.get("issues")
                if not previous_issues:
                    raise
            new_issues = [issue for issue in issues if issue not in previous_issues]
            if new_issues:
                return _error("invalid_node_enhancement", status=422, details={"issues": new_issues})
        updated = services.numeric_v2_store.update(
            project_id,
            base_revision=payload.base_revision,
            changes={"story": story},
        )
        return _ok({"project": updated, "node_id": node_id})

    @app.post("/api/theater/numeric-v2/projects/<project_id>/compile")
    def compile_numeric_v2_project(project_id: str):
        payload = RevisionPayload.model_validate(request.get_json() or {})
        project = services.numeric_v2_store.get(project_id)
        if project["revision"] != payload.base_revision:
            raise NumericV2RevisionConflictError(project)
        if not isinstance(project.get("story"), dict):
            return _error("project_story_required", status=422)
        try:
            compiled = services.numeric_v2_compiler.compile(project["story"])
        except NekoV2BridgeError as error:
            issues = list(error.details.get("issues") or [])
            current = services.numeric_v2_store.record_compile(
                project_id,
                {"success": False, "issues": issues},
                base_revision=payload.base_revision,
            )
            return _error(error.code, status=422, details={"issues": issues, "project": current})
        current = services.numeric_v2_store.record_compile(
            project_id,
            {
                "success": True,
                "package_hash": compiled.package_hash,
                "warnings": [asdict(item) for item in compiled.warnings],
            },
            base_revision=payload.base_revision,
        )
        return _ok({"project": current, "package_hash": compiled.package_hash})

    @app.post("/api/theater/numeric-v2/projects/<project_id>/validate-neko")
    def validate_numeric_v2_project(project_id: str):
        payload = RevisionPayload.model_validate(request.get_json() or {})
        project = services.numeric_v2_store.get(project_id)
        if project["revision"] != payload.base_revision:
            raise NumericV2RevisionConflictError(project)
        compiled = project.get("compile_result") or {}
        if not compiled.get("success") or compiled.get("revision") != project["revision"]:
            return _error("current_compile_required", status=422)
        result = services.numeric_v2_bridge.validate(project["story"])
        current = services.numeric_v2_store.record_validation(
            project_id,
            result,
            base_revision=payload.base_revision,
        )
        return _ok(current)

    @app.get("/api/theater/numeric-v2/projects/<project_id>/export")
    def export_numeric_v2_project(project_id: str):
        project = services.numeric_v2_store.get(project_id)
        compiled_result = _require_current_neko_validation(project)
        compiled = services.numeric_v2_compiler.compile(project["story"])
        if compiled.package_hash != compiled_result.get("package_hash"):
            return _error("current_compile_required", status=409)
        response = send_file(
            BytesIO(compiled.json_bytes),
            mimetype="application/json",
            as_attachment=True,
            download_name=f"{compiled.story_id}.json",
        )
        response.headers["X-Numeric-V2-Package-Hash"] = compiled.package_hash
        return response

    @app.post("/api/theater/numeric-v2/projects/<project_id>/install")
    def install_numeric_v2_project(project_id: str):
        payload = RevisionPayload.model_validate(request.get_json() or {})
        project = services.numeric_v2_store.get(project_id)
        if project["revision"] != payload.base_revision:
            raise NumericV2RevisionConflictError(project)
        _require_current_neko_validation(project)
        result = services.numeric_v2_bridge.install(project["story"])
        current = services.numeric_v2_store.record_install(
            project_id,
            result,
            base_revision=payload.base_revision,
        )
        return _ok(current)

    @app.errorhandler(ValidationError)
    def invalid_payload(error: ValidationError):
        return _error(
            "invalid_payload",
            status=400,
            details={
                "fields": error.errors(
                    include_url=False,
                    include_context=False,
                    include_input=False,
                )
            },
        )

    @app.errorhandler(NumericV2RevisionConflictError)
    def numeric_v2_revision_conflict(error: NumericV2RevisionConflictError):
        return _error("project_revision_conflict", status=409, details={"project": error.project})

    @app.errorhandler(NumericV2ProjectNotFoundError)
    def numeric_v2_project_not_found(_error_value: NumericV2ProjectNotFoundError):
        return _error("project_not_found", status=404)

    @app.errorhandler(NumericV2ProjectError)
    def numeric_v2_project_invalid(error: NumericV2ProjectError):
        return _error(str(error), status=422)

    @app.errorhandler(NumericV2BranchError)
    def numeric_v2_branch_invalid(error: NumericV2BranchError):
        status = 409 if error.code == "branch_draft_stale" else 422
        if error.code in {"branch_source_not_found", "branch_endpoint_not_found"}:
            status = 404
        return _error(error.code, status=status, details=error.details)

    @app.errorhandler(NekoV2BridgeError)
    def numeric_v2_bridge_failed(error: NekoV2BridgeError):
        status = 422 if error.code == "numeric_v2_compile_failed" else 502
        return _error(error.code, status=status, details=error.details)

    return app
