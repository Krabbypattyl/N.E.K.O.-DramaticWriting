import { api } from "./api.js";
import { confirmDialog, toast } from "./dialogs.js";
import { issueMessage } from "./copy.js";
import { escapeHtml, findRoute, humanCondition, routeCount } from "./utils.js";

function textList(values, name) {
  return (values || []).map((value, index) => `
    <div class="list-row"><input value="${escapeHtml(value)}" data-list="${name}" data-index="${index}"><button type="button" class="icon-button subtle" data-remove-list="${name}" data-index="${index}"><i class="fa-solid fa-xmark"></i></button></div>`).join("");
}

const GOAL_OUTPUT_FIELDS = {
  catgirl_dialogue: "performance_dialogue",
  catgirl_action: "performance_action",
  environment_fact: "scene_update",
  player_action: "player_input",
  shared_agreement: "shared",
  semantic_state: "evaluator",
};

// 节点编辑器与后端生成器共用三回合短篇默认值；作者仍可在合法范围内手动调整。
const DEFAULT_NODE_TURNS = 3;

function goalsMarkup(goals = []) {
  return goals.map((goal, index) => `<article class="field-block">
    <div class="field-title"><span>${escapeHtml(goal.id || `目标 ${index + 1}`)}</span><button class="text-button" type="button" data-remove-goal="${index}">删除</button></div>
    <div class="form-grid two"><label>主体<select data-goal-field="owner" data-index="${index}">${["catgirl", "player", "shared", "environment"].map((value) => `<option value="${value}" ${goal.owner === value ? "selected" : ""}>${value}</option>`).join("")}</select></label><label>交付类型<select data-goal-field="delivery.type" data-index="${index}">${Object.keys(GOAL_OUTPUT_FIELDS).map((value) => `<option value="${value}" ${goal.delivery?.type === value ? "selected" : ""}>${value}</option>`).join("")}</select></label></div>
    <label>目标描述<textarea rows="2" data-goal-field="description" data-index="${index}">${escapeHtml(goal.description)}</textarea></label>
    <div class="form-grid two"><label>证据模式<select data-goal-field="evidence.mode" data-index="${index}"><option value="exact" ${goal.evidence?.mode === "exact" ? "selected" : ""}>exact</option><option value="semantic" ${goal.evidence?.mode === "semantic" ? "selected" : ""}>semantic</option></select></label><label>输出位置<input value="${escapeHtml(goal.delivery?.output_field)}" readonly></label></div>
    <label>字面锚点（每行一项）<textarea rows="2" data-goal-list="evidence.anchors" data-index="${index}">${escapeHtml((goal.evidence?.anchors || []).join("\n"))}</textarea></label>
    <label>事实来源 ID（每行一项）<textarea rows="2" data-goal-list="delivery.source_ids" data-index="${index}">${escapeHtml((goal.delivery?.source_ids || []).join("\n"))}</textarea></label>
  </article>`).join("");
}

function editorHeader(kicker, title, icon) {
  return `<div class="inspector-header"><div class="inspector-mark"><i class="fa-solid ${icon}"></i></div><div><p class="eyebrow">${kicker}</p><h2>${escapeHtml(title)}</h2></div></div>`;
}

const QUALITY_LABELS = {
  characterization: "人物塑造",
  plot: "情节构思",
  theme: "主题思想",
  prose_style: "文笔风格",
  pacing: "叙事节奏",
  emotional_resonance: "情感共鸣",
};

function radarPoint(index, ratio, radius = 62, centerX = 110, centerY = 76) {
  const angle = (-Math.PI / 2) + (index * Math.PI * 2 / 6);
  return [
    centerX + Math.cos(angle) * radius * ratio,
    centerY + Math.sin(angle) * radius * ratio,
  ];
}

function radarPoints(ratio) {
  return Object.keys(QUALITY_LABELS).map((_, index) => radarPoint(index, ratio).join(",")).join(" ");
}

function qualityRadarMarkup(scores) {
  const entries = Object.entries(QUALITY_LABELS);
  const scorePoints = entries.map(([key], index) => radarPoint(index, Math.max(0, Math.min(100, Number(scores[key]?.score || 0))) / 100));
  return `<div class="quality-radar"><div class="mini-heading"><span>六维雷达图</span><small>单项合格线 75</small></div><svg viewBox="0 0 220 168" role="img" aria-label="六维评分雷达图">
    ${[0.25, 0.5, 0.75, 1].map((ratio) => `<polygon class="quality-radar-ring ${ratio === 0.75 ? "pass-line" : ""}" points="${radarPoints(ratio)}"></polygon>`).join("")}
    ${entries.map((_, index) => { const [x, y] = radarPoint(index, 1); return `<line class="quality-radar-axis" x1="110" y1="76" x2="${x}" y2="${y}"></line>`; }).join("")}
    <polygon class="quality-radar-score" points="${scorePoints.map((point) => point.join(",")).join(" ")}"></polygon>
    ${scorePoints.map(([x, y]) => `<circle class="quality-radar-dot" cx="${x}" cy="${y}" r="2.5"></circle>`).join("")}
    ${entries.map(([key, label], index) => { const [x, y] = radarPoint(index, 1.28); const anchor = x < 104 ? "end" : x > 116 ? "start" : "middle"; return `<text x="${x}" y="${y}" text-anchor="${anchor}">${label}<tspan x="${x}" dy="10">${Number(scores[key]?.score || 0).toFixed(0)}</tspan></text>`; }).join("")}
  </svg></div>`;
}

function repairTargetLabel(target, nodes) {
  // 把已经核实的字段位置翻译成作者可判断的内容名称，不从建议文字猜测修改位置。
  const node = nodes.get(target?.node_id);
  const parts = String(target?.field || "").split("/").slice(1);
  const names = { title: "标题", summary: node?.type === "ending" ? "结局摘要" : "剧情摘要",
    scene_summary: "节点正文摘要", opening_scene: "开场", relationship_state: "角色处境",
    transition_goal: "推进方向", must_not_happen: "剧情边界", narrative_focus: "演绎方向" };
  let label = names[parts[0]] || "其它字段";
  if (parts[0] === "character_state") label = { catgirl: "女主状态", player: "玩家状态", environment: "环境状态" }[parts[1]] || "状态规则";
  if (parts[0] === "goals") label = "剧情目标";
  if (parts[0] === "acting_contract") label = "角色演绎权限";
  if (parts[0] === "outgoing_routes") label = `转场 · ${{ bridge_scene_narration: "旁白", reason: "原因", must_deliver: "交付结果", must_preserve: "保留事实", tone: "语气", source_ids: "来源依据" }[parts[3]] || "路线设置"}`;
  return `${node?.chapter || target?.node_id || "未识别节点"} · ${label}`;
}

function qualityPlanMarkup(issue, nodes) {
  // 同一精确修法只显示一次，链接仍保留每条问题自己的原因与预期效果。
  return issue.shared_plan_issue_id
    ? `<a href="#quality-${escapeHtml(issue.shared_plan_issue_id)}">与上述问题共用修改方案</a>`
    : `${issue.repair_targets?.length ? `<small>修改位置：${issue.repair_targets.map((target) => escapeHtml(repairTargetLabel(target, nodes))).join("；")}</small>` : ""}<span>${escapeHtml(issue.modification_plan || issue.suggestion)}</span>`;
}

function evidenceReviewMarkup(issue, nodes) {
  // 原问题与复核意见并列展示，保持原文的字段也逐项列出，不隐藏被否定的报告内容。
  const review = issue.evidence_review;
  if (!review) return "";
  const label = { supported: "证据支持", unsupported: "证据不支持", uncertain: "证据不足" }[review.verdict] || "尚未复核";
  return `<section class="quality-evidence-review"><strong>证据复核 · ${escapeHtml(label)}</strong><p>${escapeHtml(review.reason)}</p>
    ${review.verdict !== "supported" ? "<p>不据此扣分或执行节点优化。</p>" : ""}
    ${(review.target_checks || []).map((target) => `<div><b>${escapeHtml(repairTargetLabel(target, nodes))} · ${target.requires_change ? "需要修改" : "保持原文"}</b><p>${escapeHtml(target.reason)}</p></div>`).join("")}</section>`;
}

function planReviewMarkup(issue, nodes) {
  // 复核不取代原方案；遗漏位置只作说明，不进入节点修订的授权字段。
  const review = issue.plan_review;
  if (!review) return "";
  const labels = { ready: "可执行", blocked: "暂不可执行", uncertain: "判断不明" };
  const label = labels[review.status] || "尚未复核";
  // 一条方案单独成立也可能与其他方案互斥；原局部意见和组合冲突说明都展示，旧报告仍可读。
  return `<section class="quality-evidence-review"><strong>方案复核 · ${escapeHtml(label)}</strong><p>${escapeHtml(review.reason)}</p>
    ${review.conflict_checks?.length ? `<small>单条方案：${escapeHtml(labels[review.local_status] || "尚未复核")}；合并执行时存在冲突。</small>${review.conflict_checks.map((pair) => `<p>组合冲突：${escapeHtml(pair.reason)}</p>`).join("")}` : ""}
    ${review.conflicting_issue_ids?.length ? `<p>冲突方案：${review.conflicting_issue_ids.map((id) => `<a href="#quality-${escapeHtml(id)}">${escapeHtml(id)}</a>`).join("、")}</p>` : ""}
    ${review.missing_targets?.length ? `<p>方案遗漏的修改位置（未授权）：${review.missing_targets.map((target) => escapeHtml(repairTargetLabel(target, nodes))).join("；")}</p>` : ""}</section>`;
}

function qualityAdviceMarkup(assessment, nodes) {
  const metric = assessment.metric_advice;
  const relationships = assessment.relationship_advice || [];
  const metricLists = metric ? [
    ["建议增加", metric.add],
    ["建议删除", metric.remove],
    ["建议合并", metric.merge],
  ].filter(([, values]) => values?.length) : [];
  if (!metric && !relationships.length) return "";
  return `<div class="quality-advice-grid">
    ${metric ? `<section><div class="mini-heading"><span>数值数量建议</span><strong>${Number(metric.current_count) || 0} → ${Number(metric.recommended_count) || 0}</strong></div><p>${escapeHtml(metric.summary)}</p>${metricLists.map(([label, values]) => `<div><b>${label}</b><span>${values.map(escapeHtml).join("；")}</span></div>`).join("")}</section>` : ""}
    ${relationships.length ? `<section><div class="mini-heading"><span>人物关系优化</span><strong>${relationships.length}</strong></div>${relationships.map((item) => `<article id="quality-${escapeHtml(item.issue_id || "")}"><b>${item.target_node_ids.map((id) => escapeHtml(nodes.get(id)?.chapter || id)).join("、")}</b><p>${escapeHtml(item.problem)}</p>${qualityPlanMarkup(item, nodes)}${planReviewMarkup(item, nodes)}<small>预期：${escapeHtml(item.expected_result)}</small></article>`).join("")}</section>` : ""}
  </div>`;
}

export function qualityOptimizationSuggestions(project, nodeId) {
  const assessment = project.authoring?.quality_assessment;
  // 旧报告仍可阅读，重新评分并核对具体字段后才允许执行。
  if (!assessment || assessment.stale === true || assessment.repair_plan_version !== 3) return [];
  // 确认弹窗也展示复核后的执行/保留范围，不能只让作者看到已被收窄的原方案。
  const nodes = new Map((project.story?.nodes || []).map((node) => [node.id, node]));
  const suggestionText = (issue) => [issue.modification_plan || issue.suggestion,
    // 确认时也能看到方案为何可执行，复核解释不成为新的修改指令。
    issue.plan_review ? `方案复核：${issue.plan_review.reason}` : "",
    ...(issue.evidence_review?.target_checks || []).map((target) => `${repairTargetLabel(target, nodes)}：${target.requires_change ? "需要修改" : "保持原文"}。${target.reason}`)].join("\n");
  const issueSuggestions = (assessment.issues || [])
    .filter((issue) => issue.repairable === true && issue.plan_review?.status === "ready" && (issue.repair_node_ids || issue.target_node_ids)?.includes(nodeId))
    .map((issue) => ({ problem: issue.problem, suggestion: suggestionText(issue), planId: issue.shared_plan_issue_id || issue.issue_id }));
  const relationshipSuggestions = (assessment.relationship_advice || [])
    .filter((advice) => advice.repairable === true && advice.plan_review?.status === "ready" && (advice.repair_node_ids || advice.target_node_ids)?.includes(nodeId))
    .map((advice) => ({ problem: advice.problem, suggestion: suggestionText(advice), planId: advice.shared_plan_issue_id || advice.issue_id }));
  const plans = new Map();
  for (const item of [...issueSuggestions, ...relationshipSuggestions]) {
    const existing = item.planId && plans.get(item.planId);
    if (existing) existing.problem += `\n${item.problem}`;
    else plans.set(item.planId || item, { problem: item.problem, suggestion: item.suggestion });
  }
  return [...plans.values()];
}

export function qualityOptimizationNodeIds(project) {
  return (project.story?.nodes || [])
    .map((node) => node.id)
    .filter((nodeId) => qualityOptimizationSuggestions(project, nodeId).length > 0);
}

function qualityAssessmentMarkup(project, failure) {
  // 失败提示属于本次请求；旧完整报告仍可查阅，但不能冒充本次已完成。
  const notice = failure?.projectId === project.project_id ? `<p role="alert" data-quality-failure>${escapeHtml(failure.message)}</p>` : "";
  const assessment = project.authoring?.quality_assessment;
  if (!assessment) return `<section class="quality-assessment empty">${notice}<div class="mini-heading"><span>剧情质量评分</span><small>默认关闭</small></div><p>评分不会随生成自动运行。点击后先核对状态、行动主体和时间顺序，再评文学质量；报出事实问题时会增加一次证据复核，有拟直接优化的建议时再统一复核一次修改方案，完成后展示全部原问题、复核意见与六维评分，不自动修改故事。</p><button class="button secondary full" type="button" data-assess-quality><i class="fa-solid fa-chart-simple"></i> 开始评分</button></section>`;
  const stale = assessment.stale === true;
  const needsReassessment = assessment.repair_plan_version !== 3;
  const scores = assessment.scores || {};
  // 全量展示后端问题，包含高分维度的轻微建议；通过与否使用后端的严重度判定。
  const issues = assessment.issues || [];
  // 多个维度可以引用同一事实，链接到唯一问题卡片，不重复复制修改方案。
  const factIssues = issues.filter((issue) => issue.source === "facts");
  const factLinks = (score) => (score?.fact_issue_ids || []).map((id) => {
    const index = factIssues.findIndex((issue) => issue.issue_id === id);
    return index < 0 ? "" : `<a href="#quality-${escapeHtml(id)}">事实问题 ${index + 1}</a>`;
  }).filter(Boolean).join("、");
  // 后端已把模型的明确关联转换为卡片ID；旧报告缺此字段时仍只显示事实关联。
  const linkedIssues = [...issues.filter((issue) => issue.source !== "facts"), ...(assessment.relationship_advice || [])];
  const basisLinks = (score) => [factLinks(score), ...(score?.related_issue_ids || []).map((id) => {
    const issue = linkedIssues.find((item) => item.issue_id === id);
    return issue ? `<a href="#quality-${escapeHtml(id)}">${escapeHtml(QUALITY_LABELS[issue.dimension] || "人物关系")}问题</a>` : "";
  })].filter(Boolean).join("、");
  const nodes = new Map((project.story?.nodes || []).map((node) => [node.id, node]));
  return `<section class="quality-assessment ${stale ? "stale" : assessment.passed ? "passed" : "failed"}">
    ${notice}
    <div class="quality-assessment-head"><div><span>剧情质量评分</span><strong>${Number(assessment.overall_score || 0).toFixed(0)}</strong></div><em>${stale ? "内容已修改，评分已过期" : assessment.passed ? "已通过" : "有待改进"}</em></div>
    <p class="quality-rounds">${assessment.fact_check?.status === "complete" ? `事实核对已完成，原报告 ${Number(assessment.fact_check.issue_count)} 项问题${assessment.fact_check.evidence_review_status === "complete" ? `，证据支持 ${Number(assessment.fact_check.supported_count)} 项` : assessment.fact_check.evidence_review_status === "not_needed" ? "，无需额外复核" : "，尚无证据复核记录"}；以下六维分数为文学评分。` : "此历史报告未执行独立事实核对，可重新评分。"}</p>
    ${needsReassessment ? `<p role="status">此报告缺少当前证据、字段与方案复核，请重新评分后再优化；原报告仍可查阅。</p>` : ""}
    ${qualityRadarMarkup(scores)}
    <div class="quality-score-grid">${Object.entries(QUALITY_LABELS).map(([key, label]) => `<div><span>${label}</span><strong>${Number(scores[key]?.score || 0).toFixed(0)}</strong><small>${escapeHtml(scores[key]?.summary || "暂无说明")}</small>${basisLinks(scores[key]) ? `<small>关联依据：${basisLinks(scores[key])}</small>` : ""}</div>`).join("")}</div>
    ${qualityAdviceMarkup(assessment, nodes)}
    <p class="quality-rounds">${stale || needsReassessment ? "请重新评分后查看可执行的节点优化方案。" : "单项合格线为 75 分，所有问题均展示；存在证据支持的严重事实问题或严重文学问题时，即使高分也不通过。可单节点执行的建议已高亮到故事地图；点击高亮节点后决定是否优化。"}</p>
    ${issues.length ? `<div class="quality-issues">${issues.map((issue) => `<article id="quality-${escapeHtml(issue.issue_id || "")}"><header><b>${escapeHtml(issue.source === "facts" ? `事实核对 · ${{ state: "状态一致性", ownership: "行动归属", sequence: "时间顺序" }[issue.category] || "事实问题"}` : `${issue.source === "literature" ? "文学评分 · " : ""}${QUALITY_LABELS[issue.dimension] || issue.dimension}`)}</b><span>${issue.target_node_ids.map((id) => escapeHtml(nodes.get(id)?.chapter || id)).join("、")}</span></header><p>${escapeHtml(issue.problem)}</p>${issue.source === "facts" ? `<div><strong>原文依据</strong>${(issue.evidence || []).map((item) => `<blockquote title="${escapeHtml(item.path)}">${escapeHtml(item.quote)}</blockquote>`).join("")}</div>` : ""}<div><strong>原修改方案</strong>${qualityPlanMarkup(issue, nodes)}</div>${evidenceReviewMarkup(issue, nodes)}${planReviewMarkup(issue, nodes)}<small>预期：${escapeHtml(issue.expected_result)}</small>${stale || needsReassessment ? "" : issue.repairable === true && issue.plan_review?.status === "ready" ? `<p class="quality-map-plan"><i class="fa-solid fa-location-crosshairs"></i> 已在故事地图标记；点击对应节点选择是否优化</p>` : `<p class="quality-manual-plan"><i class="fa-solid fa-diagram-project"></i> ${escapeHtml(issue.repair_reason || "此方案需要手动调整，请在故事地图中处理")}</p>`}</article>`).join("")}</div>` : `<p class="quality-empty-result">没有需要修改的节点方案。</p>`}
    <button class="button ghost full" type="button" data-assess-quality><i class="fa-solid fa-rotate"></i> ${stale ? "重新评分" : "再次评分"}</button>
  </section>`;
}

function pacingDiagnosticsMarkup(project) {
  const diagnostics = project.authoring?.pacing_diagnostics;
  if (!diagnostics || !Array.isArray(diagnostics.scenes)) return "";
  const warningScenes = diagnostics.scenes.filter((scene) => (scene.warning_codes || []).length);
  if (!warningScenes.length) {
    return `<section class="branch-pacing-notice" role="status"><strong><i class="fa-solid fa-circle-check"></i> 主线节奏检查通过</strong><small>每幕都具备自然离幕动作，预计展开未超过 ${Number(diagnostics.soft_limit) || 8} 回合。该提示只服务作者，不会变成运行时换幕条件。</small></section>`;
  }
  // 将未知估算和严重超长分开展示，避免作者把“结构下限”误认为模型已确认的时长。
  const warningText = (scene) => {
    const codes = new Set(scene.warning_codes || []);
    const details = [];
    if (codes.has("scene_natural_exit_player_action_missing")) details.push("缺少可由玩家亲自执行的离幕动作");
    if (codes.has("scene_natural_exit_player_action_not_actionable")) details.push("离幕说明只有观察/等待，没有可提交动作");
    if (codes.has("scene_expected_turns_unknown")) details.push("预计回合数未可靠估算");
    if (codes.has("scene_expected_turns_exceed_8")) details.push("超过 8 回合软预算");
    if (codes.has("scene_expected_turns_exceed_40")) details.push("超过 40 回合，建议拆幕");
    return details.join("；");
  };
  return `<section class="branch-pacing-notice" role="status"><strong><i class="fa-solid fa-chart-line"></i> 主线节奏提示</strong><ul>${warningScenes.map((scene) => `<li><strong>${escapeHtml(scene.title || `第 ${scene.chapter_index} 幕`)}</strong><span>${scene.expected_turns == null ? "预计回合数未知" : `预计 ${Number(scene.estimated_turns) || 0} 回合`}；${escapeHtml(warningText(scene))}</span></li>`).join("")}</ul><small>请优先压缩事件链或补充具体离幕行动；提示不会强制换幕。</small></section>`;
}

function overviewMarkup(project, qualityFailure) {
  const story = project.story;
  const metrics = Object.values(story.metric_schema || {});
  return `${editorHeader("STORY OVERVIEW", "剧情概览", "fa-compass")}
    <div class="inspector-scroll">
      ${qualityAssessmentMarkup(project, qualityFailure)}
      ${pacingDiagnosticsMarkup(project)}
      <label>背景介绍<textarea rows="5" data-intro="background">${escapeHtml(story.intro?.background)}</textarea></label>
      <label>玩家身份<textarea rows="3" data-intro="player_identity">${escapeHtml(story.intro?.player_identity)}</textarea></label>
      <label>猫娘剧本身份<textarea rows="3" data-intro="catgirl_identity">${escapeHtml(story.intro?.catgirl_identity)}</textarea></label>
      <label>当前猫娘角色覆盖<textarea rows="3" data-binding="role_overlay">${escapeHtml(story.catgirl_binding?.role_overlay)}</textarea></label>
      <div class="readout-grid"><div><span>节点</span><strong>${story.nodes?.length || 0}</strong></div><div><span>路线</span><strong>${routeCount(story)}</strong></div><div><span>结局</span><strong>${story.endings?.length || 0}</strong></div></div>
      <div class="inspector-section"><div class="mini-heading"><span>数值摘要</span><button class="text-button" data-edit-metrics>编辑数值</button></div>${metrics.map((metric) => `<div class="metric-readout"><span>${escapeHtml(metric.name)}</span><strong>${metric.initial}</strong><small>${metric.min}—${metric.max}</small></div>`).join("") || `<p class="empty-mini">纯主线无需数值；创建数值分支时再添加。</p>`}</div>
    </div>`;
}

function nodeMarkup(node, story) {
  const beat = node.story_beat || {};
  const isEnding = node.type === "ending";
  const ending = isEnding ? (story.endings || []).find((item) => item.id === node.ending_id) : null;
  if (isEnding) return endingMarkup(node, ending || {}, story);
  return `${editorHeader(node.type === "start" ? "START NODE" : "ACT NODE", node.chapter || "未命名节点", node.type === "start" ? "fa-play" : "fa-clapperboard")}
    <div class="inspector-scroll">
      <div class="readonly-row"><span>节点类型</span><strong>${node.type}</strong></div>
      <label>节点标题<input data-node-field="chapter" value="${escapeHtml(node.chapter)}"></label>
      <label>最少演绎回合（默认 3）<input type="number" min="1" max="20" step="1" data-node-number-field="min_turns" value="${Number(node.min_turns) || DEFAULT_NODE_TURNS}"></label>
      <p class="enhance-note">达到该回合数后，剧场才会检查路线条件；未满足条件时继续留在本幕演绎。</p>
      <label>建议收束回合（默认 3，可逐幕调整）<input type="number" min="${Number(node.min_turns) || DEFAULT_NODE_TURNS}" max="40" step="1" data-node-number-field="recommended_turns" value="${Number(node.recommended_turns) || Math.max(Number(node.min_turns) || DEFAULT_NODE_TURNS, DEFAULT_NODE_TURNS)}"></label>
      <p class="enhance-note">默认三回合；作者可按本幕复杂度调整。达到后只让演绎主动聚焦和收束，不会强制跳幕。</p>
      <label>剧情摘要<textarea rows="4" data-beat-field="summary">${escapeHtml(beat.summary)}</textarea></label>
      <label>当前叙事重心<textarea rows="3" data-beat-field="narrative_focus">${escapeHtml(beat.narrative_focus || beat.transition_goal)}</textarea></label>
      <label>唯一开场场景<textarea rows="4" data-beat-field="opening_scene">${escapeHtml(beat.opening_scene)}</textarea></label>
      ${/* start首幕同样使用幕完善入口，按钮和后端支持的类型保持一致。 */ ["start", "scene"].includes(node.type) ? `<button class="button ai-enhance-button full" type="button" data-enhance-node><i class="fa-solid fa-wand-magic-sparkles"></i> AI 完善幕节点</button><p class="enhance-note">根据节点类型、上文、进入条件、数值规则和当前标题摘要完善演绎约束。</p>` : ""}
      <div class="field-block"><div class="field-title"><span>结构化目标</span><button class="text-button" type="button" data-add-goal>添加</button></div>${goalsMarkup(beat.goals)}</div>
      <div class="field-block"><div class="field-title"><span>不得发生</span><button class="text-button" data-add-list="must_not_happen">添加</button></div>${textList(beat.must_not_happen, "must_not_happen")}</div>
      <label>猫娘当前处境<textarea rows="4" data-beat-field="catgirl_situation">${escapeHtml(beat.catgirl_situation)}</textarea></label>
      <label>过渡目标<textarea rows="4" data-beat-field="transition_goal">${escapeHtml(beat.transition_goal)}</textarea></label>
      <section class="inspector-section route-creator"><div class="mini-heading"><span>从这里添加路线</span></div><select data-route-target><option value="">选择目标节点</option>${(story.nodes || []).filter((item) => item.id !== node.id).map((item) => `<option value="${item.id}">${escapeHtml(item.chapter || item.id)}</option>`).join("")}</select><button class="button secondary full" data-add-route><i class="fa-solid fa-code-branch"></i> 添加路线</button><p class="enhance-note">单出口可直接顺序推进；同一幕出现多个出口时，每条路线都必须设置数值条件。</p></section>
      ${node.type !== "start" ? `<button class="button danger-outline full" data-delete-node><i class="fa-solid fa-trash-can"></i> 删除幕节点</button>` : ""}
    </div>`;
}

function endingMarkup(node, ending, story) {
  const beat = node.story_beat || {};
  const incoming = (story.nodes || []).flatMap((source) => (source.route_gates || []).filter((route) => route.target_node_id === node.id).map((route) => ({ source, route })));
  return `${editorHeader("ENDING NODE", ending.title || node.chapter || "未命名结局", "fa-flag-checkered")}
    <div class="inspector-scroll">
      <label>结局标题<input data-ending-field="title" value="${escapeHtml(ending.title)}"></label>
      <label>结局摘要<textarea rows="3" data-ending-field="summary">${escapeHtml(ending.summary)}</textarea></label>
      <button class="button ai-enhance-button full" type="button" data-enhance-node><i class="fa-solid fa-wand-magic-sparkles"></i> AI 完善结局节点</button><p class="enhance-note">根据节点类型、上文、进入条件、数值规则和当前标题摘要完善结局收束。</p>
      <label>作者识别标题<input data-node-field="chapter" value="${escapeHtml(node.chapter)}"></label>
      <label>唯一结局开场<textarea rows="4" data-beat-field="opening_scene">${escapeHtml(beat.opening_scene)}</textarea></label>
      <div class="field-block"><div class="field-title"><span>结构化结局目标</span><button class="text-button" type="button" data-add-goal>添加</button></div>${goalsMarkup(beat.goals)}</div>
      <div class="field-block"><div class="field-title"><span>不得逆转的作者事实</span><button class="text-button" data-add-list="must_not_happen">添加</button></div>${textList(beat.must_not_happen, "must_not_happen")}</div>
      <label>猫娘在结局中的处境<textarea rows="4" data-beat-field="catgirl_situation">${escapeHtml(beat.catgirl_situation)}</textarea></label>
      <label>收束语气<textarea rows="3" data-beat-field="transition_goal">${escapeHtml(beat.transition_goal)}</textarea></label>
      <div class="inspector-section"><div class="mini-heading"><span>进入该结局的路线</span><b>${incoming.length}</b></div>${incoming.map(({ source, route }) => `<button class="incoming-route" data-select-route="${route.id}"><span>${escapeHtml(source.chapter)}</span><i class="fa-solid fa-arrow-right"></i><strong>${escapeHtml(route.id)}</strong></button>`).join("") || `<p class="empty-mini">还没有路线进入该结局。</p>`}</div>
      <button class="button danger-outline full" data-delete-node><i class="fa-solid fa-trash-can"></i> 删除结局</button>
    </div>`;
}

function sceneOpeningText(beat = {}) {
  const opening = String(beat.opening_scene || "").trim();
  if (opening) return opening;
  // 与 N.E.K.O 的 scene_opening_text 保持一致：旧包只取摘要或角色处境的首句，不预演整幕。
  for (const value of [beat.summary, beat.catgirl_situation]) {
    const text = String(value || "").trim();
    if (!text) continue;
    const end = text.search(/[。！？!?\n]/u);
    return (end < 0 ? text : text.slice(0, end + 1)).trim();
  }
  return "";
}

function routeMarkup(source, route, story, semantic) {
  const mode = route.conditions?.any ? "any" : "all";
  const rows = route.conditions?.[mode] || [];
  const metricSchema = story.metric_schema || {};
  const target = (story.nodes || []).find((node) => node.id === route.target_node_id);
  const targetOpening = sceneOpeningText(target?.story_beat || {});
  return `${editorHeader("ROUTE GATE", `${source.chapter} → ${target?.chapter || "未知节点"}`, "fa-code-branch")}
    <div class="inspector-scroll">
      <div class="route-summary ${semantic ? "semantic" : ""}"><span>${semantic ? escapeHtml(semantic.label) : `当 ${rows.map((row) => `“${humanCondition(row, metricSchema)}”`).join(mode === "all" ? " 并且 " : " 或 ") || "条件未填写"}`}</span><strong>${semantic ? escapeHtml(semantic.detail || "由支线向导确定性生成") : `优先级 ${route.priority}`}</strong></div>
      <p class="route-condition-note">${source.route_gates.length === 1 ? "这是该幕的唯一出口，可以不设置数值条件。" : "该幕存在多个出口；所有路线都必须设置数值条件。"}</p>
      <details class="route-advanced" ${semantic ? "" : "open"}><summary><span><i class="fa-solid fa-sliders"></i> 高级条件</span><small>目标、原始阈值与 priority</small><i class="fa-solid fa-chevron-down"></i></summary><div class="route-advanced-body">
        <div class="readonly-row"><span>来源节点</span><strong>${escapeHtml(source.chapter)}</strong></div>
        <label>目标节点<select data-route-field="target_node_id">${target ? "" : `<option value="${escapeHtml(route.target_node_id)}" selected>目标节点不存在</option>`}${(story.nodes || []).filter((node) => node.id !== source.id).map((node) => `<option value="${node.id}" ${node.id === route.target_node_id ? "selected" : ""}>${escapeHtml(node.chapter || node.id)}</option>`).join("")}</select></label>
        <div class="form-grid two"><div class="field-like"><span>条件模式</span><div class="condition-mode-tabs"><button type="button" data-condition-mode="all" class="${mode === "all" ? "selected" : ""}">全部满足 all</button><button type="button" data-condition-mode="any" class="${mode === "any" ? "selected" : ""}">任一满足 any</button></div></div><label>优先级<input type="number" data-route-field="priority" value="${route.priority}"></label></div>
        <div class="field-block"><div class="field-title"><span>数值条件</span><button class="text-button" data-add-condition>添加条件</button></div>
          ${rows.map((row, index) => `<div class="condition-row"><select data-condition-field="metric" data-index="${index}">${Object.entries(metricSchema).map(([id, metric]) => `<option value="${id}" ${id === row.metric ? "selected" : ""}>${escapeHtml(metric.name)}</option>`).join("")}</select><select data-condition-field="op" data-index="${index}">${[">=", ">", "<=", "<", "==", "!="].map((op) => `<option value="${op}" ${op === row.op ? "selected" : ""}>${escapeHtml(op)}</option>`).join("")}</select><input type="number" data-condition-field="value" data-index="${index}" value="${row.value}"><button class="icon-button subtle" data-remove-condition="${index}"><i class="fa-solid fa-xmark"></i></button></div>`).join("")}
        </div>
      </div></details>
      <section class="field-block" data-transition-review>
        <div class="field-title"><span>转场联合审阅</span></div>
        <p class="enhance-note">请对照邀请、换场结果和新幕开场，确认是否承接同一个玩家选择，是否提前完成了尚未选择的行动。这里只展示作者原文，不作通过或失败判定。</p>
        <label>触发原因<textarea rows="3" data-transition-field="reason">${escapeHtml(route.transition_contract?.reason)}</textarea></label>
        <label>确定性换场旁白<textarea rows="3" data-transition-field="bridge_scene_narration">${escapeHtml(route.transition_contract?.bridge_scene_narration)}</textarea></label>
        <label>目标开场（作者原文，只读）<textarea rows="4" data-target-opening readonly>${escapeHtml(targetOpening)}</textarea></label>
        <p class="enhance-note">${!target ? "目标节点不存在，请先重新选择目标。" : !targetOpening ? "目标节点没有可展示的开场、摘要或角色处境，请补充作者内容。" : String(target.story_beat?.opening_scene || "").trim() ? "展示目标节点的完整显式开场。" : "未填写显式开场，按运行时规则展示摘要或角色处境的首句。"}</p>
        <button class="button secondary full" type="button" data-edit-transition-target ${target ? "" : "disabled"}>编辑目标节点</button>
      </section>
      <div class="field-block"><div class="field-title"><span>换场事实来源</span><button class="text-button" data-add-transition-list="source_ids">添加</button></div>${textList(route.transition_contract?.source_ids, "transition.source_ids")}</div>
      <div class="field-block"><div class="field-title"><span>必须交付</span><button class="text-button" data-add-transition-list="must_deliver">添加</button></div>${textList(route.transition_contract?.must_deliver, "transition.must_deliver")}</div>
      <div class="field-block"><div class="field-title"><span>必须保留</span><button class="text-button" data-add-transition-list="must_preserve">添加</button></div>${textList(route.transition_contract?.must_preserve, "transition.must_preserve")}</div>
      <label>过渡语气<input data-transition-field="tone" value="${escapeHtml(route.transition_contract?.tone)}"></label>
      <button class="button danger-outline full" data-delete-route><i class="fa-solid fa-trash-can"></i> 删除路线</button>
    </div>`;
}

export function renderInspector(root, context) {
  const { project, selection } = context;
  const story = project.story;
  if (selection.kind === "route") {
    const found = findRoute(story, selection.id);
    const semantic = project.authoring?.route_semantics?.[selection.id];
    root.innerHTML = found ? routeMarkup(found.node, found.route, story, semantic) : overviewMarkup(project, context.viewState?.qualityFailure);
    if (found) bindRoute(root, context, found.node, found.route);
    return;
  }
  if (selection.kind === "node" || selection.kind === "ending") {
    const node = story.nodes.find((item) => item.id === selection.id);
    root.innerHTML = node ? nodeMarkup(node, story) : overviewMarkup(project, context.viewState?.qualityFailure);
    if (node) bindNode(root, context, node);
    return;
  }
  root.innerHTML = overviewMarkup(project, context.viewState?.qualityFailure);
  bindOverview(root, context);
}

function storyChanged(context) {
  context.schedule({ story: context.project.story });
}

function bindOverview(root, context) {
  root.querySelectorAll("[data-intro]").forEach((input) => input.oninput = () => { context.project.story.intro[input.dataset.intro] = input.value; storyChanged(context); });
  root.querySelectorAll("[data-binding]").forEach((input) => input.oninput = () => { context.project.story.catgirl_binding[input.dataset.binding] = input.value; storyChanged(context); });
  root.querySelector("[data-edit-metrics]")?.addEventListener("click", () => context.select({ kind: "metrics" }));
  root.querySelector("[data-assess-quality]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (!(await context.flush())) return toast("当前故事还没有保存成功，请稍后重试。", "error");
    button.disabled = true;
    context.viewState.qualityFailure = null;
    root.querySelector("[data-quality-failure]")?.remove();
    button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 正在核对事实与评分`;
    try {
      const current = context.project;
      const result = await api.assessQuality(current.project_id, current.revision);
      context.replaceProject(result.project);
      const nodeIds = qualityOptimizationNodeIds(result.project);
      context.viewState.qualityHighlights = {
        assessmentHash: result.project.authoring?.quality_assessment?.content_sha256,
        nodeIds,
      };
      toast(nodeIds.length ? `事实核对与文学评分完成；已高亮 ${nodeIds.length} 个建议优化节点` : "事实核对与文学评分完成；没有可单节点自动优化的建议");
      context.select({ kind: "overview" });
    } catch (error) {
      button.disabled = false;
      const assessment = context.project.authoring?.quality_assessment;
      const label = assessment?.stale ? "重新评分" : assessment ? "再次评分" : "开始评分";
      button.innerHTML = `<i class="fa-solid fa-rotate"></i> ${label}`;
      const message = `${issueMessage(error)}${assessment ? " 下方保留的是上次完成的报告。" : ""}`;
      context.viewState.qualityFailure = { projectId: context.project.project_id, message };
      toast(message, "error");
      context.select({ kind: "overview" });
    }
  });
}

function bindLists(root, context, target, prefix = "") {
  root.querySelectorAll("[data-list]").forEach((input) => input.oninput = () => {
    const name = input.dataset.list.replace(prefix, ""); target[name][Number(input.dataset.index)] = input.value; storyChanged(context);
  });
  root.querySelectorAll("[data-add-list]").forEach((button) => button.onclick = () => { target[button.dataset.addList].push(""); storyChanged(context); context.rerender(); });
  root.querySelectorAll("[data-remove-list]").forEach((button) => button.onclick = () => {
    const raw = button.dataset.removeList;
    const name = raw.startsWith("transition.") ? raw.split(".")[1] : raw;
    target[name].splice(Number(button.dataset.index), 1); storyChanged(context); context.rerender();
  });
}

function bindNode(root, context, node) {
  const beat = node.story_beat;
  beat.goals ||= [];
  root.querySelectorAll("[data-node-field]").forEach((input) => input.oninput = () => { node[input.dataset.nodeField] = input.value; storyChanged(context); context.onOutlineChange?.(); });
  root.querySelectorAll("[data-node-number-field]").forEach((input) => input.oninput = () => {
    const field = input.dataset.nodeNumberField;
    if (field === "min_turns") {
      node.min_turns = Math.max(1, Math.min(20, Number(input.value) || DEFAULT_NODE_TURNS));
      node.recommended_turns = Math.max(
        node.min_turns,
        Math.min(40, Number(node.recommended_turns) || Math.max(node.min_turns, DEFAULT_NODE_TURNS)),
      );
    } else {
      const fallback = Math.max(Number(node.min_turns) || DEFAULT_NODE_TURNS, DEFAULT_NODE_TURNS);
      node.recommended_turns = Math.max(
        Number(node.min_turns) || DEFAULT_NODE_TURNS,
        Math.min(40, Number(input.value) || fallback),
      );
    }
    storyChanged(context);
  });
  root.querySelectorAll("[data-beat-field]").forEach((input) => input.oninput = () => { beat[input.dataset.beatField] = input.value; storyChanged(context); });
  root.querySelectorAll("[data-goal-field]").forEach((input) => input.oninput = () => {
    const goal = beat.goals[Number(input.dataset.index)];
    const [container, field] = input.dataset.goalField.split(".");
    if (field) goal[container][field] = input.value;
    else goal[container] = input.value;
    if (input.dataset.goalField === "delivery.type") {
      goal.delivery.output_field = GOAL_OUTPUT_FIELDS[input.value];
      const ownerByType = { catgirl_dialogue: "catgirl", catgirl_action: "catgirl", environment_fact: "environment", player_action: "player", shared_agreement: "shared" };
      if (ownerByType[input.value]) goal.owner = ownerByType[input.value];
      if (input.value === "semantic_state") goal.evidence = { mode: "semantic", anchors: [] };
    }
    storyChanged(context);
  });
  root.querySelectorAll("[data-goal-list]").forEach((input) => input.oninput = () => {
    const goal = beat.goals[Number(input.dataset.index)];
    const [container, field] = input.dataset.goalList.split(".");
    goal[container][field] = input.value.split("\n").map((value) => value.trim()).filter(Boolean);
    storyChanged(context);
  });
  root.querySelector("[data-add-goal]")?.addEventListener("click", () => {
    const goalId = `${node.id}_goal_${String(beat.goals.length + 1).padStart(2, "0")}`;
    beat.goals.push({ id: goalId, owner: "catgirl", description: "", evidence: { mode: "exact", anchors: [] }, delivery: { type: "catgirl_dialogue", output_field: "performance_dialogue", source_ids: [`opening.${node.id}`] } });
    storyChanged(context); context.rerender();
  });
  root.querySelectorAll("[data-remove-goal]").forEach((button) => button.onclick = () => {
    beat.goals.splice(Number(button.dataset.removeGoal), 1); storyChanged(context); context.rerender();
  });
  bindLists(root, context, beat);
  if (node.type === "ending") {
    const ending = context.project.story.endings.find((item) => item.id === node.ending_id);
    root.querySelectorAll("[data-ending-field]").forEach((input) => input.oninput = () => { ending[input.dataset.endingField] = input.value; storyChanged(context); });
  }
  root.querySelector("[data-enhance-node]")?.addEventListener("click", (event) => enhanceNode(context, node, event.currentTarget));
  root.querySelectorAll("[data-select-route]").forEach((button) => button.onclick = () => context.select({ kind: "route", id: button.dataset.selectRoute }));
  root.querySelector("[data-add-route]")?.addEventListener("click", async () => {
    const target = root.querySelector("[data-route-target]").value;
    if (!target) return toast("请先选择目标节点", "error");
    if (node.route_gates.length && !Object.keys(context.project.story.metric_schema || {}).length) {
      context.select({ kind: "metrics" });
      return toast("创建分支前，请先配置至少一个隐藏数值", "error");
    }
    const { id } = await api.allocateId(context.project.project_id, "route");
    const lastGoal = beat.goals?.at(-1)?.id;
    node.route_gates.push({ id, target_node_id: target, priority: 10, conditions: { all: [] }, transition_contract: { reason: "", bridge_scene_narration: "", source_ids: [lastGoal ? `goal.${lastGoal}` : `opening.${node.id}`], must_deliver: [""], must_preserve: [], tone: "" } });
    storyChanged(context); context.select({ kind: "route", id });
  });
  root.querySelector("[data-delete-node]")?.addEventListener("click", () => deleteNode(context, node));
}

async function enhanceNode(context, node, button) {
  const ending = node.type === "ending"
    ? context.project.story.endings.find((item) => item.id === node.ending_id)
    : null;
  const title = node.type === "ending" ? ending?.title : node.chapter;
  const summary = node.type === "ending" ? ending?.summary : node.story_beat?.summary;
  if (!String(title || "").trim() || !String(summary || "").trim()) {
    return toast("请先填写节点标题和剧情摘要", "error");
  }
  await context.flush();
  button.disabled = true;
  button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 正在完善`;
  try {
    const current = context.project;
    const result = await api.enhanceNode(current.project_id, node.id, current.revision);
    context.replaceProject(result.project);
    toast(node.type === "ending" ? "结局节点已完善" : "幕节点已完善");
    context.select({ kind: node.type === "ending" ? "ending" : "node", id: node.id });
  } catch (error) {
    button.disabled = false;
    button.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> ${node.type === "ending" ? "AI 完善结局节点" : "AI 完善幕节点"}`;
    toast(issueMessage(error), "error");
  }
}

async function deleteNode(context, node) {
  const incoming = context.project.story.nodes.flatMap((source) => (source.route_gates || []).filter((route) => route.target_node_id === node.id));
  if (incoming.length || node.route_gates.length) return toast(`请先删除与该节点相连的 ${incoming.length + node.route_gates.length} 条路线`, "error");
  if (!(await confirmDialog({ title: node.type === "ending" ? "删除结局？" : "删除剧情节点？", body: "该操作只修改当前作者草稿，并使旧编译结果失效。", confirmLabel: "确认删除", danger: true }))) return;
  context.project.story.nodes = context.project.story.nodes.filter((item) => item.id !== node.id);
  if (node.type === "ending") context.project.story.endings = context.project.story.endings.filter((item) => item.id !== node.ending_id);
  const editor = context.project.editor || { node_positions: {} };
  editor.node_positions ||= {};
  delete editor.node_positions[node.id];
  context.project.editor = editor;
  context.schedule({ story: context.project.story, editor });
  context.select({ kind: "overview" });
}

function bindRoute(root, context, source, route) {
  const mode = route.conditions.any ? "any" : "all";
  const rows = route.conditions[mode];
  root.querySelectorAll("[data-route-field]").forEach((input) => input.oninput = () => {
    route[input.dataset.routeField] = input.type === "number" ? Number(input.value) : input.value;
    storyChanged(context);
    // 先保留当前草稿再重绘，避免切换目标后仍审阅上一节点的开场。
    if (input.dataset.routeField === "target_node_id") context.rerender();
  });
  root.querySelector("[data-edit-transition-target]")?.addEventListener("click", () => {
    const target = context.project.story.nodes.find((node) => node.id === route.target_node_id);
    if (target) context.select({ kind: target.type === "ending" ? "ending" : "node", id: target.id });
  });
  root.querySelectorAll("[data-condition-mode]").forEach((button) => button.onclick = () => { const current = route.conditions[mode]; route.conditions = { [button.dataset.conditionMode]: current }; storyChanged(context); context.rerender(); });
  root.querySelectorAll("[data-condition-field]").forEach((input) => input.oninput = () => { rows[Number(input.dataset.index)][input.dataset.conditionField] = input.type === "number" ? Number(input.value) : input.value; storyChanged(context); });
  root.querySelector("[data-add-condition]").onclick = () => {
    const metric = Object.keys(context.project.story.metric_schema)[0] || "";
    if (!metric) {
      context.select({ kind: "metrics" });
      return toast("请先配置至少一个隐藏数值", "error");
    }
    rows.push({ type: "metric_compare", metric, op: ">=", value: context.project.story.metric_schema[metric]?.initial ?? 0 });
    storyChanged(context); context.rerender();
  };
  root.querySelectorAll("[data-remove-condition]").forEach((button) => button.onclick = () => { rows.splice(Number(button.dataset.removeCondition), 1); storyChanged(context); context.rerender(); });
  root.querySelectorAll("[data-transition-field]").forEach((input) => input.oninput = () => { route.transition_contract[input.dataset.transitionField] = input.value; storyChanged(context); });
  root.querySelectorAll("[data-add-transition-list]").forEach((button) => button.onclick = () => { route.transition_contract[button.dataset.addTransitionList].push(""); storyChanged(context); context.rerender(); });
  bindLists(root, context, route.transition_contract, "transition.");
  root.querySelector("[data-delete-route]").onclick = async () => {
    if (!(await confirmDialog({ title: "删除路线？", body: "不会自动重接来源和目标节点。", confirmLabel: "删除路线", danger: true }))) return;
    source.route_gates = source.route_gates.filter((item) => item.id !== route.id); storyChanged(context); context.select({ kind: "node", id: source.id });
  };
}
