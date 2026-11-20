import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderInspector, qualityOptimizationNodeIds } from "../../frontend/theater/src/story-inspector.js";
import { escapeHtml } from "../../frontend/theater/src/utils.js";

// 输入来自后端真实报告回放；调用实际渲染和高亮入口，禁止评分或修稿网络请求。
globalThis.fetch = () => { throw new Error("查看报告不得触发模型调用"); };
const cases = JSON.parse(readFileSync(0, "utf8"));
for (const { project, expectedIssueCount, expectedNodeIds } of cases) {
  const root = { innerHTML: "", querySelectorAll: () => [], querySelector: () => null };
  const before = JSON.stringify(project);
  renderInspector(root, { project, selection: { kind: "overview" } });
  const assessment = project.authoring.quality_assessment;
  assert.equal(assessment.issues.length, expectedIssueCount);
  for (const issue of assessment.issues) {
    assert.ok(root.innerHTML.includes(escapeHtml(issue.problem)), "不能隐藏高分或轻微问题");
    assert.ok(root.innerHTML.includes(escapeHtml(issue.modification_plan)));
  }
  assert.deepEqual(qualityOptimizationNodeIds(project), expectedNodeIds);
  assert.ok(root.innerHTML.includes(assessment.stale ? "评分已过期" : assessment.passed ? "已通过" : "有待改进"));
  assert.equal(JSON.stringify(project), before, "查看不得改写原报告或剧本");
}
console.log(`${cases.length} quality visibility cases passed`);
