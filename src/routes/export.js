const express = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const router = express.Router();

function renderMessageMarkdown(msg) {
  if (!msg || typeof msg !== "object") return "";

  if (msg.role === "user" && !msg.isToolResult) {
    return `### 👤 USER PROMPT\n${msg.text || ""}\n`;
  }

  if (msg.role === "assistant") {
    let md = "";
    if (msg.thinking) {
      md += `*Extended Thinking:*\n\`\`\`\n${msg.thinking}\n\`\`\`\n\n`;
    }
    for (const tc of msg.toolCalls || []) {
      md += `*Tool Execution:*\n> ${tc.label || tc.name}\n\`\`\`\n${tc.resultFull || ""}\n\`\`\`\n\n`;
    }
    if (msg.text) {
      md += `### 🤖 AI OUTPUT\n${msg.text}\n`;
    }
    return md;
  }

  return "";
}

router.post("/export-branch", (req, res) => {
  try {
    const history = Array.isArray(req.body?.history) ? req.body.history : null;
    const targetNodeId = typeof req.body?.targetNodeId === "string" ? req.body.targetNodeId : null;

    if (!history || !targetNodeId) {
      res.status(400).json({ error: "history and targetNodeId are required" });
      return;
    }

    const targetIndex = history.findIndex((item) => item.id === targetNodeId);
    if (targetIndex === -1) {
      res.status(400).json({ error: "targetNodeId does not exist in history" });
      return;
    }

    const slice = history.slice(0, targetIndex + 1);
    const body = slice.map(renderMessageMarkdown).filter(Boolean).join("\n");
    const markdown = `# Claude Code Session Branch
_Generated from Claude Code Lens_

**INSTRUCTIONS FOR AI:** Read the following historical context and continue from the final selected node.

---

${body}
`;

    const token = crypto.randomUUID().slice(0, 6);
    const outPath = path.join(os.homedir(), "Desktop", `claude_branch_${token}.md`);
    fs.writeFileSync(outPath, markdown, "utf8");

    res.json({ success: true, path: outPath });
  } catch (error) {
    res.status(500).json({ error: "Failed to export branch", details: error.message });
  }
});

module.exports = router;
