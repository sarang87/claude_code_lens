const fs = require("fs");
const path = require("path");
const os = require("os");

const MAX_DIFF_LINES = 800;
const CONTEXT = 3;

const TOOL_LABELS = {
  Bash: "Terminal Command",
  Read: "File Read",
  Write: "File Write",
  Edit: "File Edit",
  Glob: "File Search",
  Grep: "Content Search",
  WebFetch: "Web Fetch",
  WebSearch: "Web Search",
  Agent: "Sub-agent",
  TodoWrite: "Task Update",
  NotebookEdit: "Notebook Edit",
};

function expandHome(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === "~") return os.homedir();
  if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

function safeReadJsonl(filePath) {
  const data = fs.readFileSync(filePath, "utf8");
  const lines = data.split(/\r?\n/);
  const events = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch (_err) {
      // Skip malformed lines by design.
    }
  }
  return events;
}

function truncateText(text, maxChars) {
  const value = String(text || "");
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 1)}…`;
}

function extractContentText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractContentText).filter(Boolean).join("\n");
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.thinking === "string") return value.thinking;
    if (value.content != null) return extractContentText(value.content);
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function decodeProjectPath(encodedName) {
  if (!encodedName) return "";
  if (encodedName.startsWith("-")) return encodedName.replace(/-/g, "/");
  return encodedName;
}

function isUserEvent(event) {
  return event?.type === "user" || event?.message?.role === "user";
}

function isAssistantEvent(event) {
  return event?.type === "assistant" || event?.message?.role === "assistant";
}

function normalizeSessionPreview(events) {
  // Prefer user-set name via /rename (custom-title event, most recent wins)
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev?.type === "custom-title" && typeof ev?.customTitle === "string" && ev.customTitle.trim()) {
      return ev.customTitle.trim();
    }
  }
  // Fall back to first user message text
  for (const event of events) {
    if (!isUserEvent(event)) continue;
    const content = event?.message?.content;
    // String content (seen in newer Claude Code sessions)
    if (typeof content === "string" && content.trim()) return truncateText(content.trim(), 65);
    // Array content
    if (Array.isArray(content)) {
      const textBlock = content.find((b) => b?.type === "text" && typeof b?.text === "string");
      if (textBlock?.text) return truncateText(textBlock.text, 65);
    }
  }
  return "(No user prompt found)";
}

function formatToolResultContent(rawContent) {
  const full = extractContentText(rawContent);
  const lines = full.split(/\r?\n/);
  if (lines.length <= 100) return { full, preview: full, truncated: false };
  const remaining = lines.length - 100;
  return {
    full,
    preview: `${lines.slice(0, 100).join("\n")}\n[... ${remaining} more lines]`,
    truncated: true,
  };
}

function buildToolLabel(toolName, input) {
  if (!input || typeof input !== "object") return toolName;
  if (toolName === "Bash") return `bash: ${truncateText(String(input.command || ""), 120)}`;
  if (toolName === "Read") return `read: ${String(input.file_path || "")}`;
  if (toolName === "Write") return `write: ${String(input.file_path || "")}`;
  if (toolName === "Edit") return `edit: ${String(input.file_path || "")}`;
  if (toolName === "Glob") return `glob: ${String(input.pattern || input.path || "")}`;
  if (toolName === "Grep") return `grep: ${String(input.pattern || "")}`;
  if (toolName === "WebFetch") return `fetch: ${String(input.url || "")}`;
  if (toolName === "WebSearch") return `search: ${String(input.query || "")}`;
  if (toolName === "Agent") return `agent: ${truncateText(String(input.prompt || ""), 60)}`;
  if (toolName === "TodoWrite") return "todo_write";
  if (toolName === "NotebookEdit") return `notebook: ${String(input.notebook_path || input.path || "")}`;
  return toolName;
}

// ─── Diff engine ────────────────────────────────────────────────────────────

function buildLcsMatrix(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }
  return dp;
}

function diffContents(oldContent, newContent) {
  const oldLines = String(oldContent || "").split(/\r?\n/);
  const newLines = String(newContent || "").split(/\r?\n/);

  if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) {
    return {
      linesAdded: Math.max(0, newLines.length - oldLines.length),
      linesRemoved: Math.max(0, oldLines.length - newLines.length),
      diffText: `@@\nFile too large for detailed diff (${oldLines.length} -> ${newLines.length} lines)\n@@`,
    };
  }

  const lcs = buildLcsMatrix(oldLines, newLines);
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: "context", line: oldLines[i] });
      i += 1; j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ type: "remove", line: oldLines[i] });
      i += 1;
    } else {
      ops.push({ type: "add", line: newLines[j] });
      j += 1;
    }
  }
  while (i < oldLines.length) { ops.push({ type: "remove", line: oldLines[i] }); i += 1; }
  while (j < newLines.length) { ops.push({ type: "add", line: newLines[j] }); j += 1; }

  const changedIdx = [];
  let linesAdded = 0;
  let linesRemoved = 0;
  for (let k = 0; k < ops.length; k += 1) {
    if (ops[k].type !== "context") {
      changedIdx.push(k);
      if (ops[k].type === "add") linesAdded += 1;
      else if (ops[k].type === "remove") linesRemoved += 1;
    }
  }

  if (changedIdx.length === 0) return { linesAdded: 0, linesRemoved: 0, diffText: " " };

  const ranges = [];
  let start = changedIdx[0];
  let end = changedIdx[0];
  for (let idx = 1; idx < changedIdx.length; idx += 1) {
    const value = changedIdx[idx];
    if (value <= end + 1) { end = value; }
    else {
      ranges.push([Math.max(0, start - CONTEXT), Math.min(ops.length - 1, end + CONTEXT)]);
      start = value; end = value;
    }
  }
  ranges.push([Math.max(0, start - CONTEXT), Math.min(ops.length - 1, end + CONTEXT)]);

  const mergedRanges = [];
  for (const [rs, re] of ranges) {
    if (!mergedRanges.length || rs > mergedRanges[mergedRanges.length - 1][1] + 1) {
      mergedRanges.push([rs, re]);
    } else {
      mergedRanges[mergedRanges.length - 1][1] = Math.max(mergedRanges[mergedRanges.length - 1][1], re);
    }
  }

  const lines = [];
  mergedRanges.forEach(([rs, re], index) => {
    if (index > 0) lines.push("@@");
    for (let pos = rs; pos <= re; pos += 1) {
      const op = ops[pos];
      const prefix = op.type === "add" ? "+" : op.type === "remove" ? "-" : " ";
      lines.push(`${prefix}${op.line}`);
    }
  });

  return { linesAdded, linesRemoved, diffText: lines.join("\n") };
}

function buildFileChangeFromTool(toolName, toolInput) {
  const filePath = toolInput?.file_path;
  if (!filePath || (toolName !== "Write" && toolName !== "Edit")) return null;

  if (toolName === "Write") {
    const onDiskExists = fs.existsSync(filePath);
    const oldContent = onDiskExists ? fs.readFileSync(filePath, "utf8") : "";
    const newContent = String(toolInput?.content || "");
    const diff = diffContents(oldContent, newContent);
    return {
      name: path.basename(filePath),
      path: filePath,
      isNew: !onDiskExists,
      linesAdded: diff.linesAdded,
      linesRemoved: diff.linesRemoved,
      diffText: diff.diffText,
      kind: !onDiskExists ? "NEW FILE" : "EDITED",
    };
  }

  if (toolName === "Edit") {
    const oldContent = String(toolInput?.old_string || "");
    const newContent = String(toolInput?.new_string || "");
    const diff = diffContents(oldContent, newContent);
    return {
      name: path.basename(filePath),
      path: filePath,
      isNew: false,
      linesAdded: diff.linesAdded,
      linesRemoved: diff.linesRemoved,
      diffText: diff.diffText,
      kind: "EDITED",
    };
  }

  return null;
}

// ─── Exchange-level file attribution ────────────────────────────────────────

function isRealUserPrompt(m) {
  return m.role === "user" && m.hasTextContent && !m.isToolResult;
}

function propagateFilesToLastAiResponse(messages) {
  const exchanges = [];
  let current = [];
  for (const m of messages) {
    if (isRealUserPrompt(m) && current.length > 0) {
      exchanges.push(current);
      current = [];
    }
    current.push(m);
  }
  if (current.length > 0) exchanges.push(current);

  for (const exchange of exchanges) {
    const exchangeFiles = [];
    const seen = new Set();
    for (const m of exchange) {
      for (const f of m.modifiedFiles) {
        if (!seen.has(f.path)) { seen.add(f.path); exchangeFiles.push(f); }
      }
    }
    if (exchangeFiles.length === 0) continue;

    // Find the last assistant turn in this exchange
    let lastAi = null;
    for (let i = exchange.length - 1; i >= 0; i -= 1) {
      if (exchange[i].role === "assistant") { lastAi = exchange[i]; break; }
    }
    if (!lastAi) continue;

    for (const f of exchangeFiles) {
      if (!lastAi.modifiedFiles.some((x) => x.path === f.path)) {
        lastAi.modifiedFiles.push(f);
      }
    }
  }
}

// ─── Main session parser ─────────────────────────────────────────────────────

function parseSessionFile(sessionPath) {
  const events = safeReadJsonl(sessionPath);
  const toolUseOwner = new Map(); // useId → message object

  const firstUser = events.find((e) => isUserEvent(e));
  const cwd = firstUser?.cwd || "";
  const preview = normalizeSessionPreview(events);

  // Forward-propagate model: first model seen on any assistant turn
  let latestModel = "Unknown Model";
  for (const ev of events) {
    const m = ev?.message?.model || ev?.model;
    if (isAssistantEvent(ev) && typeof m === "string" && m.trim()) {
      latestModel = m.trim();
      break;
    }
  }

  const messages = [];
  let currentModel = latestModel;

  for (const event of events) {
    const rawContent = event?.message?.content;

    // Normalize: string content → single text block array
    const blocks = typeof rawContent === "string"
      ? [{ type: "text", text: rawContent }]
      : Array.isArray(rawContent) ? rawContent : null;

    if (!blocks) continue;

    const eventUuid = String(event?.uuid || `msg-${Date.now()}-${Math.random()}`);
    const timestamp = event?.timestamp || null;

    // Forward-propagate model on every assistant turn
    const eventModel = event?.message?.model || event?.model;
    if (typeof eventModel === "string" && eventModel.trim()) {
      currentModel = eventModel.trim();
    }

    if (isUserEvent(event)) {
      const textBlocks = blocks.filter((b) => b?.type === "text" && typeof b?.text === "string");
      const toolResultBlocks = blocks.filter((b) => b?.type === "tool_result");
      const imageBlocks = blocks.filter((b) => b?.type === "image");

      const hasTextContent = textBlocks.length > 0;
      const isToolResult = !hasTextContent && toolResultBlocks.length > 0;

      // Pair tool results with their owning assistant message
      for (const trb of toolResultBlocks) {
        const useId = String(trb.tool_use_id || "");
        const ownerMsg = toolUseOwner.get(useId);
        if (ownerMsg) {
          const tc = ownerMsg.toolCalls.find((t) => t.id === useId);
          if (tc) {
            const fmt = formatToolResultContent(trb.content);
            tc.resultFull = fmt.full;
            tc.resultPreview = fmt.preview;
            tc.resultTruncated = fmt.truncated;
          }
        }
      }

      const images = imageBlocks.map((ib) => {
        if (ib.source?.type === "base64") {
          return { type: "base64", mediaType: ib.source.media_type, data: ib.source.data };
        }
        const p = ib.file_path || ib.path || ib.source?.path;
        if (p) return { type: "path", path: p };
        return null;
      }).filter(Boolean);

      messages.push({
        id: eventUuid,
        timestamp,
        role: "user",
        model: currentModel,
        text: textBlocks.map((b) => b.text).join("\n"),
        thinking: "",
        toolCalls: [],
        images,
        modifiedFiles: [],
        isToolResult,
        hasTextContent,
        cwd: event?.cwd || cwd,
      });

    } else if (isAssistantEvent(event)) {
      const thinkingBlocks = blocks.filter((b) => b?.type === "thinking");
      const textBlocks = blocks.filter((b) => b?.type === "text");
      const toolUseBlocks = blocks.filter((b) => b?.type === "tool_use");

      const thinking = thinkingBlocks.map((b) => String(b.thinking || "")).join("\n\n");
      const text = textBlocks.map((b) => String(b.text || "")).join("\n");

      const toolCalls = [];
      const modifiedFiles = [];

      for (const tub of toolUseBlocks) {
        const toolName = String(tub.name || "Tool");
        const toolInput = tub.input || {};
        const useId = String(tub.id || "");

        const tc = {
          id: useId,
          name: toolName,
          displayName: TOOL_LABELS[toolName] || toolName,
          input: toolInput,
          label: buildToolLabel(toolName, toolInput),
          resultFull: "",
          resultPreview: "",
          resultTruncated: false,
        };
        toolCalls.push(tc);

        const fc = buildFileChangeFromTool(toolName, toolInput);
        if (fc) modifiedFiles.push(fc);
      }

      const rawUsage = event?.message?.usage || {};
      const inputTokens = rawUsage.input_tokens || 0;
      // cache_creation_input_tokens is already the total; the cache_creation sub-object
      // (ephemeral_1h, ephemeral_5m) is just a breakdown of the same number — do NOT add them.
      const cacheCreatedTokens = rawUsage.cache_creation_input_tokens || 0;
      const cacheReadTokens = rawUsage.cache_read_input_tokens || 0;
      const outputTokens = rawUsage.output_tokens || 0;
      const tokenUsage = {
        inputTokens,
        cacheCreatedTokens,
        cacheReadTokens,
        outputTokens,
        totalContextTokens: inputTokens + cacheCreatedTokens + cacheReadTokens,
      };

      const msg = {
        id: eventUuid,
        timestamp,
        role: "assistant",
        model: currentModel,
        text,
        thinking,
        toolCalls,
        images: [],
        modifiedFiles,
        isToolResult: false,
        hasTextContent: textBlocks.length > 0,
        cwd,
        tokenUsage,
      };

      // Register all tool calls for later tool-result pairing
      for (const tc of toolCalls) {
        if (tc.id) toolUseOwner.set(tc.id, msg);
      }

      messages.push(msg);
    }
  }

  // Propagate all file changes to the last AI response in each exchange
  propagateFilesToLastAiResponse(messages);

  // For each user message, attach the context window size from the next assistant
  // message — this is the context Claude actually saw when processing that prompt.
  for (let i = 0; i < messages.length; i += 1) {
    if (messages[i].role !== "user") continue;
    for (let j = i + 1; j < messages.length; j += 1) {
      if (messages[j].role === "assistant" && messages[j].tokenUsage) {
        messages[i].contextAtSend = messages[j].tokenUsage.totalContextTokens;
        break;
      }
    }
  }

  // Build flat fileChanges map (path → fc) for the diff viewer lookup
  const fileChanges = {};
  for (const msg of messages) {
    for (const fc of msg.modifiedFiles) {
      fileChanges[fc.path] = fc;
    }
  }

  return {
    messages,
    fileChanges,
    sessionMeta: {
      id: path.basename(sessionPath, ".jsonl"),
      preview,
      cwd,
      model: latestModel,
      path: sessionPath,
    },
  };
}

// ─── Session listing ─────────────────────────────────────────────────────────

function listSessions(projectsPath) {
  const root = expandHome(projectsPath);
  if (!root || !fs.existsSync(root)) return [];

  const sessions = [];
  const projectDirs = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());

  for (const dir of projectDirs) {
    const projectDirPath = path.join(root, dir.name);
    const files = fs.readdirSync(projectDirPath, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".jsonl"));

    for (const file of files) {
      const filePath = path.join(projectDirPath, file.name);
      const stats = fs.statSync(filePath);
      const events = safeReadJsonl(filePath);
      const preview = normalizeSessionPreview(events);
      const sessionId = path.basename(file.name, ".jsonl");
      sessions.push({
        id: sessionId,
        preview,
        projectPath: decodeProjectPath(dir.name),
        filePath,
        mtimeMs: stats.mtimeMs,
      });
    }
  }

  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return sessions.map(({ id, preview, projectPath }) => ({ id, preview, projectPath }));
}

function findSessionFile(sessionId, projectsPath) {
  const root = expandHome(projectsPath);
  if (!root || !fs.existsSync(root)) return null;

  const projectDirs = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
  for (const dir of projectDirs) {
    const candidate = path.join(root, dir.name, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function parseSession(sessionId, projectsPath, uploadedPath) {
  const filePath = uploadedPath || findSessionFile(sessionId, projectsPath);
  if (!filePath || !fs.existsSync(filePath)) return null;
  return parseSessionFile(filePath);
}

module.exports = {
  listSessions,
  parseSession,
  diffContents,
  TOOL_LABELS,
  MAX_DIFF_LINES,
  CONTEXT,
};
