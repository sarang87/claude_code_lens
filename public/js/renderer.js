function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTimestamp(ts) {
  if (!ts) return "Unknown";
  const dt = new Date(ts);
  if (Number.isNaN(dt.getTime())) return "Unknown";
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

function renderTimeline() {
  const timeline = document.getElementById("timeline-container");
  timeline.innerHTML = "";

  for (const group of State.groupedNodes) {
    const card = document.createElement("div");
    card.dataset.nodeId = group.id;

    let typeClass, title, snippet;

    if (group.isSegmentDivider) {
      typeClass = "type-divider";
      const n = group.totalSteps;
      title = `▶ ${n} Intermediate Step${n !== 1 ? "s" : ""}`;

      let toolCount = 0;
      let aiCount = 0;
      for (const sg of group.subGroups) {
        if (sg.isAgentGroup) toolCount += sg.items.length;
        else aiCount += sg.items.length;
      }
      const parts = [];
      if (toolCount > 0) parts.push(`${toolCount} tool call${toolCount > 1 ? "s" : ""}`);
      if (aiCount > 0) parts.push(`${aiCount} AI output${aiCount > 1 ? "s" : ""}`);
      snippet = parts.join(" · ");
    } else {
      const msg = group.items[0];
      if (msg.role === "user") {
        typeClass = "type-user";
        title = "USER PROMPT";
      } else {
        typeClass = "type-ai";
        title = "AI RESPONSE";
      }
      snippet = (msg.text || "").split("\n").slice(0, 6).join("\n");
    }

    card.className = `node-card ${typeClass}`;
    if (group.id === State.selectedNodeId) card.classList.add("selected");

    const hasNote = !!State.comments[group.id];
    card.innerHTML = `
      <div class="node-title">${escapeHtml(title)}</div>
      <div class="node-snippet">${escapeHtml(snippet)}</div>
      <button class="note-btn${hasNote ? " has-note" : ""}" data-note-node="${escapeHtml(group.id)}">${hasNote ? "📝" : "➕"}</button>
    `;

    card.addEventListener("click", () => selectGroup(group.id));
    card.querySelector(".note-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      if (window.AppHandlers && typeof window.AppHandlers.openCommentModal === "function") {
        window.AppHandlers.openCommentModal(group.id);
      }
    });

    timeline.appendChild(card);
  }

  applyFilter();
}

function applyFilter() {
  const selected = document.getElementById("nodeFilter").value;
  document.querySelectorAll(".node-card").forEach((card) => {
    if (selected === "all") {
      card.style.display = "";
      return;
    }
    // Dividers are only visible in "Show All"
    if (card.classList.contains("type-divider")) {
      card.style.display = "none";
      return;
    }
    if (selected === "user" && !card.classList.contains("type-user")) card.style.display = "none";
    else if (selected === "ai" && !card.classList.contains("type-ai")) card.style.display = "none";
    else card.style.display = "";
  });
}

// ─── Inspector ────────────────────────────────────────────────────────────────

function selectGroup(nodeId) {
  State.selectedNodeId = nodeId;
  document.querySelectorAll(".node-card").forEach((card) => {
    card.classList.toggle("selected", card.dataset.nodeId === nodeId);
  });

  const group = State.groupedNodes.find((g) => g.id === nodeId);
  if (!group) return;

  renderMetadata(group);
  renderReasoning(group);
  renderArtifacts(group);
}

const CONTEXT_WINDOW_SIZE = 200000;

function fmtTokens(n) {
  if (!n) return "0";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function renderContextBar(totalContextTokens) {
  const pct = Math.min(100, (totalContextTokens / CONTEXT_WINDOW_SIZE) * 100);
  const color = pct > 80 ? "#f87171" : pct > 50 ? "#fbbf24" : "#34d399";
  return `
    <div class="token-section">
      <div class="token-section-title">CONTEXT WINDOW</div>
      <div class="ctx-bar-track">
        <div class="ctx-bar-fill" style="width:${pct.toFixed(1)}%;background:${color};"></div>
      </div>
      <div class="ctx-bar-label">
        <span style="color:${color};font-weight:700">${fmtTokens(totalContextTokens)}</span>
        <span style="color:#475569"> / ${fmtTokens(CONTEXT_WINDOW_SIZE)} tokens (${pct.toFixed(1)}%)</span>
      </div>
    </div>
  `;
}

function renderTokenBlock(usage) {
  if (!usage) return "";
  const { inputTokens, cacheCreatedTokens, cacheReadTokens, outputTokens, totalContextTokens } = usage;
  return `
    <div class="token-section">
      <div class="token-section-title">TOKEN USAGE</div>
      <div class="token-grid">
        <div class="token-cell">
          <div class="token-val" style="color:#60a5fa">${fmtTokens(outputTokens)}</div>
          <div class="token-key">Output</div>
        </div>
        <div class="token-cell">
          <div class="token-val" style="color:#f8fafc">${fmtTokens(inputTokens)}</div>
          <div class="token-key">Input (new)</div>
        </div>
        <div class="token-cell">
          <div class="token-val" style="color:#34d399">${fmtTokens(cacheReadTokens)}</div>
          <div class="token-key">Cache read</div>
        </div>
        <div class="token-cell">
          <div class="token-val" style="color:#e879f9">${fmtTokens(cacheCreatedTokens)}</div>
          <div class="token-key">Cache write</div>
        </div>
      </div>
    </div>
    ${renderContextBar(totalContextTokens)}
  `;
}

function renderMetadata(group) {
  const panel = document.getElementById("metadataPanel");

  if (group.isSegmentDivider) {
    // Aggregate token usage across all intermediate messages
    let totalOutput = 0;
    let peakContext = 0;
    for (const msg of group.items) {
      if (msg.tokenUsage) {
        totalOutput += msg.tokenUsage.outputTokens;
        peakContext = Math.max(peakContext, msg.tokenUsage.totalContextTokens);
      }
    }
    const aggUsage = peakContext > 0
      ? { outputTokens: totalOutput, inputTokens: 0, cacheCreatedTokens: 0, cacheReadTokens: 0, totalContextTokens: peakContext }
      : null;

    panel.innerHTML = `
      <div class="metadata-row"><span class="label">TYPE:</span> <span class="value" style="color:#f59e0b;font-weight:700">SEGMENT DIVIDER</span></div>
      <div class="metadata-row"><span class="label">STEPS:</span> <span class="value">${group.totalSteps}</span></div>
      <div class="metadata-row"><span class="label">GROUPS:</span> <span class="value">${group.subGroups.length}</span></div>
      <div class="metadata-row"><span class="label">CWD:</span> <span class="value" style="color:#64748b">${escapeHtml(State.sessionMeta.cwd || "")}</span></div>
      ${aggUsage ? `
        <div class="metadata-row" style="margin-top:4px"><span class="label">OUTPUT TOKENS:</span> <span class="value" style="color:#60a5fa;font-weight:700">${fmtTokens(aggUsage.outputTokens)}</span></div>
        ${renderContextBar(aggUsage.totalContextTokens)}
      ` : ""}
    `;
    return;
  }

  const msg = group.items[0];
  const isUser = msg.role === "user";
  const nodeTypeLabel = isUser ? "User Prompt" : "AI Response";
  const nodeTypeColor = isUser ? "#22d3ee" : "#60a5fa";
  const toolNames = (!isUser && msg.toolCalls && msg.toolCalls.length > 0)
    ? msg.toolCalls.map((t) => t.name).join(", ")
    : null;

  panel.innerHTML = `
    <div class="metadata-row"><span class="label">ID:</span> <span class="value">${escapeHtml(msg.id)}</span></div>
    <div class="metadata-row"><span class="label">SYS_TIME:</span> <span class="value">${escapeHtml(formatTimestamp(msg.timestamp))}</span></div>
    <div class="metadata-row"><span class="label">MODEL:</span> <span class="value" style="color:#38bdf8;font-weight:700">${escapeHtml(msg.model || "Unknown Model")}</span></div>
    <div class="metadata-row"><span class="label">NODE TYPE:</span> <span class="value" style="color:${nodeTypeColor};font-weight:700;text-transform:uppercase">${escapeHtml(nodeTypeLabel)}</span></div>
    ${toolNames ? `<div class="metadata-row"><span class="label">TOOL NAME:</span> <span class="value" style="color:#fb923c">${escapeHtml(toolNames)}</span></div>` : ""}
    <div class="metadata-row"><span class="label">CWD:</span> <span class="value" style="color:#64748b">${escapeHtml(msg.cwd || State.sessionMeta.cwd || "")}</span></div>
    ${!isUser ? renderTokenBlock(msg.tokenUsage) : ""}
    ${isUser && msg.contextAtSend ? `
      <div class="token-section">
        <div class="token-section-title">CONTEXT WINDOW AT SEND</div>
        <div style="font-family:ui-monospace,monospace;font-size:11px;color:#94a3b8;margin-bottom:8px;">
          Context Claude saw when this prompt was processed
        </div>
        ${renderContextBar(msg.contextAtSend)}
      </div>
    ` : ""}
  `;
}

function renderReasoning(group) {
  const titleEl = document.getElementById("reasoningTitle");
  const panel = document.getElementById("reasoningPanel");

  // ── Segment Divider ──
  if (group.isSegmentDivider) {
    titleEl.textContent = `▶ INTERMEDIATE STEPS (${group.totalSteps})`;
    titleEl.style.color = "#f59e0b";

    let html = "";
    group.subGroups.forEach((sg, sgIndex) => {
      const subLabel = sg.isAgentGroup
        ? `Tool Executions (${sg.items.length} tool${sg.items.length > 1 ? "s" : ""})`
        : "AI Response";

      html += `<div class="sub-step-block">`;
      html += `<h4 class="sub-step-header">Step ${sgIndex + 1} — ${subLabel}</h4>`;

      for (const msg of sg.items) {
        if (msg.thinking) {
          html += `<details class="reasoning-block">
            <summary>🧠 Reasoning Trace</summary>
            <div class="reasoning-content">${escapeHtml(msg.thinking)}</div>
          </details>`;
        }
        for (const tc of msg.toolCalls) {
          html += `<div class="tool-mini">
            <div class="tool-mini-name">🛠️ ${escapeHtml(tc.name)}</div>
            <pre class="tool-mini-cmd">&gt; ${escapeHtml(tc.label)}</pre>
            ${tc.resultPreview ? `<pre class="tool-mini-out">${escapeHtml(tc.resultPreview)}</pre>` : ""}
          </div>`;
        }
        if (msg.text && !sg.isAgentGroup) {
          html += `<div class="sub-step-text">${escapeHtml(msg.text).substring(0, 500)}${msg.text.length > 500 ? "\n…" : ""}</div>`;
        }
      }
      html += `</div>`;
    });

    panel.innerHTML = html;
    return;
  }

  const msg = group.items[0];

  // ── User Prompt ──
  if (msg.role === "user") {
    titleEl.textContent = "👤 USER PROMPT";
    titleEl.style.color = "#22d3ee";
    panel.innerHTML = `
      <div class="row-between" style="margin-bottom:14px;">
        <div></div>
        <button class="branch-btn" id="branchFromHere">🌿 Branch from Here</button>
      </div>
      <div class="mono">${escapeHtml(msg.text || "").replace(/\n/g, "<br>")}</div>
    `;
    document.getElementById("branchFromHere").addEventListener("click", () => {
      if (window.AppHandlers && typeof window.AppHandlers.branchFromNode === "function") {
        window.AppHandlers.branchFromNode(group.id);
      }
    });
    return;
  }

  // ── AI Response ──
  titleEl.textContent = "🧠 REASONING & ACTIONS";
  titleEl.style.color = "#60a5fa";

  let html = "";

  if (msg.thinking) {
    html += `<details class="reasoning-block">
      <summary>🧠 View Extended Thinking</summary>
      <div class="reasoning-content">${escapeHtml(msg.thinking).replace(/\n/g, "<br>")}</div>
    </details>`;
  }

  msg.toolCalls.forEach((tc, i) => {
    const actionLabel = msg.toolCalls.length > 1
      ? `ACTION ${i + 1} — ${escapeHtml(tc.displayName)}`
      : escapeHtml(tc.displayName);
    html += `<div class="tool-execution">
      <div><strong>🛠️ ${actionLabel}</strong></div>
      <pre>&gt; ${escapeHtml(tc.label)}</pre>
      <div class="tool-output-label">Console Output:</div>
      <pre class="tool-output">${escapeHtml(tc.resultPreview || "(no output)")}</pre>
    </div>`;
  });

  if (msg.text) {
    html += `<div class="mono ai-text-body">${escapeHtml(msg.text).replace(/\n/g, "<br>")}</div>`;
  }

  panel.innerHTML = html;
}

function renderArtifacts(group) {
  const titleEl = document.getElementById("artifactsTitle");
  const panel = document.getElementById("artifactsPanel");

  // ── Segment Divider ──
  if (group.isSegmentDivider) {
    titleEl.textContent = "📦 ARTIFACTS & DIFFS";
    titleEl.style.color = "#cbd5e1";
    panel.innerHTML = '<div class="empty-state">Select a specific node from the timeline to view its artifacts.</div>';
    return;
  }

  const msg = group.items[0];

  // ── User Prompt ──
  if (msg.role === "user") {
    titleEl.textContent = "📎 UPLOADED IMAGES & CONTEXT";
    titleEl.style.color = "#a78bfa";
    if (!msg.images || msg.images.length === 0) {
      panel.innerHTML = '<div class="empty-state">No images attached.</div>';
      return;
    }
    panel.innerHTML = msg.images.map((img) => {
      if (img.type === "base64") {
        return `<img class="artifact-image" src="data:${escapeHtml(img.mediaType)};base64,${img.data}" alt="Uploaded context image" />`;
      }
      return `<img class="artifact-image" src="/api/file?path=${encodeURIComponent(img.path)}" alt="Uploaded context image" />`;
    }).join("");
    return;
  }

  // ── AI Response ──
  titleEl.textContent = "📦 ARTIFACTS & DIFFS";
  titleEl.style.color = "#cbd5e1";

  const parts = [];

  // Clickable diff cards for Write/Edit files (exchange-propagated)
  for (const fc of msg.modifiedFiles || []) {
    const badgeClass = fc.isNew ? "badge-new" : "badge-edit";
    const badgeText = fc.isNew ? "✨ NEW FILE" : "✏️ EDITED";
    parts.push(`
      <div class="diff-card" data-fc-path="${escapeHtml(fc.path)}">
        <div class="row-between">
          <strong>${escapeHtml(fc.name)} ↗</strong>
          <span class="badge ${badgeClass}">${badgeText}</span>
        </div>
        <div>+${fc.linesAdded}  -${fc.linesRemoved}   ${escapeHtml(fc.path)}</div>
      </div>
    `);
  }

  // Read-only file badges from Read/Glob/Grep tool calls
  const readTools = (msg.toolCalls || []).filter(
    (tc) => tc.name === "Read" || tc.name === "Glob" || tc.name === "Grep"
  );
  for (const tc of readTools) {
    const p = tc.input?.file_path || tc.input?.path || tc.input?.pattern || "";
    if (p) parts.push(`<div class="diff-card"><span class="badge badge-read">📖 READ</span> ${escapeHtml(p)}</div>`);
  }

  if (parts.length === 0) {
    panel.innerHTML = '<div class="empty-state">No files, images, or artifacts attached.</div>';
    return;
  }

  panel.innerHTML = parts.join("");

  // Wire up diff card click handlers
  panel.querySelectorAll("[data-fc-path]").forEach((card) => {
    card.addEventListener("click", () => {
      const fcPath = card.getAttribute("data-fc-path");
      const fc = (msg.modifiedFiles || []).find((f) => f.path === fcPath) || State.fileChanges[fcPath];
      if (fc) openFileDiff(fc);
    });
  });
}

// ─── Diff viewer ──────────────────────────────────────────────────────────────

function openFileDiff(fileChange) {
  const diffLines = String(fileChange.diffText || "").split("\n");
  let lineNumber = 1;
  const rows = diffLines.map((line) => {
    if (line === "@@") {
      return `<tr class="hunk"><td class="ln"></td><td class="code">@@ ... @@</td></tr>`;
    }
    let cls = "ctx";
    if (line.startsWith("+")) cls = "add";
    if (line.startsWith("-")) cls = "rem";
    const row = `<tr class="${cls}"><td class="ln">${lineNumber}</td><td class="code">${escapeHtml(line)}</td></tr>`;
    lineNumber += 1;
    return row;
  }).join("");

  const badge = fileChange.isNew
    ? `<span class="viewer-badge new">✨ NEW FILE</span>`
    : `<span class="viewer-badge edit">✏️ EDITED</span>`;

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Diff — ${escapeHtml(fileChange.name)}</title>
  <style>
    body { margin:0; background:#0a0f1e; color:#e2e8f0; font-family: ui-monospace, Menlo, monospace; }
    header { position:sticky; top:0; padding:14px 20px; background:#0f172a; border-bottom:1px solid #1e293b; z-index:2; display:flex; align-items:center; gap:12px; }
    .viewer-badge { border-radius:4px; padding:3px 8px; font-size:11px; font-weight:700; color:#000; }
    .viewer-badge.new { background:#4ade80; }
    .viewer-badge.edit { background:#fb923c; }
    .stats { font-size:12px; }
    .stats .add { color:#4ade80; font-weight:700; }
    .stats .rem { color:#f87171; font-weight:700; }
    .filepath { font-size:11px; color:#475569; margin-left:auto; }
    table { width:100%; border-collapse:collapse; }
    td { padding:1px 10px; vertical-align:top; }
    .ln { width:40px; text-align:right; color:#334155; border-right:1px solid #1e293b; user-select:none; }
    .code { white-space:pre; }
    tr.add { background:rgba(74,222,128,0.08); color:#4ade80; }
    tr.rem { background:rgba(248,113,113,0.08); color:#f87171; }
    tr.hunk { background:rgba(129,140,248,0.08); color:#818cf8; }
    tr.ctx { color:#64748b; }
  </style>
</head>
<body>
  <header>
    <strong>${escapeHtml(fileChange.name)}</strong>${badge}
    <span class="stats"><span class="add">+${fileChange.linesAdded}</span> <span class="rem">-${fileChange.linesRemoved}</span></span>
    <span class="filepath">${escapeHtml(fileChange.path)}</span>
  </header>
  <table>${rows}</table>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html" });
  window.open(URL.createObjectURL(blob), "_blank");
}

window.Renderer = {
  renderTimeline,
  applyFilter,
  selectGroup,
  openFileDiff,
  escapeHtml,
};
