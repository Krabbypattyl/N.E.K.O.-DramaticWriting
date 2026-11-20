export function createWorkspaceState(project, { onStatus, onConflict, onSaved, onError }) {
  const state = {
    project,
    selection: { kind: "overview" },
    inspectorCollapsed: false,
    saveStatus: "saved",
  };
  let pendingChanges = {};
  let timer = null;
  let saveChain = Promise.resolve(true);

  function mergeSavedProject(savedProject, submittedChanges) {
    const current = state.project;
    const authoredKeys = new Set([...Object.keys(submittedChanges), ...Object.keys(pendingChanges)]);
    const authoredValues = Object.fromEntries([...authoredKeys].map((key) => [key, current[key]]));

    // 保留正在被页面控件引用的作者对象，避免保存返回后第一次点击仍修改旧副本。
    if (authoredKeys.has("setup")) {
      const serverMetrics = savedProject.setup?.metrics || [];
      (current.setup?.metrics || []).forEach((metric, index) => {
        if (!metric.id && serverMetrics[index]?.id) metric.id = serverMetrics[index].id;
      });
    }
    Object.assign(current, savedProject, authoredValues);
    state.project = current;
    return current;
  }

  function notify(status) {
    state.saveStatus = status;
    onStatus?.(status);
  }

  function schedule(changes, { immediate = false } = {}) {
    pendingChanges = { ...pendingChanges, ...changes };
    notify("saving");
    clearTimeout(timer);
    if (immediate) return flush();
    timer = setTimeout(flush, 600);
    return saveChain;
  }

  function flush() {
    clearTimeout(timer);
    if (!Object.keys(pendingChanges).length) return saveChain;
    const changes = pendingChanges;
    pendingChanges = {};
    saveChain = saveChain.then(async () => {
      try {
        const { api } = await import("./api.js");
        const savedProject = await api.updateProject(state.project.project_id, state.project.revision, changes);
        mergeSavedProject(savedProject, changes);
        notify("saved");
        onSaved?.(state.project);
        return true;
      } catch (error) {
        notify("failed");
        if (error.code === "project_revision_conflict") onConflict?.(error.details.project);
        else onError?.(error);
        return false;
      }
    });
    return saveChain;
  }

  function replaceProject(nextProject) {
    state.project = nextProject;
    notify("saved");
    onSaved?.(nextProject);
  }

  return { state, schedule, flush, replaceProject };
}
