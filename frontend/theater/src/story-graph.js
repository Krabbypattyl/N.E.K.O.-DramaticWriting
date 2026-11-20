import { api } from "./api.js";
import { openBranchWizard } from "./branch-wizard.js";
import { issueMessage } from "./copy.js";
import { confirmDialog, nodeTypeDialog, toast } from "./dialogs.js";
import { openMainlineOrderDialog } from "./mainline-order.js";
import { bindMetricEditor, metricEditorMarkup } from "./metric-editor.js";
import { escapeHtml, humanCondition, routeCount } from "./utils.js";
import { qualityOptimizationSuggestions, renderInspector } from "./story-inspector.js";

const NODE_WIDTH = 210;
const NODE_CENTER_Y = 65;
const MIN_GRAPH_ZOOM = 0.3;
const MAX_GRAPH_ZOOM = 1.6;
const GRAPH_ZOOM_STEP = 0.1;
const GRAPH_FIT_PADDING = 32;
// 新建普通幕沿用短篇默认预算；作者创建后仍可在右侧属性栏逐幕调整建议收束回合。
const DEFAULT_NODE_TURNS = 3;

function graphViewState(context) {
  context.viewState.storyGraphView ||= { zoom: 1, fitted: true };
  return context.viewState.storyGraphView;
}

function clampGraphZoom(value) {
  return Math.min(MAX_GRAPH_ZOOM, Math.max(MIN_GRAPH_ZOOM, value));
}

function layoutStory(story, savedPositions = {}) {
  const levels = new Map([[story.start_node_id, 0]]);
  const queue = [story.start_node_id];
  while (queue.length) {
    const id = queue.shift();
    const node = story.nodes.find((item) => item.id === id);
    for (const route of node?.route_gates || []) {
      const next = (levels.get(id) || 0) + 1;
      // 作者可能临时画出尚未通过编译的循环；布局只访问一次节点，避免画布在报错前卡死。
      if (!levels.has(route.target_node_id)) {
        levels.set(route.target_node_id, next);
        queue.push(route.target_node_id);
      }
    }
  }
  const maxLevel = Math.max(1, ...levels.values());
  const groups = new Map();
  story.nodes.forEach((node) => {
    const level = node.type === "ending" ? Math.max(levels.get(node.id) ?? maxLevel, maxLevel) : (levels.get(node.id) ?? maxLevel);
    groups.set(level, [...(groups.get(level) || []), node]);
  });
  const positions = new Map();
  for (const [level, nodes] of groups) {
    nodes.forEach((node, index) => positions.set(node.id, { x: 70 + level * 330, y: 90 + index * 220 }));
  }
  story.nodes.forEach((node) => {
    const saved = savedPositions[node.id];
    if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) {
      positions.set(node.id, { x: Math.max(20, saved.x), y: Math.max(20, saved.y) });
    }
  });
  const values = [...positions.values()];
  return {
    positions,
    width: Math.max(980, ...values.map((position) => position.x + NODE_WIDTH + 120)),
    height: Math.max(620, ...values.map((position) => position.y + 210)),
  };
}

function routePath(from, to) {
  return `M ${from.x + NODE_WIDTH} ${from.y + NODE_CENTER_Y} C ${from.x + NODE_WIDTH + 60} ${from.y + NODE_CENTER_Y}, ${to.x - 60} ${to.y + NODE_CENTER_Y}, ${to.x} ${to.y + NODE_CENTER_Y}`;
}

function graphMarkup(project, selection, issues, zoom, qualityHighlightIds) {
  const story = project.story;
  const savedPositions = project.editor?.node_positions || {};
  const { positions, width, height } = layoutStory(story, savedPositions);
  const routes = story.nodes.flatMap((source) => (source.route_gates || []).map((route) => ({ source, route })));
  const selectedSource = selection.kind === "node" ? story.nodes.find((node) => node.id === selection.id && node.type !== "ending") : null;
  return `<div class="graph-toolbar"><div class="graph-toolbar-main"><span class="graph-live"><i class="fa-solid fa-circle"></i> 故事地图</span><b>${story.nodes.length} 节点 · ${routeCount(story)} 路线</b><span class="graph-help">拖动节点 · 从右侧圆点连接路线</span></div><div class="graph-toolbar-actions"><button class="button ghost small" type="button" data-select-overview><i class="fa-solid fa-compass"></i>剧情概览</button><button class="button ghost small" type="button" data-mainline-order title="高级作者工具：确认哪些幕属于主线"><i class="fa-solid fa-list-ol"></i>主线顺序</button><button class="button ghost small" type="button" data-select-metrics><i class="fa-solid fa-sliders"></i>数值规则 <span class="toolbar-count">${Object.keys(story.metric_schema || {}).length}/4</span></button><button class="button secondary small" type="button" data-generate-branch ${selectedSource ? "" : "disabled"} title="${selectedSource ? `从《${escapeHtml(selectedSource.chapter)}》生成支线` : "先选择支线从哪里开始"}"><i class="fa-solid fa-code-branch"></i>生成支线</button><button class="button ghost small" type="button" data-add-node><i class="fa-solid fa-plus"></i>手动添加</button><button class="icon-button graph-issue-button ${issues.length ? "has-issues" : ""}" type="button" data-show-issues title="查看问题"><i class="fa-solid fa-triangle-exclamation"></i><span>${issues.length}</span></button></div></div>
    <div class="graph-map-controls"><div class="graph-zoom-controls" role="group" aria-label="地图缩放"><button class="icon-button" type="button" data-zoom-out title="缩小地图" aria-label="缩小地图"><i class="fa-solid fa-minus"></i></button><button class="graph-zoom-label" type="button" data-zoom-reset data-zoom-label title="恢复到 100%" aria-label="恢复到 100%">${Math.round(zoom * 100)}%</button><button class="icon-button" type="button" data-zoom-in title="放大地图" aria-label="放大地图"><i class="fa-solid fa-plus"></i></button></div><button class="icon-button" type="button" data-fit-graph title="让整张地图适应编辑框" aria-label="让整张地图适应编辑框"><i class="fa-solid fa-expand"></i></button></div>
    <div class="graph-viewport" data-graph-viewport>
      <div class="graph-stage" data-graph-stage data-graph-width="${width}" data-graph-height="${height}" style="width:${width * zoom}px;height:${height * zoom}px">
      <div class="graph-canvas" data-graph-canvas style="width:${width}px;height:${height}px;transform: scale(${zoom})">
        <svg class="graph-lines" width="${width}" height="${height}">${routes.map(({ source, route }) => {
          const from = positions.get(source.id);
          const to = positions.get(route.target_node_id);
          if (!from || !to) return "";
          const path = routePath(from, to);
          const selected = selection.kind === "route" && selection.id === route.id;
          return `<g><path class="route-line ${selected ? "selected" : ""}" d="${path}"/><path class="route-hit" d="${path}" data-select-route="${route.id}" aria-label="编辑路线 ${escapeHtml(route.id)}"/></g>`;
        }).join("")}<path class="connection-preview" data-connection-preview d=""/></svg>
        ${routes.map(({ source, route }) => {
          const from = positions.get(source.id);
          const to = positions.get(route.target_node_id);
          if (!from || !to) return "";
          const mode = route.conditions?.any ? "any" : "all";
          const rows = route.conditions?.[mode] || [];
          const emptyLabel = source.route_gates.length === 1 ? "顺序推进" : "待设置分支条件";
          const semantic = project.authoring?.route_semantics?.[route.id];
          return `<button type="button" class="route-chip ${semantic ? "semantic" : ""} ${selection.kind === "route" && selection.id === route.id ? "selected" : ""}" data-select-route="${route.id}" style="left:${(from.x + to.x) / 2 + 70}px;top:${(from.y + to.y) / 2 + 34}px"><span>${semantic ? "剧情条件" : rows.length ? mode.toUpperCase() : "FLOW"}</span><strong>${semantic ? escapeHtml(semantic.label) : rows.map((row) => humanCondition(row, story.metric_schema)).join(mode === "all" ? " · " : " / ") || emptyLabel}</strong><small>${semantic ? "自动" : `P${route.priority}`}</small></button>`;
        }).join("")}
        ${story.nodes.map((node) => {
          const position = positions.get(node.id);
          const selected = ["node", "ending"].includes(selection.kind) && selection.id === node.id;
          const qualitySuggested = qualityHighlightIds.has(node.id);
          return `<article class="story-node ${node.type} ${selected ? "selected" : ""} ${qualitySuggested ? "quality-suggested" : ""}" data-node-card data-node-id="${node.id}" data-select-node="${node.id}" tabindex="0" role="button" aria-label="${qualitySuggested ? "建议优化，" : ""}编辑节点 ${escapeHtml(node.chapter || node.id)}" style="left:${position.x}px;top:${position.y}px">${qualitySuggested ? `<span class="quality-node-badge"><i class="fa-solid fa-wand-magic-sparkles"></i> 建议优化</span>` : ""}<span class="node-target-handle" aria-hidden="true"></span><span class="node-type"><i class="fa-solid ${node.type === "start" ? "fa-play" : node.type === "ending" ? "fa-flag-checkered" : "fa-clapperboard"}"></i>${node.type === "start" ? "开场" : node.type === "ending" ? "结局" : "幕"}</span><strong>${escapeHtml(node.chapter || "未命名节点")}</strong><p>${escapeHtml(node.story_beat?.summary || "等待填写剧情摘要")}</p><span class="node-footer">${node.route_gates?.length || 0} 条出路 <i class="fa-solid fa-arrow-right"></i></span>${node.type !== "ending" ? `<button type="button" class="node-connect-handle" data-connect-source="${node.id}" aria-label="从 ${escapeHtml(node.chapter || node.id)} 创建路线" title="拖到另一个节点以创建路线"><i class="fa-solid fa-plus"></i></button>` : ""}</article>`;
        }).join("")}
      </div></div>
    </div>`;
}

export function renderStoryDesigner(root, context) {
  const story = context.project.story;
  const issues = context.project.compile_result?.issues || [];
  const graphView = graphViewState(context);
  const assessment = context.project.authoring?.quality_assessment;
  const highlightState = context.viewState.qualityHighlights;
  const qualityHighlightIds = new Set(
    assessment && highlightState && assessment.stale !== true && highlightState.assessmentHash === assessment.content_sha256
      ? highlightState.nodeIds || []
      : [],
  );
  // 全局导航已经承担页面切换，地图内部只保留画布和当前对象属性，避免出现四栏挤压。
  const metricsOpen = context.selection.kind === "metrics";
  root.innerHTML = `<div class="story-designer ${metricsOpen ? "metrics-open" : ""}"><main class="story-graph">${graphMarkup(context.project, context.selection, issues, graphView.zoom, qualityHighlightIds)}</main><aside class="story-inspector ${metricsOpen ? "metric-drawer" : ""}" data-inspector></aside></div>`;
  const select = (selection) => {
    context.selection = selection;
    context.onSelection(selection);
    renderStoryDesigner(root, context);
  };
  root.querySelectorAll("[data-select-node]").forEach((element) => {
    element.onclick = async (event) => {
      if (event.target.closest("[data-connect-source]") || element.dataset.dragged === "true") return;
      const node = story.nodes.find((item) => item.id === element.dataset.selectNode);
      if (qualityHighlightIds.has(node.id)) {
        const suggestions = qualityOptimizationSuggestions(context.project, node.id);
        const suggestionCopy = suggestions
          .map((item, index) => `<p><strong>${index + 1}.</strong> ${escapeHtml(item.suggestion)}</p>`)
          .join("");
        const confirmed = await confirmDialog({
          title: `是否优化《${escapeHtml(node.chapter || node.id)}》？`,
          body: `<p>将结合完整剧情上下文，一次处理该节点的 ${suggestions.length} 条建议，只修改这个节点：</p>${suggestionCopy}`,
          cancelLabel: "否",
          confirmLabel: "是，开始优化",
        });
        context.viewState.qualityHighlights = null;
        context.selection = { kind: node.type === "ending" ? "ending" : "node", id: node.id };
        context.onSelection(context.selection);
        renderStoryDesigner(root, context);
        if (!confirmed) return;
        if (!(await context.flush())) return toast("当前故事还没有保存成功，请稍后重试。", "error");
        toast(`正在根据 ${suggestions.length} 条评分建议优化《${node.chapter || node.id}》`);
        try {
          const current = context.project;
          const result = await api.optimizeQualityNode(current.project_id, node.id, current.revision);
          context.replaceProject(result.project);
          context.selection = { kind: node.type === "ending" ? "ending" : "node", id: node.id };
          context.onSelection(context.selection);
          toast(`《${node.chapter || node.id}》已优化；请检查后重新评分`);
          renderStoryDesigner(root, context);
        } catch (error) {
          toast(issueMessage(error), "error");
        }
        return;
      }
      select({ kind: node.type === "ending" ? "ending" : "node", id: node.id });
    };
    if (element.matches("[data-node-card]")) {
      element.onkeydown = (event) => {
        if (["Enter", " "].includes(event.key)) {
          event.preventDefault();
          element.click();
        }
      };
    }
  });
  root.querySelectorAll("[data-select-route]").forEach((element) => element.onclick = (event) => {
    event.stopPropagation();
    select({ kind: "route", id: element.dataset.selectRoute });
  });
  root.querySelector("[data-select-overview]")?.addEventListener("click", () => select({ kind: "overview" }));
  root.querySelector("[data-mainline-order]")?.addEventListener("click", () => openMainlineOrderDialog(context));
  root.querySelector("[data-select-metrics]")?.addEventListener("click", () => select({ kind: "metrics" }));
  root.querySelector("[data-generate-branch]")?.addEventListener("click", () => {
    const sourceId = context.selection.kind === "node" ? context.selection.id : null;
    if (sourceId) openBranchWizard(context, sourceId, {
      openMetrics: () => select({ kind: "metrics" }),
      manageMainline: () => openMainlineOrderDialog(context, {
        onSaved: () => openBranchWizard(context, sourceId, {
          openMetrics: () => select({ kind: "metrics" }),
        }),
      }),
    });
  });
  root.querySelector("[data-add-node]")?.addEventListener("click", async () => {
    const type = await nodeTypeDialog();
    if (type) await addNode(context, type);
  });
  root.querySelector("[data-show-issues]")?.addEventListener("click", () => context.changeStage("publish"));
  bindGraphZoom(root, context);
  bindNodeDragging(root, context);
  bindRouteConnecting(root, context, select);
  const inspector = root.querySelector("[data-inspector]");
  if (metricsOpen) {
    inspector.innerHTML = metricEditorMarkup(context.project.setup.metrics || [], context.presets);
    bindMetricEditor(inspector, {
      ...context,
      changed: () => context.schedule({ setup: context.project.setup }),
      rerender: () => renderStoryDesigner(root, context),
    });
  } else {
    renderInspector(inspector, { ...context, select, rerender: () => renderStoryDesigner(root, context) });
  }
  requestAnimationFrame(() => {
    if (!root.querySelector("[data-graph-viewport]")) return;
    if (graphView.fitted) fitGraphToViewport(root, context, { behavior: "auto" });
    else setGraphZoom(root, context, graphView.zoom, { behavior: "auto" });
  });
  bindGraphResize(root, context);
}

function bindGraphResize(root, context) {
  if (!window.ResizeObserver) return;
  const state = context.viewState;
  state.storyGraphResizeObserver ||= new ResizeObserver(() => {
    if (state.storyGraphRoot && graphViewState(state.storyGraphContext).fitted) {
      fitGraphToViewport(state.storyGraphRoot, state.storyGraphContext, { behavior: "auto" });
    }
  });
  state.storyGraphResizeObserver.disconnect();
  state.storyGraphRoot = root;
  state.storyGraphContext = context;
  state.storyGraphResizeObserver.observe(root.querySelector("[data-graph-viewport]"));
}

function setGraphZoom(root, context, requestedZoom, { anchorX = null, anchorY = null, behavior = "auto", fitted = false } = {}) {
  const viewport = root.querySelector("[data-graph-viewport]");
  const stage = root.querySelector("[data-graph-stage]");
  const canvas = root.querySelector("[data-graph-canvas]");
  if (!viewport || !stage || !canvas) return;
  const view = graphViewState(context);
  const oldZoom = view.zoom || 1;
  const zoom = Math.round(clampGraphZoom(requestedZoom) * 100) / 100;
  const pointX = anchorX ?? viewport.clientWidth / 2;
  const pointY = anchorY ?? viewport.clientHeight / 2;
  const logicalX = (viewport.scrollLeft + pointX) / oldZoom;
  const logicalY = (viewport.scrollTop + pointY) / oldZoom;
  const width = Number(stage.dataset.graphWidth);
  const height = Number(stage.dataset.graphHeight);

  view.zoom = zoom;
  view.fitted = fitted;
  canvas.style.transform = `scale(${zoom})`;
  stage.style.width = `${width * zoom}px`;
  stage.style.height = `${height * zoom}px`;
  const label = root.querySelector("[data-zoom-label]");
  if (label) label.textContent = `${Math.round(zoom * 100)}%`;
  const zoomOut = root.querySelector("[data-zoom-out]");
  const zoomIn = root.querySelector("[data-zoom-in]");
  if (zoomOut) zoomOut.disabled = zoom <= MIN_GRAPH_ZOOM;
  if (zoomIn) zoomIn.disabled = zoom >= MAX_GRAPH_ZOOM;
  viewport.scrollTo({
    left: Math.max(0, logicalX * zoom - pointX),
    top: Math.max(0, logicalY * zoom - pointY),
    behavior,
  });
}

function fitGraphToViewport(root, context, { behavior = "smooth" } = {}) {
  const viewport = root.querySelector("[data-graph-viewport]");
  const stage = root.querySelector("[data-graph-stage]");
  if (!viewport || !stage) return;
  const width = Number(stage.dataset.graphWidth);
  const height = Number(stage.dataset.graphHeight);
  const availableWidth = Math.max(1, viewport.clientWidth - GRAPH_FIT_PADDING * 2);
  const availableHeight = Math.max(1, viewport.clientHeight - GRAPH_FIT_PADDING * 2);
  const zoom = Math.min(1, availableWidth / width, availableHeight / height);
  setGraphZoom(root, context, zoom, { anchorX: 0, anchorY: 0, behavior, fitted: true });
  viewport.scrollTo({ left: 0, top: 0, behavior });
}

function bindGraphZoom(root, context) {
  const viewport = root.querySelector("[data-graph-viewport]");
  const changeZoom = (delta, event = null) => {
    const rect = viewport.getBoundingClientRect();
    setGraphZoom(root, context, graphViewState(context).zoom + delta, {
      anchorX: event ? event.clientX - rect.left : null,
      anchorY: event ? event.clientY - rect.top : null,
    });
  };
  root.querySelector("[data-zoom-out]").onclick = () => changeZoom(-GRAPH_ZOOM_STEP);
  root.querySelector("[data-zoom-in]").onclick = () => changeZoom(GRAPH_ZOOM_STEP);
  root.querySelector("[data-zoom-reset]").onclick = () => setGraphZoom(root, context, 1);
  root.querySelector("[data-fit-graph]").onclick = () => fitGraphToViewport(root, context);
  viewport.addEventListener("wheel", (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    changeZoom(event.deltaY < 0 ? GRAPH_ZOOM_STEP : -GRAPH_ZOOM_STEP, event);
  }, { passive: false });
  setGraphZoom(root, context, graphViewState(context).zoom, { behavior: "auto", fitted: graphViewState(context).fitted });
}

function bindNodeDragging(root, context) {
  root.querySelectorAll("[data-node-card]").forEach((nodeElement) => {
    nodeElement.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("[data-connect-source]")) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const originX = Number.parseFloat(nodeElement.style.left);
      const originY = Number.parseFloat(nodeElement.style.top);
      const zoom = graphViewState(context).zoom;
      let moved = false;
      nodeElement.setPointerCapture(event.pointerId);
      nodeElement.classList.add("dragging");
      nodeElement.onpointermove = (moveEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;
        if (Math.hypot(deltaX, deltaY) < 4 && !moved) return;
        moved = true;
        nodeElement.style.left = `${Math.max(20, originX + deltaX / zoom)}px`;
        nodeElement.style.top = `${Math.max(20, originY + deltaY / zoom)}px`;
      };
      nodeElement.onpointerup = () => {
        nodeElement.onpointermove = null;
        nodeElement.onpointerup = null;
        nodeElement.onpointercancel = null;
        nodeElement.classList.remove("dragging");
        if (!moved) return;
        nodeElement.dataset.dragged = "true";
        const editor = context.project.editor || { node_positions: {} };
        editor.node_positions ||= {};
        editor.node_positions[nodeElement.dataset.nodeId] = {
          x: Math.round(Number.parseFloat(nodeElement.style.left)),
          y: Math.round(Number.parseFloat(nodeElement.style.top)),
        };
        context.project.editor = editor;
        context.schedule({ editor });
        context.rerender();
      };
      nodeElement.onpointercancel = nodeElement.onpointerup;
    });
  });
}

function bindRouteConnecting(root, context, select) {
  const canvas = root.querySelector("[data-graph-canvas]");
  const preview = root.querySelector("[data-connection-preview]");
  root.querySelectorAll("[data-connect-source]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const sourceId = handle.dataset.connectSource;
      const sourceElement = root.querySelector(`[data-node-card][data-node-id="${sourceId}"]`);
      const ownerWindow = canvas.ownerDocument.defaultView;
      let targetElement = null;
      handle.classList.add("connecting");

      const updatePreview = (moveEvent) => {
        const canvasRect = canvas.getBoundingClientRect();
        const zoom = graphViewState(context).zoom;
        const from = {
          x: Number.parseFloat(sourceElement.style.left),
          y: Number.parseFloat(sourceElement.style.top),
        };
        const to = { x: (moveEvent.clientX - canvasRect.left) / zoom, y: (moveEvent.clientY - canvasRect.top) / zoom };
        preview.setAttribute("d", `M ${from.x + NODE_WIDTH} ${from.y + NODE_CENTER_Y} C ${from.x + NODE_WIDTH + 60} ${from.y + NODE_CENTER_Y}, ${to.x - 60} ${to.y}, ${to.x} ${to.y}`);
        targetElement?.classList.remove("connection-target");
        const hovered = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest("[data-node-card]");
        targetElement = hovered && hovered.dataset.nodeId !== sourceId ? hovered : null;
        targetElement?.classList.add("connection-target");
      };

      const cleanup = () => {
        ownerWindow.removeEventListener("pointermove", updatePreview);
        ownerWindow.removeEventListener("pointerup", finishConnection);
        ownerWindow.removeEventListener("pointercancel", cancelConnection);
        targetElement?.classList.remove("connection-target");
        preview.setAttribute("d", "");
        handle.classList.remove("connecting");
      };
      const finishConnection = async (upEvent) => {
        updatePreview(upEvent);
        const targetId = targetElement?.dataset.nodeId;
        cleanup();
        if (!targetId) return;
        await addRoute(context, sourceId, targetId, select);
      };
      const cancelConnection = () => cleanup();
      ownerWindow.addEventListener("pointermove", updatePreview);
      ownerWindow.addEventListener("pointerup", finishConnection);
      ownerWindow.addEventListener("pointercancel", cancelConnection);
    });
  });
}

async function addRoute(context, sourceId, targetId, select) {
  const story = context.project.story;
  const source = story.nodes.find((node) => node.id === sourceId);
  if (!source || source.type === "ending") return;
  if (source.route_gates.length && !Object.keys(story.metric_schema || {}).length) {
    select({ kind: "metrics" });
    return toast("创建分支前，请先配置至少一个隐藏数值", "error");
  }
  try {
    const { id } = await api.allocateId(context.project.project_id, "route");
    source.route_gates.push({
      id,
      target_node_id: targetId,
      priority: 10,
      conditions: { all: [] },
      transition_contract: { reason: "", bridge_scene_narration: "", source_ids: [source.story_beat?.goals?.at(-1)?.id ? `goal.${source.story_beat.goals.at(-1).id}` : `opening.${source.id}`], must_deliver: [""], must_preserve: [], tone: "" },
    });
    context.schedule({ story });
    select({ kind: "route", id });
  } catch (error) {
    toast(error.message || "创建路线失败", "error");
  }
}

async function addNode(context, type) {
  const story = context.project.story;
  const { id } = await api.allocateId(context.project.project_id, "node");
  const node = { id, type, chapter: type === "ending" ? "新结局节点" : "新幕节点", story_beat: { summary: "", opening_scene: "", goals: [{ id: `${id}_goal_01`, owner: "catgirl", description: "", evidence: { mode: "exact", anchors: [] }, delivery: { type: "catgirl_dialogue", output_field: "performance_dialogue", source_ids: [`opening.${id}`] } }], must_not_happen: [], catgirl_situation: "", transition_goal: "" }, route_gates: [] };
  // 结局不再演绎多轮；普通幕默认使用三回合最短与建议预算，作者可在属性栏按幕调整。
  if (type !== "ending") {
    node.min_turns = DEFAULT_NODE_TURNS;
    node.recommended_turns = DEFAULT_NODE_TURNS;
  }
  if (type === "ending") {
    const endingResult = await api.allocateId(context.project.project_id, "ending");
    node.terminal = true;
    node.ending_id = endingResult.id;
    story.endings.push({ id: endingResult.id, title: "新结局节点", summary: "", terminal: true });
  }
  story.nodes.push(node);
  context.schedule({ story });
  context.selection = { kind: type === "ending" ? "ending" : "node", id };
  context.onSelection(context.selection);
  context.rerender();
}
