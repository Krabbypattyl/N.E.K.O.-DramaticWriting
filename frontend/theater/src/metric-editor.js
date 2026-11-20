import { confirmDialog, toast } from "./dialogs.js";
import { escapeHtml } from "./utils.js";

// 新建数值沿用短篇剧场默认范围，避免作者每次都从过大的 0—100 区间开始。
const DEFAULT_METRIC_MIN = 0;
const DEFAULT_METRIC_MAX = 50;
const DEFAULT_METRIC_INITIAL = 20;

function criteriaRows(values, metricIndex, direction) {
  return (values || []).map((value, rowIndex) => `
    <div class="list-row">
      <input value="${escapeHtml(value)}" data-metric-field="${direction}" data-metric-index="${metricIndex}" data-row-index="${rowIndex}" placeholder="写清什么行为会让数值${direction === "increase_criteria" ? "增加" : "减少"}">
      <button class="icon-button subtle" type="button" data-remove-criterion="${direction}" data-metric-index="${metricIndex}" data-row-index="${rowIndex}" aria-label="删除依据"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join("");
}

function bandRows(values, metricIndex) {
  return (values || []).map((band, rowIndex) => `
    <div class="band-row">
      <input type="number" value="${band.min}" data-band-field="min" data-metric-index="${metricIndex}" data-row-index="${rowIndex}" aria-label="区间起点">
      <span>至</span>
      <input type="number" value="${band.max}" data-band-field="max" data-metric-index="${metricIndex}" data-row-index="${rowIndex}" aria-label="区间终点">
      <input value="${escapeHtml(band.label)}" data-band-field="label" data-metric-index="${metricIndex}" data-row-index="${rowIndex}" placeholder="表现标签">
      <button class="icon-button subtle" type="button" data-remove-band data-metric-index="${metricIndex}" data-row-index="${rowIndex}" aria-label="删除区间"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join("");
}

function metricComplete(metric) {
  return Boolean(metric.name && metric.description && metric.increase_criteria?.length && metric.decrease_criteria?.length);
}

export function metricEditorMarkup(metrics, presets) {
  const selectedPresets = new Set(metrics.map((metric) => metric.preset).filter(Boolean));
  const firstIncomplete = metrics.findIndex((metric) => !metricComplete(metric));
  return `
    <section class="overview-panel metric-section">
      <div class="panel-heading metric-panel-heading">
        <div><h2>隐藏数值规则</h2><p>剧场按作者依据调整数值，故事地图只负责使用这些数值设置路线阈值。</p></div>
        <button class="button secondary small" type="button" data-add-custom ${metrics.length >= 4 ? "disabled" : ""}><i class="fa-solid fa-plus"></i>自定义数值</button>
      </div>
      <div class="metric-callout"><i class="fa-solid fa-eye-slash"></i><span>所有数值固定对玩家隐藏</span><strong>${metrics.length}/4</strong></div>
      <details class="preset-picker">
        <summary><span><i class="fa-solid fa-layer-group"></i> 从预设添加</span><small>快速创建后仍可修改名称和依据</small><i class="fa-solid fa-chevron-down"></i></summary>
        <div class="preset-grid">
          ${presets.map((preset) => `<button type="button" class="preset-card ${selectedPresets.has(preset.id) ? "selected" : ""}" data-add-preset="${preset.id}" ${selectedPresets.has(preset.id) || metrics.length >= 4 ? "disabled" : ""}><span class="preset-check"><i class="fa-solid ${selectedPresets.has(preset.id) ? "fa-check" : "fa-plus"}"></i></span><span><strong>${escapeHtml(preset.name)}</strong><small>${escapeHtml(preset.description)}</small></span></button>`).join("")}
        </div>
      </details>
      <div class="metric-stack">
        ${metrics.map((metric, index) => {
          const complete = metricComplete(metric);
          return `<details class="metric-card" ${index === firstIncomplete ? "open" : ""}>
            <summary>
              <span class="metric-icon"><i class="fa-solid ${index % 3 === 0 ? "fa-heart" : index % 3 === 1 ? "fa-face-smile" : "fa-puzzle-piece"}"></i></span>
              <span class="metric-summary"><strong>${escapeHtml(metric.name || "未命名数值")}</strong><small>范围 ${metric.min}—${metric.max} · 初始 ${metric.initial}</small></span>
              <span class="metric-health ${complete ? "ready" : "incomplete"}">${complete ? "完整" : "待补充"}</span>
              <button class="icon-button subtle metric-delete" type="button" data-remove-metric="${index}" aria-label="删除数值"><i class="fa-solid fa-trash-can"></i></button>
              <i class="fa-solid fa-chevron-down disclosure-icon"></i>
            </summary>
            <div class="metric-card-body">
              <div class="form-grid two"><label>数值名称<input value="${escapeHtml(metric.name)}" data-metric-field="name" data-metric-index="${index}"></label><label>数值含义<input value="${escapeHtml(metric.description)}" data-metric-field="description" data-metric-index="${index}" placeholder="这个数值代表什么"></label></div>
              <div class="criteria-grid">
                <div class="criteria-panel increase"><div class="mini-heading"><span><i class="fa-solid fa-arrow-trend-up"></i> 增加依据</span><button type="button" class="text-button" data-add-criterion="increase_criteria" data-metric-index="${index}"><i class="fa-solid fa-plus"></i> 添加</button></div>${criteriaRows(metric.increase_criteria, index, "increase_criteria")}</div>
                <div class="criteria-panel decrease"><div class="mini-heading"><span><i class="fa-solid fa-arrow-trend-down"></i> 减少依据</span><button type="button" class="text-button" data-add-criterion="decrease_criteria" data-metric-index="${index}"><i class="fa-solid fa-plus"></i> 添加</button></div>${criteriaRows(metric.decrease_criteria, index, "decrease_criteria")}</div>
              </div>
              <details class="advanced-settings">
                <summary><i class="fa-solid fa-sliders"></i> 高级数值设置 <span>范围、单回合限幅与区间表现</span><i class="fa-solid fa-chevron-down"></i></summary>
                <div class="form-grid two"><label>关系演绎作用<select data-metric-field="relationship_effect" data-metric-index="${index}"><option value="none" ${(metric.relationship_effect || "none") === "none" ? "selected" : ""}>不影响关系距离</option><option value="positive" ${metric.relationship_effect === "positive" ? "selected" : ""}>数值越高越亲近</option><option value="negative" ${metric.relationship_effect === "negative" ? "selected" : ""}>数值越高越疏远</option></select></label></div>
                <div class="form-grid five numeric-grid">${[["min", "最小值"], ["max", "最大值"], ["initial", "初始值"], ["increase_limit", "最大增加"], ["decrease_limit", "最大减少"]].map(([field, label]) => `<label>${label}<input type="number" value="${metric[field]}" data-metric-field="${field}" data-metric-index="${index}"></label>`).join("")}</div>
                <div class="mini-heading"><span>区间表现 bands</span><button type="button" class="text-button" data-add-band data-metric-index="${index}">添加区间</button></div>
                <div class="band-list">${bandRows(metric.bands, index)}</div>
              </details>
              <span class="inline-note"><i class="fa-solid fa-circle-info"></i> 改名不会改变服务端分配的稳定 ID。</span>
            </div>
          </details>`;
        }).join("") || `<div class="metric-empty"><i class="fa-solid fa-sliders"></i><strong>还没有隐藏数值</strong><p>从预设添加，或创建一个自定义数值并写清增减依据。</p></div>`}
      </div>
    </section>`;
}

export function bindMetricEditor(root, context) {
  const { project, presets, changed, rerender } = context;
  const metrics = project.setup.metrics;
  root.querySelectorAll("[data-add-preset]").forEach((button) => button.onclick = () => {
    const preset = presets.find((item) => item.id === button.dataset.addPreset);
    if (!preset || metrics.length >= 4) return;
    metrics.push(JSON.parse(JSON.stringify(preset)));
    changed(); rerender();
  });
  root.querySelector("[data-add-custom]")?.addEventListener("click", () => {
    if (metrics.length >= 4) return;
    metrics.push({ id: "", preset: null, name: "", description: "", relationship_effect: "none", min: DEFAULT_METRIC_MIN, max: DEFAULT_METRIC_MAX, initial: DEFAULT_METRIC_INITIAL, increase_limit: 5, decrease_limit: 5, increase_criteria: [""], decrease_criteria: [""], visibility: "hidden", bands: [{ min: DEFAULT_METRIC_MIN, max: DEFAULT_METRIC_MAX, label: "当前状态" }] });
    changed(); rerender();
    requestAnimationFrame(() => root.querySelector(`[data-metric-index="${metrics.length - 1}"][data-metric-field="name"]`)?.focus());
  });
  root.querySelectorAll("[data-metric-field]").forEach((input) => input.oninput = () => {
    const metric = metrics[Number(input.dataset.metricIndex)];
    const field = input.dataset.metricField;
    if (["increase_criteria", "decrease_criteria"].includes(field)) metric[field][Number(input.dataset.rowIndex)] = input.value;
    else metric[field] = input.type === "number" ? Number(input.value) : input.value;
    changed();
  });
  root.querySelectorAll("[data-band-field]").forEach((input) => input.oninput = () => {
    const band = metrics[Number(input.dataset.metricIndex)].bands[Number(input.dataset.rowIndex)];
    band[input.dataset.bandField] = input.type === "number" ? Number(input.value) : input.value;
    changed();
  });
  root.querySelectorAll("[data-add-criterion]").forEach((button) => button.onclick = () => {
    metrics[Number(button.dataset.metricIndex)][button.dataset.addCriterion].push(""); changed(); rerender();
  });
  root.querySelectorAll("[data-remove-criterion]").forEach((button) => button.onclick = () => {
    metrics[Number(button.dataset.metricIndex)][button.dataset.removeCriterion].splice(Number(button.dataset.rowIndex), 1); changed(); rerender();
  });
  root.querySelectorAll("[data-add-band]").forEach((button) => button.onclick = () => {
    const metric = metrics[Number(button.dataset.metricIndex)];
    metric.bands.push({ min: metric.max, max: metric.max, label: "" }); changed(); rerender();
  });
  root.querySelectorAll("[data-remove-band]").forEach((button) => button.onclick = () => {
    metrics[Number(button.dataset.metricIndex)].bands.splice(Number(button.dataset.rowIndex), 1); changed(); rerender();
  });
  root.querySelectorAll("[data-remove-metric]").forEach((button) => button.onclick = async (event) => {
    // 删除按钮位于折叠摘要内，阻止点击同时切换卡片开合。
    event.preventDefault();
    event.stopPropagation();
    const index = Number(button.dataset.removeMetric);
    const selectedMetric = metrics[index];
    if (!selectedMetric) return;
    const id = selectedMetric.id;
    const references = (context.project.story?.nodes || []).flatMap((node) => (node.route_gates || []).filter((route) => {
      const rows = route.conditions?.all || route.conditions?.any || [];
      return rows.some((row) => row.metric === id);
    }).map((route) => route.id));
    if (references.length) return toast(`该数值仍被路线 ${references.join("、")} 引用`, "error");
    if (context.project.story && !(await confirmDialog({ title: "删除数值？", body: "剧情已经生成。删除后当前编译结果会失效，但不会自动删除任何路线。", confirmLabel: "删除数值", danger: true }))) return;

    // 确认弹窗期间项目可能完成一次保存；必须回到当前项目数组删除并立即重绘。
    const currentMetrics = context.project.setup.metrics;
    let currentIndex = id ? currentMetrics.findIndex((metric) => metric.id === id) : currentMetrics.indexOf(selectedMetric);
    if (currentIndex < 0 && currentMetrics === metrics && selectedMetric === currentMetrics[index]) currentIndex = index;
    if (currentIndex < 0) return toast("该数值已经不存在", "error");
    currentMetrics.splice(currentIndex, 1);
    context.schedule({ setup: context.project.setup });
    rerender();
  });
}
