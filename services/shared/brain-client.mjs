export class BrainClient {
  constructor(options = {}) {
    this.url = (options.url || process.env.BIGFISH_BRAIN_URL || "http://127.0.0.1:15621").replace(/\/$/, "");
    this.token = options.token || process.env.BIGFISH_BRAIN_TOKEN || "";
    this.enabled = options.enabled !== false && Boolean(this.url);
  }

  async request(path, { method = "GET", body } = {}) {
    if (!this.enabled) return null;
    const response = await fetch(`${this.url}${path}`, {
      method,
      headers: {
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`brain HTTP ${response.status}`);
    return response.json();
  }

  context(scope) {
    return this.request(`/v1/context?scope=${encodeURIComponent(scope)}`);
  }

  setSelf(scope, update) {
    return this.request("/v1/self", { method: "PUT", body: { scope, ...update } });
  }

  observe(scope, kind, content, success = true) {
    return this.request("/v1/events", { method: "POST", body: { scope, kind, content, success } });
  }

  fact(scope, text, options = {}) {
    return this.request("/v1/facts", {
      method: "POST",
      body: {
        scope,
        text,
        confidence: options.confidence ?? 0.8,
        importance: options.importance ?? 0.6,
        source: options.source || "runtime_fact",
      },
    });
  }

  replaceFacts(scope, source, facts) {
    return this.request("/v1/facts/replace", {
      method: "POST",
      body: { scope, source, facts },
    });
  }

  action(scope, kind, payload, result, success = true) {
    return this.request("/v1/actions", { method: "POST", body: { scope, kind, payload, result, success } });
  }

  goal(scope, title, detail = "", priority = 3) {
    return this.request("/v1/goals", { method: "POST", body: { scope, title, detail, priority } });
  }

  updateGoal(id, update) {
    return this.request(`/v1/goals/${encodeURIComponent(id)}`, { method: "PATCH", body: update });
  }

  deduplicateGoals(scope) {
    return this.request(`/v1/goals/dedupe?scope=${encodeURIComponent(scope)}`, { method: "POST", body: {} });
  }

  skillContext(scope) {
    return this.request(`/v1/skills?scope=${encodeURIComponent(scope)}`);
  }

  approval(scope, action, reason, payload = {}) {
    return this.request("/v1/approvals", { method: "POST", body: { scope, action, reason, payload } });
  }

  decideApproval(id, approved) {
    return this.request(`/v1/approvals/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { approved },
    });
  }
}
