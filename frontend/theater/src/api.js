const BASE = "/api/theater/numeric-v2";

export class ApiError extends Error {
  constructor(response, payload) {
    super(payload?.error?.code || `http_${response.status}`);
    this.status = response.status;
    this.code = payload?.error?.code || "request_failed";
    this.details = payload?.error?.details || {};
  }
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  const response = await fetch(path, { ...options, headers });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) throw new ApiError(response, payload);
  return payload?.data;
}

export const api = {
  listProjects: () => request(`${BASE}/projects`),
  createProject: () => request(`${BASE}/projects`, { method: "POST" }),
  getProject: (id) => request(`${BASE}/projects/${id}`),
  updateProject: (id, baseRevision, changes) => request(`${BASE}/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ base_revision: baseRevision, changes }),
  }),
  deleteProject: (id, baseRevision) => request(`${BASE}/projects/${id}`, {
    method: "DELETE",
    body: JSON.stringify({ base_revision: baseRevision }),
  }),
  importStory: (story) => request(`${BASE}/projects/import`, {
    method: "POST",
    body: JSON.stringify({ story }),
  }),
  presets: () => request(`${BASE}/metric-presets`),
  allocateId: (id, kind) => request(`${BASE}/projects/${id}/allocate-id`, {
    method: "POST",
    body: JSON.stringify({ kind }),
  }),
  generate: (id, revision) => request(`${BASE}/projects/${id}/generate`, {
    method: "POST",
    body: JSON.stringify({ base_revision: revision }),
  }),
  enhanceNode: (id, nodeId, revision) => request(`${BASE}/projects/${id}/nodes/${nodeId}/enhance`, {
    method: "POST",
    body: JSON.stringify({ base_revision: revision }),
  }),
  assessQuality: (id, revision) => request(`${BASE}/projects/${id}/quality-assessment`, {
    method: "POST",
    body: JSON.stringify({ base_revision: revision }),
  }),
  optimizeQualityNode: (id, nodeId, revision) => request(`${BASE}/projects/${id}/quality-nodes/${nodeId}/optimize`, {
    method: "POST",
    body: JSON.stringify({ base_revision: revision }),
  }),
  branchOptions: (id, nodeId) => request(`${BASE}/projects/${id}/nodes/${nodeId}/branch-options`),
  saveMainlineOrder: (id, revision, nodeIds) => request(`${BASE}/projects/${id}/mainline-order`, {
    method: "PUT",
    body: JSON.stringify({ base_revision: revision, node_ids: nodeIds }),
  }),
  branchDraft: (id, draftId) => request(`${BASE}/projects/${id}/branch-drafts/${draftId}`),
  generateBranchEnding: (id, payload) => request(`${BASE}/projects/${id}/branch-ending-drafts`, {
    method: "POST",
    body: JSON.stringify(payload),
  }),
  generateBranchPath: (id, payload) => request(`${BASE}/projects/${id}/branch-drafts`, {
    method: "POST",
    body: JSON.stringify(payload),
  }),
  applyBranchDraft: (id, draftId, revision) => request(`${BASE}/projects/${id}/branch-drafts/${draftId}/apply`, {
    method: "POST",
    body: JSON.stringify({ base_revision: revision, draft_id: draftId }),
  }),
  compile: (id, revision) => request(`${BASE}/projects/${id}/compile`, {
    method: "POST",
    body: JSON.stringify({ base_revision: revision }),
  }),
  validateNeko: (id, revision) => request(`${BASE}/projects/${id}/validate-neko`, {
    method: "POST",
    body: JSON.stringify({ base_revision: revision }),
  }),
  install: (id, revision) => request(`${BASE}/projects/${id}/install`, {
    method: "POST",
    body: JSON.stringify({ base_revision: revision }),
  }),
  exportUrl: (id) => `${BASE}/projects/${id}/export`,
  modelSettings: () => request("/api/settings/model"),
  saveModelSettings: (settings) => request("/api/settings/model", {
    method: "PUT",
    body: JSON.stringify(settings),
  }),
};
