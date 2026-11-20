import { api } from "./api.js";
import { issueMessage } from "./copy.js";
import { closeDialog, toast } from "./dialogs.js";
import { escapeHtml } from "./utils.js";

const dialogRoot = () => document.querySelector("#dialog-root");

function setDraftPointer(draftId = null) {
  const url = new URL(window.location.href);
  if (draftId) url.searchParams.set("branch_draft", draftId);
  else url.searchParams.delete("branch_draft");
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

function lines(value) {
  return String(value || "").split("\n").map((item) => item.trim()).filter(Boolean);
}

function endpointChoice(state, mode, icon, title, description, disabled = false) {
  return `<button type="button" class="branch-choice ${state.endpointMode === mode ? "selected" : ""}" role="radio" aria-checked="${state.endpointMode === mode}" data-endpoint-mode="${mode}" ${disabled ? "disabled" : ""}>
    <span class="branch-choice-icon"><i class="fa-solid ${icon}"></i></span>
    <span><strong>${title}</strong><small>${description}</small></span>
    <i class="fa-solid fa-circle-check"></i>
  </button>`;
}

function conditionChoice(state, candidate) {
  const selected = state.conditionChoice === candidate.key;
  const reachability = candidate.reachability || "unknown";
  const pacingStatus = candidate.pacing_status || "pass";
  const reachabilityLabel = pacingStatus === "warning"
    ? "部分入口可达"
    : pacingStatus === "blocked"
      ? "当前不可生成"
      : pacingStatus === "pass"
        ? "8 回合内可达"
        : reachability === "recommended"
          ? "正常节奏可达"
          : reachability === "difficult"
            ? "较难达到"
            : reachability === "unreachable"
              ? "当前不可达"
              : "尚未估算";
  return `<button type="button" class="branch-condition-card reachability-${reachability} pacing-${pacingStatus} ${selected ? "selected" : ""}" role="radio" aria-checked="${selected}" data-condition-choice="${candidate.key}" ${candidate.available === false ? "disabled" : ""}>
    <span class="branch-condition-main"><strong>${escapeHtml(candidate.label)}<em>${reachabilityLabel}</em></strong><small>${escapeHtml(candidate.state_hint)}</small></span>
    <span class="branch-condition-behavior">${escapeHtml(candidate.behavior_hint || "由当前互动方式逐步形成")}</span>
    <i class="fa-solid fa-circle-check"></i>
  </button>`;
}

function pacingNoticeMarkup(state) {
  // 仅展示作者需要处理的异常，不把诊断字段送入模型或正式剧本。
  const diagnostics = (state.options.pacing_diagnostics || [])
    .filter((item) => item.status === "warning" || item.status === "blocked");
  if (!diagnostics.length) return "";
  const rows = diagnostics.map((item) => {
    const title = `${item.metric_id || "数值"} · ${item.band_label || "目标状态"}`;
    const status = item.status === "warning" ? "部分前序路线可达" : "这条状态暂时不能生成";
    const detail = item.warning_codes?.includes("branch_pacing_entry_unknown")
      ? "存在循环、缺失节点或无法确认的前序条件，请先调整故事结构。"
      : item.estimated_extra_turns == null
        ? "暂时无法可靠估算进入这条状态所需的回合。"
        : `最慢入口约需 ${item.estimated_extra_turns} 回合；超过 8 回合的入口不会被自动采用。`;
    return `<li><strong>${escapeHtml(title)}</strong><span>${status}：${detail}</span></li>`;
  }).join("");
  return `<aside class="branch-pacing-notice" role="status"><strong><i class="fa-solid fa-chart-line"></i> 数值支线节奏提示</strong><ul>${rows}</ul><small>提示只帮助作者调整路线，不会写入正式剧本或交给演绎模型。</small></aside>`;
}

function scenePacingMessage(scene) {
  // 支线预览只展示作者诊断，不把回合估算转成自动换幕规则。
  const codes = new Set(scene.warning_codes || []);
  const details = [];
  if (codes.has("branch_natural_exit_player_action_missing")) details.push("缺少玩家可执行的离幕动作");
  if (codes.has("branch_natural_exit_player_action_not_actionable")) details.push("离幕说明只有观察/等待，没有可提交动作");
  if (codes.has("branch_expected_turns_unknown")) details.push("预计回合数未可靠估算");
  if (codes.has("branch_expected_turns_exceed_8")) details.push("超过 8 回合软预算");
  if (codes.has("branch_expected_turns_exceed_40")) details.push("超过 40 回合，建议拆幕");
  return details.join("；");
}

function selectedRejoin(state) {
  return state.options.rejoin.targets.find((target) => target.node_id === state.endpointNodeId) || null;
}

function allowedLengths(state) {
  if (state.endpointMode !== "mainline") return [1, 2, 3];
  return selectedRejoin(state)?.allowed_lengths || [];
}

function normalizeLength(state) {
  const allowed = allowedLengths(state);
  if (!allowed.includes(state.length)) state.length = allowed.includes(2) ? 2 : allowed[0] || 1;
}

function endpointTargetsMarkup(state) {
  if (state.endpointMode === "mainline") {
    return `<fieldset class="branch-fieldset"><legend>回到哪一幕？</legend><div class="branch-target-list" role="radiogroup" aria-label="主线回接幕">
      ${state.options.rejoin.targets.map((target) => `<button type="button" class="branch-target ${state.endpointNodeId === target.node_id ? "selected" : ""}" role="radio" aria-checked="${state.endpointNodeId === target.node_id}" data-endpoint-node="${target.node_id}" ${target.available ? "" : "disabled"}>
        <span><strong>${escapeHtml(target.title)}</strong>${target.recommended ? `<em>推荐 · 紧接当前剧情</em>` : ""}</span>
        <p>${escapeHtml(target.summary)}</p>
        <small>${target.skipped_nodes.length ? `将绕过 ${target.skipped_nodes.length} 幕 · 承接 ${target.continuity_items.length} 项事实 · 至少 ${target.minimum_length} 幕` : "不绕过主线 · 作为一段插曲后回归"}</small>
        ${target.unavailable_reason ? `<span class="branch-target-warning"><i class="fa-solid fa-circle-exclamation"></i>${escapeHtml(issueMessage({ code: target.unavailable_reason }))}</span>` : ""}
      </button>`).join("")}
    </div></fieldset>`;
  }
  if (state.endpointMode === "existing_ending") {
    return `<fieldset class="branch-fieldset"><legend>通往哪个已有结局？</legend><div class="branch-target-list compact" role="radiogroup" aria-label="已有结局">
      ${state.options.existing_endings.map((ending) => `<button type="button" class="branch-target ${state.endpointNodeId === ending.node_id ? "selected" : ""}" role="radio" aria-checked="${state.endpointNodeId === ending.node_id}" data-endpoint-node="${ending.node_id}"><span><strong>${escapeHtml(ending.title)}</strong></span><p>${escapeHtml(ending.summary)}</p></button>`).join("")}
    </div></fieldset>`;
  }
  return "";
}

function optionMarkup(values, selected) {
  return values.map((value) => `<option value="${value}" ${value === selected ? "selected" : ""}>${value}</option>`).join("");
}

function endingGoalMarkup(goal, index, count) {
  return `<article class="branch-ending-goal">
    <div class="form-grid two"><label>执行者<select data-ending-goal-field="owner" data-goal-index="${index}">${optionMarkup(["catgirl", "player", "shared", "environment"], goal.owner)}</select></label><label>交付类型<select data-ending-goal-field="delivery_type" data-goal-index="${index}">${optionMarkup(["catgirl_dialogue", "catgirl_action", "environment_fact", "player_action", "shared_agreement", "semantic_state"], goal.delivery_type)}</select></label></div>
    <label>原子目标<textarea rows="2" data-ending-goal-field="description" data-goal-index="${index}">${escapeHtml(goal.description)}</textarea></label>
    <div class="form-grid two"><label>证据模式<select data-ending-goal-field="evidence_mode" data-goal-index="${index}">${optionMarkup(["exact", "semantic"], goal.evidence_mode)}</select></label><label>来源（每行一项）<textarea rows="2" data-ending-goal-list="sources" data-goal-index="${index}">${escapeHtml((goal.sources || []).join("\n"))}</textarea></label></div>
    <label>字面锚点（每行一项；semantic 留空）<textarea rows="2" data-ending-goal-list="anchors" data-goal-index="${index}">${escapeHtml((goal.anchors || []).join("\n"))}</textarea></label>
    ${count > 1 ? `<button type="button" class="text-button" data-remove-ending-goal="${index}"><i class="fa-solid fa-trash"></i> 删除目标</button>` : ""}
  </article>`;
}

function endingEditorMarkup(state) {
  if (!state.endingDraft) {
    return `<label class="branch-wide-field">这个结局最后变成什么样？<textarea rows="4" data-ending-direction placeholder="写结果、代价或最终情绪。例：两人公开真相，但必须共同承担失去小店的代价。">${escapeHtml(state.endingDirection)}</textarea><small>先确认终点，再生成通往它的过程。</small></label>`;
  }
  const ending = state.endingDraft.ending;
  return `<section class="branch-ending-review">
    <div class="branch-section-heading"><span><i class="fa-solid fa-flag-checkered"></i></span><div><strong>确认新结局</strong><small>可以直接修改；编辑不会再次调用模型。</small></div></div>
    <div class="form-grid two"><label>结局标题<input data-ending-field="title" value="${escapeHtml(ending.title)}"></label><label>收束语气<input data-ending-field="tone" value="${escapeHtml(ending.tone)}"></label></div>
    <label>结局摘要<textarea rows="3" data-ending-field="summary">${escapeHtml(ending.summary)}</textarea></label>
    <label>唯一结局开场<textarea rows="3" data-ending-field="opening_scene">${escapeHtml(ending.opening_scene)}</textarea></label>
    <div class="branch-ending-goals">${(ending.ordered_goals || []).map((goal, index) => endingGoalMarkup(goal, index, ending.ordered_goals.length)).join("")}</div>
    <button type="button" class="text-button" data-add-ending-goal><i class="fa-solid fa-plus"></i> 添加原子目标</button>
    <label>不得逆转的作者事实<textarea rows="4" data-ending-list="irreversible_facts">${escapeHtml(ending.irreversible_facts.join("\n"))}</textarea></label>
    <label>猫娘在结局中的处境<textarea rows="3" data-ending-field="catgirl_situation">${escapeHtml(ending.catgirl_situation)}</textarea></label>
    <button type="button" class="text-button" data-regenerate-ending><i class="fa-solid fa-rotate"></i> 重新生成结局草稿</button>
  </section>`;
}

function formMarkup(state) {
  const recommendSelected = state.conditionChoice === "recommend";
  const lengths = allowedLengths(state);
  const target = selectedRejoin(state);
  return `<div class="branch-wizard-scroll">
    <section class="branch-step">
      <div class="branch-step-title"><span>1</span><div><h3>这条支线最后去哪？</h3><p>先固定终点，生成模型才能从结果反推必要过程。</p></div></div>
      <div class="branch-choice-grid" role="radiogroup" aria-label="支线终点类型">
        ${endpointChoice(state, "mainline", "fa-code-merge", "回到主线", "作为偏离主线的插曲，之后回到指定幕。", !state.options.rejoin.available)}
        ${endpointChoice(state, "existing_ending", "fa-signs-post", "通往已有结局", "让这条支线直接汇入已经写好的结局。", !state.options.existing_endings.length)}
        ${endpointChoice(state, "new_ending", "fa-flag-checkered", "产生新结局", "先写清最后结果，再反推通往它的过程。")}
      </div>
      ${!state.options.rejoin.available && state.options.rejoin.unavailable_reason ? `<div class="branch-rejoin-unavailable"><i class="fa-solid fa-circle-info"></i><span>${escapeHtml(issueMessage({ code: state.options.rejoin.unavailable_reason }))}</span>${state.canManageMainline && ["mainline_order_required", "mainline_order_invalid"].includes(state.options.rejoin.unavailable_reason) ? `<button type="button" class="text-button" data-manage-mainline>确认主线顺序</button>` : ""}</div>` : ""}
      ${endpointTargetsMarkup(state)}
      ${state.endpointMode === "mainline" && target?.skipped_nodes.length ? `<div class="branch-skip-summary"><i class="fa-solid fa-route"></i><span>这条支线将替代 ${target.skipped_nodes.map((node) => `《${escapeHtml(node.title)}》`).join("、")}，并在《${escapeHtml(target.title)}》重新汇入。</span></div>` : ""}
    </section>

    <section class="branch-step">
      <div class="branch-step-title"><span>2</span><div><h3>玩家怎样会走上这条路？</h3><p>这里只选择剧情状态，不需要填写数值、阈值或优先级。</p></div></div>
      <div class="branch-condition-list" role="radiogroup" aria-label="支线触发状态">
        <button type="button" class="branch-condition-card recommend ${recommendSelected ? "selected" : ""}" role="radio" aria-checked="${recommendSelected}" data-condition-choice="recommend"><span class="branch-condition-main"><strong><i class="fa-solid fa-wand-magic-sparkles"></i> 让生成模型从正常可达状态中推荐</strong><small>模型只会看到按前置幕数估算为正常可达的候选，不能发明数值或阈值。</small></span><i class="fa-solid fa-circle-check"></i></button>
        ${state.options.condition_candidates.map((candidate) => conditionChoice(state, candidate)).join("")}
      </div>
      ${pacingNoticeMarkup(state)}
    </section>

    <section class="branch-step">
      <div class="branch-step-title"><span>3</span><div><h3>${state.endpointMode === "new_ending" ? "先确认结局，再决定途中偏好" : "这条支线想发生什么？"}</h3><p>${state.endpointMode === "new_ending" ? "结局结果必填，过程偏好可以留空。" : "写冲突、误会、调查、关系变化或希望保留的感觉。"}</p></div></div>
      ${state.endpointMode === "new_ending" ? endingEditorMarkup(state) : ""}
      ${state.endpointMode !== "new_ending" || state.endingDraft ? `<label class="branch-wide-field">${state.endpointMode === "new_ending" ? "途中有什么偏好？（可选）" : "支线方向"}<textarea rows="4" data-branch-direction placeholder="例：一次误会让两人暂时分开调查，最后因为同一件证据重新合作。">${escapeHtml(state.direction)}</textarea></label>` : ""}
    </section>

    <section class="branch-step">
      <div class="branch-step-title"><span>4</span><div><h3>这条支线多长？</h3><p>只显示当前终点能够安全承接的长度。</p></div></div>
      <div class="branch-lengths" role="radiogroup" aria-label="支线长度">
        ${lengths.map((length) => `<button type="button" role="radio" aria-checked="${state.length === length}" data-branch-length="${length}" class="${state.length === length ? "selected" : ""}"><strong>${length} 幕</strong><small>${length === 1 ? "短支线" : length === 2 ? "标准支线" : "长支线"}</small></button>`).join("")}
      </div>
    </section>
  </div>`;
}

function previewMarkup(state) {
  const draft = state.pathDraft;
  const pacing = draft.pacing_diagnostics;
  const pacingWarnings = (pacing?.scenes || []).filter((scene) => (scene.warning_codes || []).length);
  return `<div class="branch-wizard-scroll branch-preview">
    <section class="branch-preview-hero"><span><i class="fa-solid fa-code-branch"></i></span><div><p class="eyebrow">BRANCH PREVIEW</p><h3>${escapeHtml(draft.source_title)} → ${escapeHtml(draft.endpoint_title)}</h3><p>${escapeHtml(draft.condition.label)}</p></div></section>
    ${draft.skipped_nodes.length ? `<section class="branch-preview-section"><h4>将绕过的主线</h4><div class="branch-chip-row">${draft.skipped_nodes.map((node) => `<span>${escapeHtml(node.title)}</span>`).join("")}</div></section>` : ""}
    <section class="branch-preview-section"><h4>触发状态</h4><div class="branch-trigger-summary"><strong>${escapeHtml(draft.condition.label)}</strong><p>${escapeHtml(draft.condition_reason)}</p></div></section>
    <section class="branch-preview-section"><h4>正向剧情过程</h4><div class="branch-scene-list">${draft.scenes.map((scene, index) => `<article><span>${index + 1}</span><div><strong>${escapeHtml(scene.title)}</strong><p>${escapeHtml(scene.summary)}</p><small>${escapeHtml(scene.transition_goal)}</small></div></article>`).join("")}</div></section>
    ${pacing ? `<aside class="branch-pacing-notice" role="status"><strong><i class="fa-solid ${pacingWarnings.length ? "fa-chart-line" : "fa-circle-check"}"></i> 支线节奏${pacingWarnings.length ? "提示" : "检查通过"}</strong>${pacingWarnings.length ? `<ul>${pacingWarnings.map((scene) => `<li><strong>${escapeHtml(scene.title || `第 ${Number(scene.scene_index) + 1} 幕`)}</strong><span>${scene.expected_turns == null ? "预计回合数未知" : `预计 ${Number(scene.estimated_turns) || 0} 回合`}；${escapeHtml(scenePacingMessage(scene))}</span></li>`).join("")}</ul>` : ""}<small>提示只帮助作者压缩事件链，不会写入正式剧本或强制换幕。</small></aside>` : ""}
    ${draft.continuity_items.length ? `<section class="branch-preview-section"><h4>主线事实已经承接</h4><ul class="branch-continuity-list">${draft.continuity_items.map((item) => `<li><i class="fa-solid fa-circle-check"></i><span>${escapeHtml(item.text)}</span></li>`).join("")}</ul></section>` : ""}
    ${draft.new_ending ? `<section class="branch-preview-section ending"><h4>新结局</h4><strong>${escapeHtml(draft.new_ending.title)}</strong><p>${escapeHtml(draft.new_ending.summary)}</p></section>` : ""}
    <details class="branch-advanced"><summary><span><i class="fa-solid fa-sliders"></i> 高级条件</span><small>正式阈值、互补路线和 priority</small><i class="fa-solid fa-chevron-down"></i></summary><pre>${escapeHtml(JSON.stringify({ branch: draft.branch_conditions, original_mainline: draft.original_conditions, priorities: { branch: 200, original_mainline: 100 } }, null, 2))}</pre></details>
  </div>`;
}

function blockedMarkup(state) {
  return `<div class="branch-blocked"><span><i class="fa-solid fa-circle-exclamation"></i></span><h3>这个节点暂时不能生成支线</h3><ul>${state.options.blocking_reasons.map((code) => `<li>${escapeHtml(issueMessage({ code }))}</li>`).join("")}</ul>${state.options.blocking_reasons.includes("branch_metric_required") ? `<button class="button primary" type="button" data-open-metrics><i class="fa-solid fa-sliders"></i>完善数值规则</button>` : ""}</div>`;
}

export async function openBranchWizard(context, sourceNodeId, { openMetrics, manageMainline, resumeDraft = null } = {}) {
  const previousFocus = document.activeElement;
  const state = {
    options: null,
    endpointMode: "new_ending",
    endpointNodeId: null,
    conditionChoice: "recommend",
    endingDirection: "",
    direction: "",
    length: 2,
    endingDraft: null,
    pathDraft: null,
    loading: false,
    error: "",
    canManageMainline: Boolean(manageMainline),
  };

  const close = ({ clearPointer = true } = {}) => {
    document.removeEventListener("keydown", onKeydown);
    closeDialog();
    if (clearPointer) setDraftPointer();
    previousFocus?.focus?.();
  };
  const onKeydown = (event) => {
    if (event.key === "Escape" && !state.loading) close();
  };
  document.addEventListener("keydown", onKeydown);

  dialogRoot().innerHTML = `<div class="dialog-backdrop"><section class="branch-wizard loading" role="dialog" aria-modal="true" aria-label="生成支线"><i class="fa-solid fa-spinner fa-spin"></i><span>正在检查支线起点与合法终点</span></section></div>`;
  try {
    await context.flush();
    state.options = await api.branchOptions(context.project.project_id, sourceNodeId);
  } catch (error) {
    close();
    return toast(issueMessage(error), "error");
  }

  if (resumeDraft?.kind === "ending" && resumeDraft.status === "ending_review") {
    state.endpointMode = "new_ending";
    state.endpointNodeId = null;
    state.conditionChoice = resumeDraft.condition?.key || "recommend";
    state.endingDirection = resumeDraft.ending_direction || "";
    state.endingDraft = resumeDraft;
  } else if (resumeDraft?.kind === "path" && resumeDraft.status === "preview") {
    state.endpointMode = resumeDraft.endpoint_mode;
    state.endpointNodeId = resumeDraft.endpoint_node_id;
    state.conditionChoice = resumeDraft.condition?.key || "recommend";
    state.direction = resumeDraft.direction || "";
    state.length = resumeDraft.length || 2;
    state.pathDraft = resumeDraft;
  } else if (state.options.rejoin.available) {
    state.endpointMode = "mainline";
    state.endpointNodeId = state.options.rejoin.targets.find((target) => target.available)?.node_id || null;
  } else if (state.options.existing_endings.length) {
    state.endpointMode = "existing_ending";
    state.endpointNodeId = state.options.existing_endings[0].node_id;
  }
  normalizeLength(state);

  function render(focusSelector = null) {
    const title = state.pathDraft ? "检查支线草稿" : "生成支线";
    const subtitle = state.pathDraft ? "正式地图尚未改变；确认后才会一次性应用。" : `从《${state.options.source.title || "当前节点"}》出发`;
    const primaryLabel = state.pathDraft
      ? "应用支线草稿"
      : state.endpointMode === "new_ending" && !state.endingDraft
        ? "生成结局草稿"
        : state.endpointMode === "new_ending"
          ? "根据结局生成过程"
          : "生成支线草稿";
    dialogRoot().innerHTML = `<div class="dialog-backdrop" data-branch-backdrop>
      <section class="branch-wizard" role="dialog" aria-modal="true" aria-labelledby="branch-wizard-title">
        <header class="branch-wizard-header"><div><p class="eyebrow">ENDPOINT FIRST</p><h2 id="branch-wizard-title">${title}</h2><p>${escapeHtml(subtitle)}</p></div><button class="icon-button" type="button" data-branch-close aria-label="关闭支线向导" ${state.loading ? "disabled" : ""}><i class="fa-solid fa-xmark"></i></button></header>
        <div class="branch-live" aria-live="polite">${state.loading ? "正在生成，请稍候" : state.error ? escapeHtml(state.error) : ""}</div>
        ${state.options.eligible ? (state.pathDraft ? previewMarkup(state) : formMarkup(state)) : blockedMarkup(state)}
        ${state.options.eligible ? `<footer class="branch-wizard-actions"><button class="button ghost" type="button" data-branch-secondary>${state.pathDraft ? "返回调整" : "取消"}</button><button class="button primary" type="button" data-branch-primary ${state.loading ? "disabled" : ""}><i class="fa-solid ${state.loading ? "fa-spinner fa-spin" : state.pathDraft ? "fa-check" : "fa-wand-magic-sparkles"}"></i>${state.loading ? "正在生成" : primaryLabel}</button></footer>` : ""}
      </section>
    </div>`;
    bind();
    if (focusSelector) requestAnimationFrame(() => dialogRoot().querySelector(focusSelector)?.focus());
  }

  function resetGenerated() {
    state.pathDraft = null;
    state.error = "";
  }

  function bind() {
    const root = dialogRoot();
    root.querySelector("[data-branch-close]")?.addEventListener("click", () => {
      if (!state.loading) close();
    });
    root.querySelector("[data-branch-backdrop]")?.addEventListener("click", (event) => {
      if (event.target.hasAttribute("data-branch-backdrop") && !state.loading) close();
    });
    root.querySelector("[data-open-metrics]")?.addEventListener("click", () => { close(); openMetrics?.(); });
    root.querySelector("[data-manage-mainline]")?.addEventListener("click", () => { close(); manageMainline?.(); });
    root.querySelectorAll("[data-endpoint-mode]").forEach((button) => button.onclick = () => {
      if (state.endingDraft || state.pathDraft) setDraftPointer();
      state.endpointMode = button.dataset.endpointMode;
      state.endingDraft = null;
      resetGenerated();
      if (state.endpointMode === "mainline") state.endpointNodeId = state.options.rejoin.targets.find((target) => target.available)?.node_id || null;
      else if (state.endpointMode === "existing_ending") state.endpointNodeId = state.options.existing_endings[0]?.node_id || null;
      else state.endpointNodeId = null;
      normalizeLength(state);
      render("[data-endpoint-node]:not(:disabled), [data-ending-direction]");
    });
    root.querySelectorAll("[data-endpoint-node]").forEach((button) => button.onclick = () => {
      state.endpointNodeId = button.dataset.endpointNode;
      resetGenerated(); normalizeLength(state); render();
    });
    root.querySelectorAll("[data-condition-choice]").forEach((button) => button.onclick = () => {
      if (state.conditionChoice !== button.dataset.conditionChoice) {
        if (state.endingDraft) setDraftPointer();
        state.endingDraft = null;
      }
      state.conditionChoice = button.dataset.conditionChoice;
      resetGenerated(); render();
    });
    root.querySelectorAll("[data-branch-length]").forEach((button) => button.onclick = () => {
      state.length = Number(button.dataset.branchLength); resetGenerated(); render();
    });
    root.querySelector("[data-ending-direction]")?.addEventListener("input", (event) => { state.endingDirection = event.target.value; });
    root.querySelector("[data-branch-direction]")?.addEventListener("input", (event) => { state.direction = event.target.value; });
    root.querySelectorAll("[data-ending-field]").forEach((input) => input.oninput = () => { state.endingDraft.ending[input.dataset.endingField] = input.value; });
    root.querySelectorAll("[data-ending-list]").forEach((input) => input.oninput = () => { state.endingDraft.ending[input.dataset.endingList] = lines(input.value); });
    root.querySelectorAll("[data-ending-goal-field]").forEach((input) => input.oninput = () => {
      state.endingDraft.ending.ordered_goals[Number(input.dataset.goalIndex)][input.dataset.endingGoalField] = input.value;
    });
    root.querySelectorAll("[data-ending-goal-list]").forEach((input) => input.oninput = () => {
      state.endingDraft.ending.ordered_goals[Number(input.dataset.goalIndex)][input.dataset.endingGoalList] = lines(input.value);
    });
    root.querySelector("[data-add-ending-goal]")?.addEventListener("click", () => {
      if (state.endingDraft.ending.ordered_goals.length >= 6) return;
      state.endingDraft.ending.ordered_goals.push({ owner: "environment", delivery_type: "environment_fact", description: "新的结局事实", evidence_mode: "exact", anchors: ["新的结局事实"], sources: ["opening"] });
      render();
    });
    root.querySelectorAll("[data-remove-ending-goal]").forEach((button) => button.onclick = () => {
      state.endingDraft.ending.ordered_goals.splice(Number(button.dataset.removeEndingGoal), 1);
      render();
    });
    root.querySelector("[data-regenerate-ending]")?.addEventListener("click", () => { setDraftPointer(); state.endingDraft = null; resetGenerated(); render("[data-ending-direction]"); });
    root.querySelector("[data-branch-secondary]")?.addEventListener("click", () => {
      if (!state.pathDraft) return close();
      setDraftPointer(); state.pathDraft = null; render("[data-branch-primary]");
    });
    root.querySelector("[data-branch-primary]")?.addEventListener("click", runPrimary);
  }

  function conditionSelection() {
    return state.conditionChoice === "recommend"
      ? { mode: "recommend" }
      : { mode: "fixed", key: state.conditionChoice };
  }

  async function runPrimary() {
    if (state.loading) return;
    if (state.pathDraft) return applyDraft();
    if (state.endpointMode !== "new_ending" && !state.endpointNodeId) {
      state.error = "请先选择具体终点。"; return render();
    }
    if (state.endpointMode !== "new_ending" && !state.direction.trim()) {
      state.error = issueMessage({ code: "branch_direction_required" }); return render("[data-branch-direction]");
    }
    if (state.endpointMode === "new_ending" && !state.endingDraft && !state.endingDirection.trim()) {
      state.error = issueMessage({ code: "branch_ending_direction_required" }); return render("[data-ending-direction]");
    }
    state.loading = true; state.error = ""; render();
    try {
      const project = context.project;
      if (state.endpointMode === "new_ending" && !state.endingDraft) {
        const result = await api.generateBranchEnding(project.project_id, {
          base_revision: project.revision,
          source_node_id: sourceNodeId,
          ending_direction: state.endingDirection,
          condition_selection: conditionSelection(),
        });
        state.endingDraft = result.draft;
        setDraftPointer(result.draft.draft_id);
        toast("结局草稿已生成；确认后再生成过程");
      } else {
        const payload = state.endpointMode === "new_ending" ? {
          base_revision: project.revision,
          endpoint_mode: "new_ending",
          ending_draft_id: state.endingDraft.draft_id,
          ending: state.endingDraft.ending,
          direction: state.direction,
          length: state.length,
        } : {
          base_revision: project.revision,
          source_node_id: sourceNodeId,
          endpoint_mode: state.endpointMode,
          endpoint_node_id: state.endpointNodeId,
          direction: state.direction,
          length: state.length,
          condition_selection: conditionSelection(),
        };
        const result = await api.generateBranchPath(project.project_id, payload);
        state.pathDraft = result.draft;
        setDraftPointer(result.draft.draft_id);
      }
    } catch (error) {
      state.error = issueMessage(error);
    } finally {
      state.loading = false;
      render(state.pathDraft ? "[data-branch-primary]" : null);
    }
  }

  async function applyDraft() {
    state.loading = true; state.error = ""; render();
    try {
      const project = context.project;
      const result = await api.applyBranchDraft(project.project_id, state.pathDraft.draft_id, project.revision);
      const firstNodeId = result.created_node_ids?.[0];
      context.replaceProject(result.project);
      if (firstNodeId) context.onSelection({ kind: "node", id: firstNodeId });
      close();
      context.rerender();
      toast("支线已经完整应用到故事地图");
    } catch (error) {
      state.loading = false;
      state.error = issueMessage(error);
      render();
    }
  }

  render("[data-branch-close]");
}

export async function resumeBranchWizard(context, draftId, options = {}) {
  try {
    await context.flush();
    const draft = await api.branchDraft(context.project.project_id, draftId);
    if (draft.status === "stale") throw { code: "branch_draft_stale" };
    if (!((draft.kind === "ending" && draft.status === "ending_review") || (draft.kind === "path" && draft.status === "preview"))) {
      setDraftPointer();
      return;
    }
    return openBranchWizard(context, draft.source_node_id, { ...options, resumeDraft: draft });
  } catch (error) {
    setDraftPointer();
    toast(issueMessage(error), "error");
  }
}
