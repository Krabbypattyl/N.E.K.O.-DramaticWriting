import { api } from "./api.js";
import { modelSettingsDialog, confirmDialog, toast } from "./dialogs.js";
import { navigate, workspaceUrl } from "./router.js";
import { statusLabel, issueMessage } from "./copy.js";
import { escapeHtml } from "./utils.js";

function projectCard(project) {
  return `<article class="project-card">
    <div class="project-card-top"><span class="project-status ${project.status}"><i class="fa-solid fa-circle"></i>${statusLabel(project.status)}</span><button class="icon-button subtle" data-delete-project="${project.project_id}" aria-label="删除项目"><i class="fa-solid fa-ellipsis"></i></button></div>
    <div class="project-symbol"><i class="fa-solid fa-diagram-project"></i></div>
    <h2>${escapeHtml(project.title)}</h2><p>${escapeHtml(project.brief || "还没有填写创作需求。")}</p>
    <div class="project-meta"><span><i class="fa-solid fa-sliders"></i>${project.metric_count} 数值</span><span><i class="fa-solid fa-circle-nodes"></i>${project.node_count} 节点</span><span><i class="fa-solid fa-flag"></i>${project.ending_count} 结局</span></div>
    <div class="project-card-footer"><time>${new Date(project.updated_at).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time><button class="button card-action" data-open-project="${project.project_id}" data-stage="${project.stage}">继续编辑 <i class="fa-solid fa-arrow-right"></i></button></div>
  </article>`;
}

export async function renderProjectHome(root) {
  root.innerHTML = `<div class="loading-screen"><i class="fa-solid fa-spinner fa-spin"></i><span>正在读取作者项目</span></div>`;
  const projects = await api.listProjects();
  root.innerHTML = `<div class="home-shell">
    <header class="home-topbar"><a class="brand" href="/"><span class="brand-mark"><i class="fa-solid fa-pen-ruler"></i></span><span><strong>N.E.K.O.-DramaticWriting</strong><small>N.E.K.O · NUMERIC V2</small></span></a><button class="button ghost" data-model-settings><i class="fa-solid fa-gear"></i> 模型设置</button></header>
    <main class="home-main"><section class="home-hero"><div><p class="eyebrow">DETERMINISTIC STORY AUTHORING</p><h1>我的剧本</h1><p>先生成主线与结局，再从选定终点反推支线过程，不需要手算路线阈值。</p></div><div class="hero-actions"><button class="button secondary" data-import><i class="fa-solid fa-file-import"></i> 导入 Numeric v2</button><button class="button primary large" data-create><i class="fa-solid fa-plus"></i> 新建剧本</button></div></section>
      ${projects.length ? `<section class="project-grid">${projects.map(projectCard).join("")}</section>` : `<section class="home-empty"><div class="empty-illustration"><i class="fa-solid fa-diagram-project"></i></div><h2>从一条清晰的主线开始</h2><p>写下创作想法，由生成模型构建主线与结局地图。</p><div><button class="button primary" data-create><i class="fa-solid fa-plus"></i> 新建第一个剧本</button><button class="button ghost" data-import>导入 Numeric v2</button></div></section>`}
    </main><input type="file" accept="application/json,.json" hidden data-import-file>
  </div>`;
  root.querySelectorAll("[data-create]").forEach((button) => button.onclick = () => navigate("/projects/new"));
  root.querySelectorAll("[data-open-project]").forEach((button) => button.onclick = () => navigate(workspaceUrl(button.dataset.openProject, button.dataset.stage || "setup")));
  root.querySelector("[data-model-settings]").onclick = modelSettingsDialog;
  const fileInput = root.querySelector("[data-import-file]");
  root.querySelectorAll("[data-import]").forEach((button) => button.onclick = () => fileInput.click());
  fileInput.onchange = async () => {
    try {
      const file = fileInput.files[0]; if (!file || file.size > 5 * 1024 * 1024) throw new Error("文件必须小于 5 MB");
      const story = JSON.parse(await file.text());
      const project = await api.importStory(story);
      navigate(workspaceUrl(project.project_id, "story"));
    } catch (error) { toast(error.code ? issueMessage(error) : error.message, "error"); }
  };
  root.querySelectorAll("[data-delete-project]").forEach((button) => button.onclick = async () => {
    const project = projects.find((item) => item.project_id === button.dataset.deleteProject);
    if (!(await confirmDialog({ title: `删除“${escapeHtml(project.title)}”？`, body: "只删除当前作者草稿，不会删除已经安装到 N.E.K.O 的 Story Package。", confirmLabel: "删除作者项目", danger: true }))) return;
    try { await api.deleteProject(project.project_id, project.revision); toast("作者项目已删除"); renderProjectHome(root); }
    catch (error) { toast(issueMessage(error), "error"); }
  });
}
