window.Api = {
  async fetchSessions(projectsPath) {
    const url = `/api/list-sessions?projectsPath=${encodeURIComponent(projectsPath)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error("Failed to fetch sessions");
    }
    return res.json();
  },

  async fetchSession(sessionId, projectsPath, uploadedPath) {
    const query = new URLSearchParams({ projectsPath });
    if (uploadedPath) {
      query.set("uploadedPath", uploadedPath);
    }
    const res = await fetch(`/api/session/${encodeURIComponent(sessionId)}?${query.toString()}`);
    if (!res.ok) {
      throw new Error("Failed to fetch session");
    }
    return res.json();
  },

  async saveComment(nodeId, comment) {
    const res = await fetch("/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId, comment }),
    });
    if (!res.ok) {
      throw new Error("Failed to save comment");
    }
    return res.json();
  },

  async exportBranch(history, targetNodeId) {
    const res = await fetch("/api/export-branch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history, targetNodeId }),
    });
    if (!res.ok) {
      throw new Error("Failed to export branch");
    }
    return res.json();
  },

  async uploadJsonl(file) {
    const bytes = await file.arrayBuffer();
    const res = await fetch("/api/upload-jsonl", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes,
    });
    if (!res.ok) {
      throw new Error("Failed to upload JSONL");
    }
    return res.json();
  },
};
