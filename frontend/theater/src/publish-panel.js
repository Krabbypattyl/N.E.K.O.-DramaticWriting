import { api } from "./api.js";
import { issueMessage } from "./copy.js";
import { toast } from "./dialogs.js";
import { escapeHtml, routeCount } from "./utils.js";

const ANALYSIS_WARNING_LABELS = {
  route_mathematically_impossible: "数学不可达",
  node_numeric_unreachable: "数值不可达",
  ending_numeric_unreachable: "数值不可达",
  route_priority_shadowed: "优先级遮蔽",
  route_pacing_difficult: "软节奏困难",
  route_pacing_partial: "部分入口困难",
  ending_pacing_difficult: "结局节奏风险",
  route_analysis_unknown: "无法可靠分析",
  route_condition_gap: "路线覆盖缺口",
  route_transition_duplicate: "转场可辨识性",
};

function analysisWarningMessage(item) {
  // 编译问题仍展示原始信息；只有新增作者诊断补上容易理解的类别，不隐藏稳定 code。
  const label = ANALYSIS_WARNING_LABELS[item.code];
  return label ? `【${label}】${item.message}` : item.message;
}

function issueRows(project) {
  const compiled = project.compile_result || {};
  const issues = compiled.issues || project.generation_error?.details?.issues || [];
  const warnings = compiled.warnings || [];
  if (!issues.length && !warnings.length) return `<div class="empty-check"><i class="fa-solid fa-circle-check"></i><div><strong>当前没有已记录的问题</strong><span>${compiled.success ? "确定性编译已通过。" : "点击“检查剧本”获取当前 revision 的结果。"}</span></div></div>`;
  return [...issues.map((item) => ({ ...item, severity: "error" })), ...warnings.map((item) => ({ ...item, severity: "warning" }))].map((item) => `<div class="issue-row ${item.severity}"><i class="fa-solid ${item.severity === "error" ? "fa-circle-exclamation" : "fa-lightbulb"}"></i><div><strong>${escapeHtml(analysisWarningMessage(item))}</strong><span>${escapeHtml(item.path)}</span><code>${escapeHtml(item.code)}</code></div></div>`).join("");
}

export function renderPublishPanel(root, context) {
  const project = context.project;
  const story = project.story;
  const compiled = project.compile_result || {};
  const verified = project.status === "verified";
  // 检查交付只呈现正式编译与复验结果，不再维护额外的分支试算状态。
  root.innerHTML = `<div class="publish-page">
    <header class="workspace-page-header"><div><p class="eyebrow">VERIFY & DELIVER</p><h1>检查交付</h1><p>确定性检查和 N.E.K.O 复验集中在这里，不调用模型，也不改写故事。</p></div><div class="status-pill ${project.status}"><i class="fa-solid ${verified ? "fa-shield-halved" : compiled.success ? "fa-code" : "fa-magnifying-glass"}"></i><span>${verified ? "可交付" : compiled.success ? "等待复验" : "需要检查"}</span></div></header>
    <div class="publish-grid">
    <section class="publish-card compile-card">
      <div class="publish-heading"><div><p class="eyebrow">DETERMINISTIC COMPILE</p><h2>确定性编译</h2></div><button class="button primary" data-compile><i class="fa-solid fa-magnifying-glass"></i> 检查剧本</button></div>
      <div class="stat-strip"><div><span>数值</span><strong>${Object.keys(story.metric_schema || {}).length}</strong></div><div><span>节点</span><strong>${story.nodes.length}</strong></div><div><span>路线</span><strong>${routeCount(story)}</strong></div><div><span>结局</span><strong>${story.endings.length}</strong></div><div><span>软提示</span><strong>${compiled.warnings?.length || 0}</strong></div></div>
      ${compiled.package_hash ? `<details class="hash-detail"><summary>Package hash</summary><code>${escapeHtml(compiled.package_hash)}</code></details>` : ""}
    </section>
    <section class="publish-card"><div class="publish-heading"><div><p class="eyebrow">ISSUES & WARNINGS</p><h2>问题与提示</h2></div><span class="count-badge">${(compiled.issues || []).length + (compiled.warnings || []).length}</span></div><div class="issue-list">${issueRows(project)}</div></section>
    <section class="publish-card delivery-card"><div><p class="eyebrow">N.E.K.O VALIDATION</p><h2>复验与交付</h2><p>只有当前 package hash 通过 N.E.K.O 独立复验后，下载和安装才会开放。</p></div><div class="delivery-status ${verified ? "verified" : "pending"}"><i class="fa-solid ${verified ? "fa-shield-halved" : "fa-lock"}"></i><div><strong>${verified ? "N.E.K.O 复验通过" : "等待 N.E.K.O 复验"}</strong><span>${verified ? escapeHtml(project.neko_validation?.package_hash) : "先完成当前 revision 的确定性编译"}</span></div></div><div class="delivery-actions"><button class="button secondary" data-validate ${compiled.success ? "" : "disabled"}><i class="fa-solid fa-shield-halved"></i> 使用 N.E.K.O 复验</button><a class="button secondary ${verified ? "" : "disabled"}" ${verified ? `href="${api.exportUrl(project.project_id)}"` : "aria-disabled=true"}><i class="fa-solid fa-download"></i> 下载 Story Package</a><button class="button primary" data-install ${verified ? "" : "disabled"}><i class="fa-solid fa-box-archive"></i> 安装到 N.E.K.O</button></div>${project.install_result ? `<p class="install-result"><i class="fa-solid fa-circle-check"></i> 已安装：${escapeHtml(project.install_result.path || project.install_result.story_id || "N.E.K.O Numeric v2 包目录")}</p>` : ""}</section>
    </div>
  </div>`;
  bindPublish(root, context);
}

function bindPublish(root, context) {
  root.querySelector("[data-compile]").onclick = async (event) => {
    await runAction(event.currentTarget, "正在检查", async () => {
      await context.flush();
      try {
        const result = await api.compile(context.project.project_id, context.project.revision);
        context.replaceProject(result.project);
        toast("确定性编译通过");
      } catch (error) {
        if (error.details?.project) context.replaceProject(error.details.project);
        toast(issueMessage(error), "error");
      }
      context.rerender();
    });
  };
  root.querySelector("[data-validate]").onclick = async (event) => runAction(event.currentTarget, "正在复验", async () => {
    await context.flush();
    try { context.replaceProject(await api.validateNeko(context.project.project_id, context.project.revision)); toast("N.E.K.O 复验通过"); }
    catch (error) { toast(issueMessage(error), "error"); }
    context.rerender();
  });
  root.querySelector("[data-install]").onclick = async (event) => runAction(event.currentTarget, "正在安装", async () => {
    try { context.replaceProject(await api.install(context.project.project_id, context.project.revision)); toast("已安全安装到 N.E.K.O"); }
    catch (error) { toast(issueMessage(error), "error"); }
    context.rerender();
  });
}

async function runAction(button, label, action) {
  const original = button.innerHTML; button.disabled = true; button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${label}`;
  try { await action(); } finally { button.disabled = false; button.innerHTML = original; }
}
