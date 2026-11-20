export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function humanCondition(condition, metricSchema = {}) {
  const name = metricSchema[condition.metric]?.name || condition.metric || "未选择数值";
  const op = { ">=": "≥", "<=": "≤", ">": ">", "<": "<", "==": "=", "!=": "≠" }[condition.op] || condition.op;
  return `${name} ${op} ${condition.value}`;
}

export function routeCount(story) {
  return (story?.nodes || []).reduce((total, node) => total + (node.route_gates || []).length, 0);
}

export function findRoute(story, routeId) {
  for (const node of story?.nodes || []) {
    const route = (node.route_gates || []).find((item) => item.id === routeId);
    if (route) return { node, route };
  }
  return null;
}

export function valueAtPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}
