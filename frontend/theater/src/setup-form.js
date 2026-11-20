import { escapeHtml } from "./utils.js";

function boundaryRows(boundaries) {
  return boundaries.map((value, index) => `
    <div class="list-row"><input value="${escapeHtml(value)}" data-boundary-index="${index}" placeholder="例如：不使用突然失忆"><button class="icon-button subtle" type="button" data-remove-boundary="${index}" aria-label="删除内容禁区"><i class="fa-solid fa-xmark"></i></button></div>`).join("");
}

function generationResumeNotice(project) {
  if (project.generation_checkpoint?.available !== true) return "";
  const issues = Array.isArray(project.generation_error?.details?.issues) ? project.generation_error.details.issues : [];
  const remaining = issues.length || project.generation_checkpoint.remaining_issue_count || 0;
  const heading = remaining > 0 ? `还有 ${remaining} 项结构需要继续生成` : "生成进度已保存，可继续未完成的部分";
  const rows = issues.slice(0, 5).map((item) => `<li>${escapeHtml(item.message || item.code || "结构仍需补充")}<small>${escapeHtml(item.path || "")}</small></li>`).join("");
  return `<div class="generation-resume-note" role="alert"><i class="fa-solid fa-triangle-exclamation"></i><div><strong>${heading}</strong><p>已经通过校验的内容和当前候选都已保存，不会从头生成。</p>${rows ? `<ul>${rows}</ul>` : ""}</div></div>`;
}

export function ideaCharacterCount(value) {
  return Array.from(String(value || "").replace(/\s/g, "")).length;
}

export function visibleIdeaValue(root, fallback = "") {
  const input = root?.querySelector?.("#numeric-v2-brief");
  return typeof input?.value === "string" ? input.value : String(fallback || "");
}

export function renderSetupForm(root, context) {
  const { project } = context;
  const setup = project.setup;
  const ideaCount = ideaCharacterCount(setup.brief);
  const completedRequired = [project.title, setup.brief].filter((value) => String(value || "").trim()).length;
  // 短篇允许自然三幕，与生成器范围一致；主线章节数不包含独立的 Normal 结局。
  root.innerHTML = `
    <div class="setup-page overview-page">
      <header class="workspace-page-header">
        <div><p class="eyebrow">PROJECT OVERVIEW</p><h1>项目总览</h1><p>创作想法决定首次生成的主线与 Normal 结局；数值规则在故事地图中按实际分支需要配置。</p></div>
        <div class="overview-readiness"><span><i class="fa-solid fa-circle-check"></i>${completedRequired}/2 项必填</span></div>
      </header>
      <div class="overview-grid">
        <section class="overview-panel story-foundation-panel">
          <div class="panel-heading"><div><h2>故事设定</h2><p>描述冲突、关系与创作边界。背景和身份可在生成后继续细化。</p></div><span>基础</span></div>
          <div class="form-grid two">
            <label><span class="label-line">剧本标题 <span class="required">必填</span></span><input data-project-title maxlength="160" value="${escapeHtml(project.title)}" placeholder="给这个剧本一个名字"></label>
            <label><span class="label-line">题材 / 类型</span><input data-setup-field="genre" value="${escapeHtml(setup.genre)}" placeholder="例如：小镇、悬疑、冒险"></label>
          </div>
          <fieldset class="length-field"><legend>目标篇幅</legend><div class="choice-cards">${[["short", "短篇", "3—6 个主线章节"], ["standard", "标准", "6—10 个主线章节"], ["long", "长篇", "10—16 个主线章节"]].map(([value, label, hint]) => `<button type="button" class="choice-card ${setup.length_preset === value ? "selected" : ""}" data-length="${value}" aria-pressed="${setup.length_preset === value}"><span><strong>${label}</strong><small>${hint}</small></span><i class="fa-solid fa-check"></i></button>`).join("")}</div><small>生成剧情结构会按该范围创建主线章节，并同时生成一个 Normal 结局。</small></fieldset>
          <div class="brief-field"><div class="field-label-row"><label for="numeric-v2-brief"><span class="label-line">创作想法 <span class="required">必填</span></span></label></div><textarea id="numeric-v2-brief" data-setup-field="brief" rows="5" placeholder="用超过 30 个字写清人物、冲突和你想看到的故事方向。">${escapeHtml(setup.brief)}</textarea><small><span data-idea-hint>当前 ${ideaCount} 字，超过 30 字后可生成主线与 Normal 结局。</span> 生成成功后保留原文，并自动填写初始关系和整体基调。</small></div>
          <div class="form-grid two compact-fields">
            <label><span class="label-line">初始关系 <span class="field-note">生成后可修改</span></span><textarea data-setup-field="relationship" rows="3" placeholder="生成剧情结构后自动填写">${escapeHtml(setup.relationship)}</textarea></label>
            <label><span class="label-line">整体基调与氛围</span><textarea data-tone rows="3" placeholder="例如：克制、温柔、日常中透着悬疑">${escapeHtml((setup.tone || []).join("、"))}</textarea><small>使用顿号或逗号分隔多个短标签。</small></label>
          </div>
          <div class="field-block boundary-field"><div class="field-title"><span>内容边界与限制</span><button class="text-button" type="button" data-add-boundary><i class="fa-solid fa-plus"></i> 添加一项</button></div><div class="boundary-list">${boundaryRows(setup.content_boundaries || []) || `<p class="empty-inline">暂未设置内容边界。</p>`}</div></div>
          ${generationResumeNotice(project)}
          <div class="foundation-note"><i class="fa-solid fa-circle-info"></i><span>生成后可在故事地图中继续编辑背景、身份、节点和数值分支。</span></div>
        </section>
      </div>
    </div>`;

  const changed = () => context.schedule({ setup });
  root.querySelector("[data-project-title]").oninput = (event) => {
    project.title = event.target.value;
    context.schedule({ title: project.title });
    context.onTitle?.(project.title);
  };
  const ideaHint = root.querySelector("[data-idea-hint]");
  const syncIdeaState = () => {
    const count = ideaCharacterCount(setup.brief);
    ideaHint.textContent = `当前 ${count} 字，超过 30 字后可生成主线与 Normal 结局。`;
  };
  root.querySelectorAll("[data-setup-field]").forEach((input) => input.oninput = () => {
    setup[input.dataset.setupField] = input.value;
    if (input.dataset.setupField === "brief") syncIdeaState();
    changed();
  });
  root.querySelector("[data-tone]").oninput = (event) => {
    setup.tone = event.target.value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean); changed();
  };
  root.querySelectorAll("[data-length]").forEach((button) => button.onclick = () => { setup.length_preset = button.dataset.length; changed(); context.rerender(); });
  root.querySelectorAll("[data-boundary-index]").forEach((input) => input.oninput = () => { setup.content_boundaries[Number(input.dataset.boundaryIndex)] = input.value; changed(); });
  root.querySelector("[data-add-boundary]").onclick = () => { setup.content_boundaries.push(""); changed(); context.rerender(); };
  root.querySelectorAll("[data-remove-boundary]").forEach((button) => button.onclick = () => { setup.content_boundaries.splice(Number(button.dataset.removeBoundary), 1); changed(); context.rerender(); });
}
