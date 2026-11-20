export function currentRoute() {
  const path = window.location.pathname;
  if (path === "/projects/new") return { page: "new" };
  const match = path.match(/^\/projects\/(project_[A-Za-z0-9]+)$/);
  if (match) {
    const params = new URLSearchParams(window.location.search);
    const stage = params.get("stage");
    const branchDraft = params.get("branch_draft");
    return {
      page: "workspace",
      projectId: match[1],
      stage: ["setup", "story", "publish"].includes(stage) ? stage : null,
      branchDraftId: /^branch_draft_[A-Za-z0-9]+$/.test(branchDraft || "") ? branchDraft : null,
    };
  }
  return { page: "home" };
}

export function navigate(path, { replace = false } = {}) {
  window.history[replace ? "replaceState" : "pushState"]({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function workspaceUrl(projectId, stage, { branchDraftId = null } = {}) {
  const params = new URLSearchParams({ stage });
  if (branchDraftId) params.set("branch_draft", branchDraftId);
  return `/projects/${projectId}?${params.toString()}`;
}
