import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderInspector, qualityOptimizationNodeIds, qualityOptimizationSuggestions } from "../../frontend/theater/src/story-inspector.js";
import { api, ApiError } from "../../frontend/theater/src/api.js";
import { issueMessage } from "../../frontend/theater/src/copy.js";
import { escapeHtml } from "../../frontend/theater/src/utils.js";

// 读取真实后端报告回放，检查所有事实/文学问题、证据及旧报告失败提示；不访问模型。
const projects = JSON.parse(readFileSync(0, "utf8"));
globalThis.fetch = () => { throw new Error("查看报告不得发出模型请求"); };
globalThis.document = { createElement: () => ({ remove() {} }), querySelector: () => ({ append() {} }) };
globalThis.setTimeout = () => 0;
for (const project of projects) {
  let click;
  const root = { innerHTML: "", querySelectorAll: () => [], querySelector: (selector) => selector === "[data-assess-quality]" ? { addEventListener(_event, handler) { click = handler; } } : null };
  const context = { project, selection: { kind: "overview" }, viewState: {}, flush: async () => true, select: () => renderInspector(root, context) };
  const before = JSON.stringify(project);
  renderInspector(root, context);
  assert.ok(root.innerHTML.includes("事实核对已完成"));
  // 维度扣分可指向同一事实卡片，原文与修改方案只需在该卡片展示一次。
  for (const score of Object.values(project.authoring.quality_assessment.scores || {})) {
    for (const id of score.fact_issue_ids || []) {
      assert.ok(root.innerHTML.includes(`href="#quality-${escapeHtml(id)}"`));
      assert.equal(root.innerHTML.split(`id="quality-${escapeHtml(id)}"`).length - 1, 1);
    }
    // 跨维度/关系引用跳到原卡片；引用两次也不能复制问题或修法，旧报告可缺该字段。
    for (const id of score.related_issue_ids || []) {
      const report = project.authoring.quality_assessment;
      const issue = [...report.issues, ...report.relationship_advice].find((item) => item.issue_id === id);
      assert.ok(issue, "引用必须来自真实后端报告中的已有问题");
      assert.ok(root.innerHTML.includes(`href="#quality-${escapeHtml(id)}"`));
      assert.equal(root.innerHTML.split(`id="quality-${escapeHtml(id)}"`).length - 1, 1);
    }
  }
  for (const issue of project.authoring.quality_assessment.issues) {
    assert.ok(root.innerHTML.includes(escapeHtml(issue.problem)));
    assert.ok(root.innerHTML.includes(escapeHtml(issue.modification_plan)));
    if (issue.evidence_review) {
      // 包含不受支持的问题、每个保留字段及其理由；查看报告不能触发模型调用。
      assert.ok(root.innerHTML.includes(escapeHtml(issue.evidence_review.reason)));
      for (const row of issue.evidence_review.target_checks) {
        assert.ok(root.innerHTML.includes(escapeHtml(row.reason)));
        assert.ok(root.innerHTML.includes(row.requires_change ? "需要修改" : "保持原文"));
      }
    }
    for (const evidence of issue.evidence || []) assert.ok(root.innerHTML.includes(escapeHtml(evidence.quote)));
  }
  // 文学与关系建议的复核同样全量展示，不能只呈现事实复核。
  for (const item of [...project.authoring.quality_assessment.issues, ...project.authoring.quality_assessment.relationship_advice]) {
    if (item.plan_review) {
      assert.ok(root.innerHTML.includes(escapeHtml(item.plan_review.reason)));
      for (const id of item.plan_review.conflicting_issue_ids || []) assert.ok(root.innerHTML.includes(`href="#quality-${escapeHtml(id)}"`));
      // 组合冲突不能覆盖或隐藏原局部意见，冲突原因必须完整显示且转义。
      for (const pair of item.plan_review.conflict_checks || []) {
        assert.ok(root.innerHTML.includes(escapeHtml(pair.reason)));
        assert.ok(root.innerHTML.includes("合并执行时存在冲突"));
      }
    }
  }
  const expected = project.authoring.quality_assessment.repair_plan_version !== 3 ? [] : (project.story.nodes || []).filter((node) => [...(project.authoring.quality_assessment.issues || []), ...(project.authoring.quality_assessment.relationship_advice || [])].some((issue) => issue.repairable && issue.plan_review?.status === "ready" && (issue.repair_node_ids || issue.target_node_ids).includes(node.id))).map((n) => n.id);
  assert.deepEqual(qualityOptimizationNodeIds(project), expected);
  if (project.authoring.quality_assessment.repair_plan_version !== 3) {
    assert.ok(root.innerHTML.includes("重新评分后再优化"));
  }
  for (const issue of project.authoring.quality_assessment.issues) {
    if (issue.shared_plan_issue_id) {
      assert.ok(root.innerHTML.includes(`href="#quality-${escapeHtml(issue.shared_plan_issue_id)}"`));
    }
  }
  for (const phase of ["facts", "evidence", "literature", "plan_review"]) {
    api.assessQuality = async () => { throw new ApiError({ status: 422 }, { error: { code: phase === "facts" ? "invalid_fact_review" : "invalid_quality_assessment", details: { phase } } }); };
    await click({ currentTarget: { disabled: false, innerHTML: "" } });
    assert.ok(root.innerHTML.includes("本次评分未完成"));
    assert.ok(root.innerHTML.includes("上次完成的报告"));
    assert.ok(root.innerHTML.includes(phase === "plan_review" ? "方案复核失败" : phase !== "literature" ? "文学评分尚未开始" : "文学评分失败"));
    assert.equal(JSON.stringify(project), before);
  }
}
assert.ok(issueMessage({ code: "model_timeout", details: { phase: "facts" } }).includes("本次评分未完成"));
console.log(`${projects.length} fact report rendering and failure cases passed`);

// 单独构造精确共用方案和旧报告，验证不隐藏两个影响，也不重复确认同一修法。
const grouped = structuredClone(projects[0]);
grouped.authoring.quality_assessment.repair_plan_version = 3;
const nodeId = grouped.story.nodes[0].id;
const issue = { issue_id: "one", source: "literature", dimension: "plot", repairable: true,
  plan_review: { status: "ready", reason: "方案范围完整", missing_targets: [], conflicting_issue_ids: [] },
  target_node_ids: [nodeId], problem: "第一个影响", modification_plan: "唯一修法", expected_result: "结果一致" };
grouped.authoring.quality_assessment.issues = [issue, { ...issue, issue_id: "two", problem: "第二个影响", shared_plan_issue_id: "one" }];
grouped.authoring.quality_assessment.relationship_advice = [];
const root = { innerHTML: "", querySelectorAll: () => [], querySelector: () => null };
renderInspector(root, { project: grouped, selection: { kind: "overview" }, viewState: {} });
assert.equal(root.innerHTML.split("唯一修法").length - 1, 1);
assert.ok(root.innerHTML.includes("第一个影响") && root.innerHTML.includes("第二个影响"));
assert.equal(qualityOptimizationSuggestions(grouped, nodeId).length, 1);
delete grouped.authoring.quality_assessment.repair_plan_version;
renderInspector(root, { project: grouped, selection: { kind: "overview" }, viewState: {} });
assert.deepEqual(qualityOptimizationNodeIds(grouped), []);
assert.ok(root.innerHTML.includes("重新评分后再优化"));

// 单条ready与整体blocked是不同结论；即使旧高亮仍在，组合冲突也不能放行任何一方。
const combined = structuredClone(grouped);
combined.authoring.quality_assessment.repair_plan_version = 3;
for (const item of combined.authoring.quality_assessment.issues) {
  item.plan_review = { status: "blocked", local_status: "ready", reason: "单条方案字段完整", missing_targets: [],
    conflicting_issue_ids: [item.issue_id === "one" ? "two" : "one"],
    conflict_checks: [{ issue_ids: ["one", "two"], reason: "改写与逐字保留互斥 <script>不得执行</script>" }] };
}
renderInspector(root, { project: combined, selection: { kind: "overview" }, viewState: {} });
assert.ok(root.innerHTML.includes("单条方案：可执行") && root.innerHTML.includes("方案复核 · 暂不可执行"));
assert.ok(root.innerHTML.includes("单条方案字段完整") && root.innerHTML.includes("&lt;script&gt;不得执行&lt;/script&gt;"));
assert.ok(!root.innerHTML.includes("<script>不得执行</script>"));
assert.deepEqual(qualityOptimizationNodeIds(combined), []);

// 未获支持的严重问题仍可见，但不高亮；旧version=1不能绕过重评要求。
const checked = structuredClone(grouped);
checked.authoring.quality_assessment.repair_plan_version = 3;
checked.authoring.quality_assessment.issues = [{ ...issue, source: "facts", severity: "blocking", repairable: false,
  repair_node_ids: [], evidence_review: { verdict: "unsupported", reason: "原文相容，无须修改", target_checks: [
    { node_id: nodeId, field: "/opening_scene", requires_change: false, reason: "开场已经正确" }] } }];
renderInspector(root, { project: checked, selection: { kind: "overview" }, viewState: {} });
assert.ok(root.innerHTML.includes("第一个影响") && root.innerHTML.includes("证据不支持") && root.innerHTML.includes("开场已经正确"));
assert.deepEqual(qualityOptimizationNodeIds(checked), []);
// 证据不足同样不能执行；确认弹窗必须逐项包含需改字段和保留字段，不能只重复原修法。
checked.authoring.quality_assessment.issues[0].evidence_review.verdict = "uncertain";
renderInspector(root, { project: checked, selection: { kind: "overview" }, viewState: {} });
assert.ok(root.innerHTML.includes("证据不足") && root.innerHTML.includes("不据此扣分或执行节点优化"));
assert.deepEqual(qualityOptimizationSuggestions(checked, nodeId), []);
const approved = checked.authoring.quality_assessment.issues[0];
approved.repairable = true;
approved.repair_node_ids = [nodeId];
approved.evidence_review.verdict = "supported";
approved.evidence_review.target_checks.push({ node_id: nodeId, field: "/character_state/catgirl", requires_change: true, reason: "角色状态确实需要纠正" });
const confirmation = qualityOptimizationSuggestions(checked, nodeId)[0].suggestion;
assert.ok(confirmation.includes("保持原文。开场已经正确") && confirmation.includes("需要修改。角色状态确实需要纠正"));
checked.authoring.quality_assessment.repair_plan_version = 1;
assert.deepEqual(qualityOptimizationNodeIds(checked), []);

// 即使旧高亮标记仍为true，blocked/uncertain或缺复核也不能执行；各条原意见仍然可见。
checked.authoring.quality_assessment.repair_plan_version = 3;
for (const status of ["blocked", "uncertain"]) {
  approved.plan_review = { status, reason: "原方案与保留要求相冲突", missing_targets: [{ node_id: nodeId, field: "/summary" }], conflicting_issue_ids: [] };
  renderInspector(root, { project: checked, selection: { kind: "overview" }, viewState: {} });
  assert.ok(root.innerHTML.includes("原方案与保留要求相冲突") && root.innerHTML.includes("方案遗漏的修改位置（未授权）"));
  assert.deepEqual(qualityOptimizationNodeIds(checked), []);
}
delete approved.plan_review;
assert.deepEqual(qualityOptimizationNodeIds(checked), []);
checked.authoring.quality_assessment.repair_plan_version = 2;
renderInspector(root, { project: checked, selection: { kind: "overview" }, viewState: {} });
assert.ok(root.innerHTML.includes("重新评分后再优化"));
