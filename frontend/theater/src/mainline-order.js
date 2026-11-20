import { api } from "./api.js";
import { issueMessage } from "./copy.js";
import { closeDialog, toast } from "./dialogs.js";
import { escapeHtml } from "./utils.js";

const dialogRoot = () => document.querySelector("#dialog-root");

export async function openMainlineOrderDialog(context, { onSaved } = {}) {
  const previousFocus = document.activeElement;
  await context.flush();
  const story = context.project.story;
  const nodes = new Map((story?.nodes || []).map((node) => [node.id, node]));
  const start = nodes.get(story?.start_node_id);
  if (!start || start.type === "ending") {
    toast(issueMessage({ code: "mainline_order_invalid" }), "error");
    return;
  }

  const state = {
    order: [start.id],
    choices: [],
    endingTitles: [],
    complete: false,
    loading: false,
    error: "",
  };

  const close = (restoreFocus = true) => {
    document.removeEventListener("keydown", onKeydown);
    closeDialog();
    if (restoreFocus) previousFocus?.focus?.();
  };
  const onKeydown = (event) => {
    if (event.key === "Escape" && !state.loading) close();
  };
  document.addEventListener("keydown", onKeydown);

  function inspectNext() {
    state.choices = [];
    state.endingTitles = [];
    state.complete = false;
    state.error = "";
    for (let guard = 0; guard <= nodes.size; guard += 1) {
      const current = nodes.get(state.order.at(-1));
      const rawTargets = (current?.route_gates || []).map((route) => nodes.get(route.target_node_id)).filter(Boolean);
      const targetIds = rawTargets.map((node) => node.id);
      if (new Set(targetIds).size !== targetIds.length) {
        state.error = "同一对节点之间存在重复路线，请先在故事地图中处理重复路线。";
        return;
      }
      const endings = rawTargets.filter((node) => node.type === "ending");
      const nextScenes = rawTargets.filter((node) => node.type !== "ending");
      if (!nextScenes.length && endings.length) {
        state.complete = true;
        state.endingTitles = endings.map((node) => node.chapter || node.id);
        return;
      }
      if (!nextScenes.length && !endings.length) {
        state.error = `《${current?.chapter || current?.id || "当前幕"}》没有通往后续幕或结局的路线。`;
        return;
      }
      if (nextScenes.length === 1 && !endings.length) {
        const next = nextScenes[0];
        if (state.order.includes(next.id)) {
          state.error = "主线路径形成了循环，请先在故事地图中调整路线。";
          return;
        }
        state.order.push(next.id);
        continue;
      }
      state.choices = nextScenes.map((node) => ({ kind: "node", node }));
      if (endings.length) state.choices.push({ kind: "finish", endings });
      return;
    }
    state.error = "主线路径形成了循环，请先在故事地图中调整路线。";
  }

  function render() {
    const current = nodes.get(state.order.at(-1));
    dialogRoot().innerHTML = `<div class="dialog-backdrop" data-mainline-backdrop>
      <section class="dialog-card mainline-order-dialog" role="dialog" aria-modal="true" aria-labelledby="mainline-order-title">
        <div class="dialog-heading-row"><div><p class="eyebrow">MAINLINE ORDER</p><h2 id="mainline-order-title">确认主线顺序</h2></div><button class="icon-button" type="button" data-mainline-close aria-label="关闭主线顺序向导" ${state.loading ? "disabled" : ""}><i class="fa-solid fa-xmark"></i></button></div>
        <p class="dialog-copy">系统会沿现有路线自动前进，只在分叉处询问哪一幕仍属于主线；不会重接路线，也不会调用模型。</p>
        <div class="mainline-path" aria-label="当前主线顺序">${state.order.map((nodeId, index) => `<span><b>${index + 1}</b>${escapeHtml(nodes.get(nodeId)?.chapter || nodeId)}</span>`).join(`<i class="fa-solid fa-arrow-right"></i>`)}</div>
        <div class="mainline-order-live" aria-live="polite">${state.loading ? "正在保存主线顺序" : state.error ? escapeHtml(state.error) : ""}</div>
        ${state.complete ? `<div class="mainline-complete"><i class="fa-solid fa-circle-check"></i><div><strong>主线顺序已经完整</strong><p>最后从《${escapeHtml(current.chapter || current.id)}》进入${state.endingTitles.length > 1 ? "结局分叉" : `《${escapeHtml(state.endingTitles[0])}》`}。</p></div></div>` : ""}
        ${state.choices.length ? `<fieldset class="mainline-next"><legend>《${escapeHtml(current.chapter || current.id)}》之后，哪一幕仍属于主线？</legend><div role="radiogroup" aria-label="下一主线幕">${state.choices.map((choice) => choice.kind === "finish"
          ? `<button type="button" role="radio" aria-checked="false" data-mainline-finish><span><i class="fa-solid fa-flag-checkered"></i></span><div><strong>在这里进入结局</strong><p>${choice.endings.map((node) => escapeHtml(node.chapter || node.id)).join("、")}</p></div><i class="fa-solid fa-arrow-right"></i></button>`
          : `<button type="button" role="radio" aria-checked="false" data-mainline-next="${choice.node.id}" ${state.order.includes(choice.node.id) ? "disabled" : ""}><span><i class="fa-solid fa-clapperboard"></i></span><div><strong>${escapeHtml(choice.node.chapter || choice.node.id)}</strong><p>${escapeHtml(choice.node.story_beat?.summary || "继续沿这条路线推进")}</p></div><i class="fa-solid fa-arrow-right"></i></button>`).join("")}</div></fieldset>` : ""}
        <div class="dialog-actions mainline-order-actions"><button class="button ghost" type="button" data-mainline-reset ${state.loading ? "disabled" : ""}>重新开始</button><button class="button primary" type="button" data-mainline-save ${state.complete && !state.loading ? "" : "disabled"}><i class="fa-solid ${state.loading ? "fa-spinner fa-spin" : "fa-check"}"></i>${state.loading ? "正在保存" : "确认主线顺序"}</button></div>
      </section>
    </div>`;
    bind();
  }

  function bind() {
    const root = dialogRoot();
    root.querySelector("[data-mainline-close]")?.addEventListener("click", () => { if (!state.loading) close(); });
    root.querySelector("[data-mainline-backdrop]")?.addEventListener("click", (event) => { if (event.target.hasAttribute("data-mainline-backdrop") && !state.loading) close(); });
    root.querySelectorAll("[data-mainline-next]").forEach((button) => button.onclick = () => {
      state.order.push(button.dataset.mainlineNext);
      inspectNext();
      render();
    });
    root.querySelector("[data-mainline-finish]")?.addEventListener("click", () => {
      const current = nodes.get(state.order.at(-1));
      state.complete = true;
      state.choices = [];
      state.endingTitles = (current.route_gates || []).map((route) => nodes.get(route.target_node_id)).filter((node) => node?.type === "ending").map((node) => node.chapter || node.id);
      render();
    });
    root.querySelector("[data-mainline-reset]")?.addEventListener("click", () => {
      state.order = [start.id];
      inspectNext();
      render();
    });
    root.querySelector("[data-mainline-save]")?.addEventListener("click", save);
  }

  async function save() {
    if (!state.complete || state.loading) return;
    state.loading = true;
    state.error = "";
    render();
    try {
      const project = await api.saveMainlineOrder(context.project.project_id, context.project.revision, state.order);
      close(false);
      context.replaceProject(project);
      context.rerender();
      toast("主线顺序已经确认");
      onSaved?.();
    } catch (error) {
      state.loading = false;
      state.error = issueMessage(error);
      render();
    }
  }

  inspectNext();
  render();
}
