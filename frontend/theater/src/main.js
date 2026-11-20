import { api } from "./api.js";
import { currentRoute, navigate, workspaceUrl } from "./router.js";
import { renderProjectHome } from "./project-home.js";
import { renderWorkspace } from "./workspace-shell.js";
import { toast } from "./dialogs.js";
import { issueMessage } from "./copy.js";

const root = document.querySelector("#app");

async function renderApp() {
  const route = currentRoute();
  try {
    if (route.page === "new") {
      root.innerHTML = `<div class="loading-screen"><i class="fa-solid fa-spinner fa-spin"></i><span>正在创建作者项目</span></div>`;
      const project = await api.createProject();
      navigate(workspaceUrl(project.project_id, "setup"), { replace: true });
      return;
    }
    if (route.page === "workspace") {
      root.innerHTML = `<div class="loading-screen"><i class="fa-solid fa-spinner fa-spin"></i><span>正在恢复作者项目</span></div>`;
      const project = await api.getProject(route.projectId);
      await renderWorkspace(root, project, route.stage, { branchDraftId: route.branchDraftId });
      return;
    }
    await renderProjectHome(root);
  } catch (error) {
    root.innerHTML = `<div class="fatal-state"><i class="fa-solid fa-triangle-exclamation"></i><h1>页面没有成功加载</h1><p>${issueMessage(error)}</p><button class="button primary" data-home>返回项目首页</button></div>`;
    root.querySelector("[data-home]").onclick = () => navigate("/");
    toast(issueMessage(error), "error");
  }
}

window.addEventListener("popstate", renderApp);
renderApp();
