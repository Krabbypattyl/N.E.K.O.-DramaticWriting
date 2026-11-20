import { api } from "./api.js";
import { COPY, issueMessage, statusLabel } from "./copy.js";
import { confirmDialog, modelSettingsDialog, toast } from "./dialogs.js";
import { workspaceUrl, navigate } from "./router.js";
import { ideaCharacterCount, renderSetupForm, visibleIdeaValue } from "./setup-form.js";
import { resumeBranchWizard } from "./branch-wizard.js";
import { openMainlineOrderDialog } from "./mainline-order.js";
import { renderStoryDesigner } from "./story-graph.js";
import { renderPublishPanel } from "./publish-panel.js";
import { createWorkspaceState } from "./state.js";
import { escapeHtml } from "./utils.js";

const STAGE_ICONS = {
  setup: "fa-house",
  story: "fa-diagram-project",
  publish: "fa-code",
};

function sidebarContextMarkup(project, stage) {
  const metrics = project.setup?.metrics || [];
  if (stage === "setup") {
    const filled = [project.title, project.setup?.brief].filter((value) => String(value || "").trim()).length;
    return `<section class="sidebar-context"><div class="sidebar-context-heading"><span>生成准备</span><strong>${filled}/2</strong></div><div class="sidebar-progress"><span style="width:${(filled / 2) * 100}%"></span></div><p>标题和创作想法完整后，即可生成主线与 Normal 结局地图。</p></section>`;
  }
  if (stage === "story") {
    const intro = project.story?.intro || {};
    return `<section class="sidebar-context"><div class="sidebar-context-heading"><span>故事概要</span><button type="button" class="text-button" data-edit-foundation>编辑</button></div><p>${escapeHtml(intro.background || project.setup?.brief || "尚未填写故事背景")}</p><dl class="sidebar-identity"><div><dt>玩家身份</dt><dd>${escapeHtml(intro.player_identity || "待补充")}</dd></div><div><dt>猫娘身份</dt><dd>${escapeHtml(intro.catgirl_identity || "待补充")}</dd></div></dl></section><section class="sidebar-context"><div class="sidebar-context-heading"><span>隐藏数值</span><strong>${metrics.length}</strong></div><div class="sidebar-metric-list">${metrics.map((metric) => `<div><span>${escapeHtml(metric.name || "未命名数值")}</span><small>${metric.initial}</small></div>`).join("") || `<p>尚未配置数值</p>`}</div></section>`;
  }
  const compiled = project.compile_result || {};
  const issueCount = (compiled.issues || []).length + (compiled.warnings || []).length;
  return `<section class="sidebar-context"><div class="sidebar-context-heading"><span>交付状态</span><strong>${statusLabel(project.status)}</strong></div><div class="readiness-list"><span class="${compiled.success ? "ready" : ""}"><i class="fa-solid ${compiled.success ? "fa-circle-check" : "fa-circle"}"></i>确定性编译</span><span class="${project.status === "verified" ? "ready" : ""}"><i class="fa-solid ${project.status === "verified" ? "fa-circle-check" : "fa-circle"}"></i>N.E.K.O 复验</span><span class="${issueCount ? "warning" : "ready"}"><i class="fa-solid ${issueCount ? "fa-circle-exclamation" : "fa-circle-check"}"></i>${issueCount} 个问题与提示</span></div></section>`;
}

export async function renderWorkspace(root, project, initialStage, { branchDraftId = null } = {}) {
  let stage = initialStage || project.stage || (project.story ? "story" : "setup");
  let draftToResume = stage === "story" ? branchDraftId : null;
  let presets = [];
  const workspace = createWorkspaceState(project, {
    onStatus: updateSaveStatus,
    onSaved: (next) => { project = next; updateChrome(); },
    onConflict: (serverProject) => showConflict(serverProject),
    onError: (error) => toast(issueMessage(error), "error"),
  });
  try { presets = await api.presets(); } catch (error) { toast(issueMessage(error), "error"); }

  function context() {
    const currentContext = {
      selection: workspace.state.selection,
      viewState: workspace.state,
      schedule: workspace.schedule,
      flush: workspace.flush,
      replaceProject: workspace.replaceProject,
      presets,
      rerender: renderStage,
      onSelection: (selection) => { workspace.state.selection = selection; },
      changeStage,
      onTitle: updateChrome,
    };
    // 发布动作必须在等待保存队列后读取最新 revision，不能捕获切换页面前的快照。
    Object.defineProperty(currentContext, "project", {
      enumerable: true,
      get: () => workspace.state.project,
    });
    return currentContext;
  }

  // 前端改为持续工作区导航；setup/story/publish 仅保留为兼容后端的恢复指针。
  root.innerHTML = `<div class="workspace-shell"><header class="workspace-topbar"><a class="brand workspace-brand" href="/"><span class="brand-mark"><i class="fa-solid fa-pen-ruler"></i></span><span><strong>${COPY.appName}</strong><small>${COPY.appSubline}</small></span></a><span class="topbar-divider"></span><button class="back-link" data-home aria-label="返回所有剧本"><i class="fa-solid fa-arrow-left"></i><span>所有剧本</span></button><div class="project-title-block"><input data-top-title value="${escapeHtml(project.title)}" aria-label="剧本标题"></div><div class="topbar-actions"><span class="project-state" data-project-status></span><span class="save-status" data-save-status><i class="fa-solid fa-cloud"></i><span>已保存</span></span><button class="button primary workspace-action" data-workspace-action></button><button class="icon-button" data-model-settings title="模型设置" aria-label="模型设置"><i class="fa-solid fa-gear"></i></button></div></header><div class="workspace-body"><aside class="workspace-sidebar"><nav class="workspace-nav">${Object.entries(COPY.stages).map(([id, item]) => `<button data-stage="${id}" class="workspace-nav-item"><i class="fa-solid ${STAGE_ICONS[id]}"></i><span>${item.label}</span><i class="fa-solid fa-lock nav-lock"></i></button>`).join("")}</nav><div class="workspace-sidebar-context" data-sidebar-context></div><button class="sidebar-settings" type="button" data-model-settings-secondary><i class="fa-solid fa-gear"></i><span>模型与生成设置</span><i class="fa-solid fa-chevron-right"></i></button></aside><main class="workspace-main" data-stage-root></main></div></div>`;
  root.querySelector("[data-home]").onclick = async () => { await workspace.flush(); navigate("/"); };
  root.querySelector("[data-model-settings]").onclick = modelSettingsDialog;
  root.querySelector("[data-model-settings-secondary]").onclick = modelSettingsDialog;
  root.querySelector("[data-top-title]").oninput = (event) => { workspace.state.project.title = event.target.value; workspace.schedule({ title: event.target.value }); };
  root.querySelectorAll("[data-stage]").forEach((button) => button.onclick = () => changeStage(button.dataset.stage));
  root.querySelector("[data-workspace-action]").onclick = (event) => stage === "setup" ? generateStory(event.currentTarget) : changeStage("publish");
  window.history.replaceState({}, "", workspaceUrl(project.project_id, stage, { branchDraftId: draftToResume }));
  renderStage();

  function updateSaveStatus(status = workspace.state.saveStatus) {
    const target = root.querySelector("[data-save-status]"); if (!target) return;
    const mapping = { saved: ["fa-cloud", "已保存"], saving: ["fa-cloud-arrow-up", "保存中"], failed: ["fa-triangle-exclamation", "保存失败"] }[status];
    target.className = `save-status ${status}`; target.innerHTML = `<i class="fa-solid ${mapping[0]}"></i><span>${mapping[1]}</span>`;
  }

  function updateChrome() {
    const current = workspace.state.project;
    const title = root.querySelector("[data-top-title]"); if (title && document.activeElement !== title) title.value = current.title;
    const status = root.querySelector("[data-project-status]"); if (status) status.innerHTML = `<i class="fa-solid fa-circle"></i>${statusLabel(current.status)}`;
    const sidebarContext = root.querySelector("[data-sidebar-context]");
    if (sidebarContext) {
      sidebarContext.innerHTML = sidebarContextMarkup(current, stage);
      sidebarContext.querySelector("[data-edit-foundation]")?.addEventListener("click", () => changeStage("setup"));
    }
    const action = root.querySelector("[data-workspace-action]");
    if (action) {
      action.hidden = stage === "publish";
      const canContinue = current.generation_checkpoint?.available === true;
      action.innerHTML = stage === "setup" ? `<i class="fa-solid fa-wand-magic-sparkles"></i>${canContinue ? "继续生成剩余结构" : (current.story ? "重新生成剧情结构" : "生成剧情结构")}` : `<i class="fa-solid fa-code"></i>检查并交付`;
    }
  }

  function changeStage(nextStage) {
    if (nextStage !== "setup" && !workspace.state.project.story) return toast("请先生成剧情结构", "error");
    stage = nextStage;
    workspace.state.project.stage = stage;
    workspace.schedule({ stage }, { immediate: true });
    window.history.pushState({}, "", workspaceUrl(project.project_id, stage));
    renderStage();
  }

  function renderStage() {
    updateChrome();
    root.querySelectorAll("[data-stage]").forEach((button) => {
      button.classList.toggle("active", button.dataset.stage === stage);
      button.disabled = button.dataset.stage !== "setup" && !workspace.state.project.story;
    });
    const stageRoot = root.querySelector("[data-stage-root]");
    if (stage === "setup") renderSetupForm(stageRoot, context());
    else if (stage === "story") renderStoryDesigner(stageRoot, context());
    else renderPublishPanel(stageRoot, context());
    if (stage === "story" && draftToResume) {
      const draftId = draftToResume;
      draftToResume = null;
      const currentContext = context();
      requestAnimationFrame(() => resumeBranchWizard(currentContext, draftId, {
        openMetrics: () => { workspace.state.selection = { kind: "metrics" }; renderStage(); },
        manageMainline: () => openMainlineOrderDialog(currentContext),
      }));
    }
  }

  async function generateStory(button) {
    // 顶栏生成动作统一承担原 AI 扩写职责，独立扩写入口不再存在。
    const currentProject = workspace.state.project;
    const visibleBrief = visibleIdeaValue(root, currentProject.setup?.brief);
    if (ideaCharacterCount(visibleBrief) <= 30) {
      return toast("创作想法需要超过 30 个字，才能生成剧情结构。", "error");
    }
    // 浏览器恢复表单或自动填充时可能只恢复控件值；生成前以作者眼前内容同步项目状态。
    if (visibleBrief !== currentProject.setup.brief) {
      currentProject.setup.brief = visibleBrief;
      workspace.schedule({ setup: currentProject.setup }, { immediate: true });
    } else if (workspace.state.saveStatus === "failed") {
      // 上一次自动保存失败时，显式生成动作负责重试当前可见设定，不能继续读取服务端旧 brief。
      workspace.schedule({ title: currentProject.title, setup: currentProject.setup }, { immediate: true });
    }
    const continuing = workspace.state.project.generation_checkpoint?.available === true;
    if (workspace.state.project.story && !continuing) {
      const confirmed = await confirmDialog({ title: "重新生成剧情结构？", body: "将替换当前主线、连接草稿和 Normal 结局；保留作者填写的内容边界和数值。生成失败时不会覆盖当前地图。", confirmLabel: "重新生成" });
      if (!confirmed) return;
    }
    const saved = await workspace.flush();
    if (!saved) return toast("当前创作想法还没有保存成功，请检查保存状态后重试。", "error");
    button.disabled = true; button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>${continuing ? "正在继续生成剩余结构" : "正在生成剧情结构"}`;
    try {
      const result = await api.generate(workspace.state.project.project_id, workspace.state.project.revision);
      workspace.replaceProject(result.project); workspace.state.selection = { kind: "overview" }; stage = "story";
      window.history.pushState({}, "", workspaceUrl(project.project_id, stage)); toast("主线与 Normal 结局已生成；需要分支时再配置数值条件");
    } catch (error) {
      if (error.details?.project) workspace.replaceProject(error.details.project);
      toast(issueMessage(error), "error");
    } finally {
      // 顶栏按钮跨页面复用，请求结束后必须显式恢复，不能依赖内容区重绘。
      button.disabled = false;
      renderStage();
    }
  }

  async function showConflict(serverProject) {
    const reload = await confirmDialog({ title: "检测到保存冲突", body: "服务端项目已经有更新。本地草稿没有静默覆盖它。重新载入会以服务端版本继续。", confirmLabel: "重新载入" });
    if (reload) { workspace.replaceProject(serverProject); renderStage(); }
  }
}
