import { api } from "./api.js";
import { issueMessage } from "./copy.js";

const root = () => document.querySelector("#dialog-root");

export function closeDialog() {
  root().innerHTML = "";
}

export function confirmDialog({ title, body, confirmLabel, cancelLabel = "取消", danger = false }) {
  return new Promise((resolve) => {
    root().innerHTML = `
      <div class="dialog-backdrop" data-close-dialog>
        <section class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
          <div class="dialog-icon ${danger ? "danger" : "accent"}"><i class="fa-solid ${danger ? "fa-triangle-exclamation" : "fa-wand-magic-sparkles"}"></i></div>
          <h2 id="dialog-title">${title}</h2>
          <div class="dialog-copy">${body}</div>
          <div class="dialog-actions">
            <button class="button ghost" data-dialog-cancel>${cancelLabel}</button>
            <button class="button ${danger ? "danger" : "primary"}" data-dialog-confirm>${confirmLabel}</button>
          </div>
        </section>
      </div>`;
    const finish = (value) => { closeDialog(); resolve(value); };
    root().querySelector("[data-dialog-confirm]").onclick = () => finish(true);
    root().querySelector("[data-dialog-cancel]").onclick = () => finish(false);
    root().querySelector("[data-close-dialog]").onclick = (event) => {
      if (event.target.hasAttribute("data-close-dialog")) finish(false);
    };
  });
}

export function nodeTypeDialog() {
  return new Promise((resolve) => {
    root().innerHTML = `
      <div class="dialog-backdrop" data-close-node-type>
        <section class="dialog-card node-type-dialog" role="dialog" aria-modal="true" aria-labelledby="node-type-title">
          <div class="dialog-heading-row"><div><p class="eyebrow">ADD NODE</p><h2 id="node-type-title">选择节点类型</h2></div><button class="icon-button" type="button" data-node-type-cancel aria-label="关闭"><i class="fa-solid fa-xmark"></i></button></div>
          <p class="dialog-copy">节点类型决定这条路线是继续发展，还是在这里正式结束。</p>
          <div class="node-type-options">
            <button type="button" class="node-type-option" data-node-type="scene"><span class="dialog-icon accent"><i class="fa-solid fa-clapperboard"></i></span><span><strong>幕节点</strong><small>继续发展剧情，必须连接到后续幕或结局。</small></span><i class="fa-solid fa-arrow-right"></i></button>
            <button type="button" class="node-type-option" data-node-type="ending"><span class="dialog-icon ending"><i class="fa-solid fa-flag-checkered"></i></span><span><strong>结局节点</strong><small>终止当前路线，不允许再连接新的出路。</small></span><i class="fa-solid fa-arrow-right"></i></button>
          </div>
        </section>
      </div>`;
    const finish = (value) => { closeDialog(); resolve(value); };
    root().querySelectorAll("[data-node-type]").forEach((button) => button.onclick = () => finish(button.dataset.nodeType));
    root().querySelector("[data-node-type-cancel]").onclick = () => finish(null);
    root().querySelector("[data-close-node-type]").onclick = (event) => {
      if (event.target.hasAttribute("data-close-node-type")) finish(null);
    };
  });
}

export async function modelSettingsDialog() {
  const settings = await api.modelSettings();
  root().innerHTML = `
    <div class="dialog-backdrop">
      <form class="dialog-card form-dialog" id="model-settings-form">
        <div class="dialog-heading-row">
          <div><p class="eyebrow">模型连接</p><h2>模型设置</h2></div>
          <button class="icon-button" type="button" data-close><i class="fa-solid fa-xmark"></i></button>
        </div>
        <label>服务商<select name="provider">${settings.providers.map((item) => `<option value="${item.id}" ${item.id === settings.provider ? "selected" : ""}>${item.label}</option>`).join("")}</select></label>
        <label>模型名称<input name="model" value="${settings.model || ""}"></label>
        <label>API 地址<input name="base_url" value="${settings.base_url || ""}"></label>
        <label>API Key<input name="api_key" type="password" placeholder="${settings.has_api_key ? "已配置，留空保持不变" : "请输入 API Key"}"></label>
        <p class="inline-note"><i class="fa-solid fa-shield-halved"></i> Key 仅保存在当前服务进程，不会回显。</p>
        <p class="form-error" data-error></p>
        <div class="dialog-actions"><button class="button ghost" type="button" data-close>取消</button><button class="button primary" type="submit">保存设置</button></div>
      </form>
    </div>`;
  root().querySelectorAll("[data-close]").forEach((button) => button.onclick = closeDialog);
  root().querySelector("form").onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api.saveModelSettings(Object.fromEntries(form));
      closeDialog();
      toast("模型设置已保存");
    } catch (error) {
      root().querySelector("[data-error]").textContent = issueMessage(error);
    }
  };
}

export function toast(message, tone = "success") {
  const node = document.createElement("div");
  node.className = `toast ${tone}`;
  node.innerHTML = `<i class="fa-solid ${tone === "success" ? "fa-circle-check" : "fa-circle-exclamation"}"></i><span>${message}</span>`;
  document.querySelector("#toast-root").append(node);
  setTimeout(() => node.remove(), 3200);
}
