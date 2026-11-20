import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderInspector } from "../../frontend/theater/src/story-inspector.js";

// 只适配路线编辑器使用的 DOM 接口；运行真实渲染与事件，不复制业务实现。
function control(dataset = {}, type = "text") {
  return { dataset, type, value: "", addEventListener(event, listener) { this[`on${event}`] = listener; } };
}

const targetControl = control({ routeField: "target_node_id" }, "select-one");
const reasonControl = control({ transitionField: "reason" });
const bridgeControl = control({ transitionField: "bridge_scene_narration" });
const editTarget = control();
const root = {
  innerHTML: "",
  querySelectorAll(selector) {
    if (selector === "[data-route-field]") return [targetControl];
    if (selector === "[data-transition-field]") return [reasonControl, bridgeControl];
    return [];
  },
  querySelector(selector) {
    if (selector === "[data-edit-transition-target]") return editTarget;
    if (["[data-add-condition]", "[data-delete-route]"].includes(selector)) return control();
    return null;
  },
};

const route = {
  id: "route",
  target_node_id: "target",
  priority: 10,
  conditions: { all: [] },
  transition_contract: { reason: "邀请原文", bridge_scene_narration: "桥段原文", source_ids: [], must_deliver: [], must_preserve: [] },
};
const target = { id: "target", chapter: "目标幕", type: "scene", story_beat: {} };
const ending = { id: "ending", chapter: "结局", type: "ending", story_beat: { opening_scene: "结局开场。仍完整。" } };
const project = {
  story: { nodes: [{ id: "source", chapter: "来源幕", route_gates: [route] }, target, ending], metric_schema: {}, endings: [] },
  compile_result: { success: true, warnings: [], package_hash: "unchanged-hash" },
};
const scheduled = [];
const selected = [];
let rendered = 0;
globalThis.fetch = () => { throw new Error("联合审阅不允许调用 API"); };
const context = {
  project,
  selection: { kind: "route", id: route.id },
  schedule(changes) { scheduled.push(structuredClone(changes)); },
  select(selection) { selected.push(selection); },
  rerender() { rendered += 1; renderInspector(root, context); },
};

function openingText() {
  const match = root.innerHTML.match(/<textarea[^>]*data-target-opening[^>]*>([\s\S]*?)<\/textarea>/u);
  assert.ok(match, "必须渲染目标开场");
  return match[1].replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#039;", "'").replaceAll("&amp;", "&");
}

const { beats, expected } = JSON.parse(readFileSync(0, "utf8"));
for (const [index, beat] of beats.entries()) {
  target.story_beat = beat;
  const before = JSON.stringify(project);
  renderInspector(root, context);
  assert.equal(openingText(), expected[index], `N.E.K.O 开场回退不一致：${index}`);
  assert.equal(JSON.stringify(project), before, "只读审阅不得修改项目");
}
assert.equal(scheduled.length, 0);
assert.match(root.innerHTML, /没有可展示的开场/u);
assert.match(root.innerHTML, /data-target-opening readonly/u);
assert.match(root.innerHTML, /不作通过或失败判定/u);
assert.ok(root.innerHTML.indexOf('data-transition-field="reason"') < root.innerHTML.indexOf('data-transition-field="bridge_scene_narration"'));
assert.ok(root.innerHTML.indexOf('data-transition-field="bridge_scene_narration"') < root.innerHTML.indexOf("data-target-opening"));

// 原文中的 HTML 必须只作为文本展示，不能成为节点或属性。
target.story_beat = { opening_scene: '</textarea><script>danger("&")</script>' };
route.transition_contract.reason = "<em>邀请</em>";
route.transition_contract.bridge_scene_narration = "<b>桥段</b>";
renderInspector(root, context);
assert.equal(openingText(), target.story_beat.opening_scene);
assert.ok(!root.innerHTML.includes("<script>"));
assert.ok(root.innerHTML.includes("&lt;em&gt;邀请&lt;/em&gt;"));
assert.ok(root.innerHTML.includes("&lt;b&gt;桥段&lt;/b&gt;"));

// 输入先落在现有草稿，再换目标重绘；不丢未保存的原因和桥段。
reasonControl.value = "已编辑原因";
reasonControl.oninput();
bridgeControl.value = "已编辑桥段";
bridgeControl.oninput();
targetControl.value = ending.id;
targetControl.oninput();
assert.equal(rendered, 1);
assert.equal(route.target_node_id, ending.id);
assert.equal(openingText(), ending.story_beat.opening_scene);
assert.ok(root.innerHTML.includes("已编辑原因"));
assert.ok(root.innerHTML.includes("已编辑桥段"));
assert.equal(scheduled.length, 3);
assert.deepEqual(scheduled.at(-1), { story: project.story });
const afterEdits = JSON.stringify(project);
editTarget.onclick();
assert.deepEqual(selected.at(-1), { kind: "ending", id: ending.id });
assert.equal(JSON.stringify(project), afterEdits);
assert.equal(scheduled.length, 3);

targetControl.value = target.id;
targetControl.oninput();
editTarget.onclick();
assert.deepEqual(selected.at(-1), { kind: "node", id: target.id });

// 缺失目标必须明确显示，且不能把任意现有节点当成已选目标。
route.target_node_id = "missing";
renderInspector(root, context);
assert.equal(openingText(), "");
assert.match(root.innerHTML, /目标节点不存在，请先重新选择目标/u);
assert.match(root.innerHTML, /<option value="missing" selected>目标节点不存在/u);
assert.match(root.innerHTML, /data-edit-transition-target disabled/u);
const selectedCount = selected.length;
editTarget.onclick();
assert.equal(selected.length, selectedCount);
assert.deepEqual(project.compile_result, { success: true, warnings: [], package_hash: "unchanged-hash" });
console.log("转场联合审阅：开场兼容、原文转义、草稿保留、目标切换与只读跳转通过");
