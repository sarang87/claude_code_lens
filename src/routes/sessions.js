const express = require("express");
const { PROJECTS_PATH } = require("../config");
const { listSessions, parseSession } = require("../db/claudeDb");
const commentsDb = require("../db/commentsDb");

const router = express.Router();

router.get("/list-sessions", (req, res) => {
  try {
    const projectsPath = req.query.projectsPath || PROJECTS_PATH;
    const sessions = listSessions(projectsPath);
    res.json({ sessions });
  } catch (error) {
    res.status(500).json({ error: "Failed to list sessions", details: error.message });
  }
});

router.get("/session/:id", (req, res) => {
  try {
    const projectsPath = req.query.projectsPath || PROJECTS_PATH;
    const uploadedPath = req.query.uploadedPath ? String(req.query.uploadedPath) : undefined;
    const data = parseSession(req.params.id, projectsPath, uploadedPath);

    if (!data) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // Only load comments for real message IDs (non-tool-result user-facing nodes)
    const nodeIds = data.messages
      .filter((m) => !m.isToolResult)
      .map((m) => m.id);
    const comments = commentsDb.getAll(nodeIds);

    res.json({
      messages: data.messages,
      comments,
      fileChanges: data.fileChanges,
      sessionMeta: data.sessionMeta,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to load session", details: error.message });
  }
});

module.exports = router;
