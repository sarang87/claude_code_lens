// ─── Two-pass grouping algorithm (§4 of spec) ────────────────────────────────

function buildGroupedNodes(messages) {
  // Pass 1 — collapse consecutive tool-call messages into agent groups
  const rawGroups = [];
  for (const msg of messages) {
    if (msg.isToolResult) continue; // tool-result lines are internal noise; skip entirely

    const isToolCall = msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0;
    const lastGroup = rawGroups[rawGroups.length - 1];

    if (isToolCall) {
      if (lastGroup && lastGroup.isAgentGroup) {
        lastGroup.items.push(msg);
      } else {
        rawGroups.push({ id: `group-${msg.id}`, isAgentGroup: true, items: [msg] });
      }
    } else {
      rawGroups.push({ id: msg.id, isAgentGroup: false, items: [msg] });
    }
  }

  // Pass 2 — segment compression around real user-prompt anchors
  const groupedNodes = [];
  let segmentBuffer = [];

  function flushBuffer() {
    if (segmentBuffer.length === 0) return;
    if (segmentBuffer.length === 1) {
      groupedNodes.push(segmentBuffer[0]);
    } else {
      const intermediates = segmentBuffer.slice(0, segmentBuffer.length - 1);
      const last = segmentBuffer[segmentBuffer.length - 1];
      const totalSteps = intermediates.reduce((s, g) => s + g.items.length, 0);
      groupedNodes.push({
        id: `divider-${intermediates[0].id}`,
        isSegmentDivider: true,
        subGroups: intermediates,
        items: intermediates.flatMap((g) => g.items),
        totalSteps,
      });
      groupedNodes.push(last);
    }
    segmentBuffer = [];
  }

  for (const group of rawGroups) {
    const firstMsg = group.items[0];
    const isRealUserPrompt =
      !group.isAgentGroup &&
      firstMsg &&
      firstMsg.role === "user" &&
      firstMsg.hasTextContent &&
      !firstMsg.isToolResult;

    if (isRealUserPrompt) {
      flushBuffer();
      groupedNodes.push(group);
    } else {
      segmentBuffer.push(group);
    }
  }
  flushBuffer();

  return groupedNodes;
}

// ─── Session loading ──────────────────────────────────────────────────────────

async function initSessions() {
  const projectsPath = document.getElementById("projectsPath").value.trim();
  const sessionSelect = document.getElementById("sessionId");
  const data = await Api.fetchSessions(projectsPath);

  sessionSelect.innerHTML = "";
  for (const session of data.sessions) {
    const option = document.createElement("option");
    option.value = session.id;
    option.textContent = `[${session.id.slice(0, 8)}] ${session.preview}`;
    sessionSelect.appendChild(option);
  }
  if (data.sessions.length > 0) {
    const hint = document.createElement("option");
    hint.disabled = true;
    hint.textContent = "💡 Use /rename in Claude Code to name sessions";
    sessionSelect.appendChild(hint);
  }

  if (data.sessions.length > 0) {
    await fetchDataAndInitialize();
  } else {
    State.rawMessages = [];
    State.groupedNodes = [];
    State.selectedNodeId = null;
    Renderer.renderTimeline();
    document.getElementById("metadataPanel").innerHTML = '<div class="empty-state">No sessions found.</div>';
    document.getElementById("reasoningPanel").innerHTML = '<div class="empty-state">Nothing selected.</div>';
    document.getElementById("artifactsPanel").innerHTML = '<div class="empty-state">Nothing selected.</div>';
  }
}

async function fetchDataAndInitialize() {
  const projectsPath = document.getElementById("projectsPath").value.trim();
  const sessionId = document.getElementById("sessionId").value;
  if (!sessionId) return;

  const payload = await Api.fetchSession(sessionId, projectsPath, State.uploadedPath);
  State.rawMessages = payload.messages || [];
  State.comments = payload.comments || {};
  State.fileChanges = payload.fileChanges || {};
  State.sessionMeta = payload.sessionMeta || {};

  State.groupedNodes = buildGroupedNodes(State.rawMessages);
  State.selectedNodeId = State.groupedNodes.length ? State.groupedNodes[0].id : null;

  Renderer.renderTimeline();
  if (State.selectedNodeId) {
    Renderer.selectGroup(State.selectedNodeId);
  }
}

// ─── Config drawer ────────────────────────────────────────────────────────────

function toggleConfigDrawer() {
  const drawer = document.getElementById("config-drawer");
  drawer.classList.toggle("hidden");
}

// ─── Comment modal ────────────────────────────────────────────────────────────

function openCommentModal(nodeId) {
  State.modalNodeId = nodeId;
  document.getElementById("commentInput").value = State.comments[nodeId] || "";
  document.getElementById("commentModal").classList.remove("hidden");
}

function closeCommentModal() {
  State.modalNodeId = null;
  document.getElementById("commentModal").classList.add("hidden");
}

async function saveComment() {
  const nodeId = State.modalNodeId;
  if (!nodeId) return;
  const value = document.getElementById("commentInput").value;
  await Api.saveComment(nodeId, value);
  if (value.trim()) {
    State.comments[nodeId] = value;
  } else {
    delete State.comments[nodeId];
  }
  closeCommentModal();
  const keepSelected = State.selectedNodeId;
  Renderer.renderTimeline();
  if (keepSelected) Renderer.selectGroup(keepSelected);
}

// ─── Branch export ────────────────────────────────────────────────────────────

async function branchFromNode(groupId) {
  const group = State.groupedNodes.find((g) => g.id === groupId);
  if (!group) return;

  // Find the last message in this group in the raw message list
  const lastMsgInGroup = group.items[group.items.length - 1];
  const lastIdx = State.rawMessages.findIndex((m) => m.id === lastMsgInGroup.id);
  if (lastIdx === -1) return;

  const result = await Api.exportBranch(
    State.rawMessages.slice(0, lastIdx + 1),
    lastMsgInGroup.id
  );
  alert(`Branch exported to: ${result.path}\nReference this file in a new Claude Code session with @filename.`);
}

// ─── JSONL file upload ────────────────────────────────────────────────────────

async function handleJsonlUpload(event) {
  const [file] = event.target.files || [];
  if (!file) return;

  const upload = await Api.uploadJsonl(file);
  State.uploadedPath = upload.path;

  const payload = await Api.fetchSession(
    "uploaded",
    document.getElementById("projectsPath").value.trim(),
    State.uploadedPath
  );

  State.rawMessages = payload.messages || [];
  State.comments = payload.comments || {};
  State.fileChanges = payload.fileChanges || {};
  State.sessionMeta = payload.sessionMeta || {};

  State.groupedNodes = buildGroupedNodes(State.rawMessages);
  State.selectedNodeId = State.groupedNodes.length ? State.groupedNodes[0].id : null;

  Renderer.renderTimeline();
  if (State.selectedNodeId) Renderer.selectGroup(State.selectedNodeId);
}

// ─── App handlers exposed to renderer ────────────────────────────────────────

window.AppHandlers = {
  openCommentModal,
  branchFromNode,
};

// ─── Boot ─────────────────────────────────────────────────────────────────────

window.onload = async () => {
  document.getElementById("configToggle").addEventListener("click", toggleConfigDrawer);
  document.getElementById("scanBtn").addEventListener("click", initSessions);
  document.getElementById("sessionId").addEventListener("change", async () => {
    State.uploadedPath = null;
    await fetchDataAndInitialize();
  });
  document.getElementById("nodeFilter").addEventListener("change", Renderer.applyFilter);
  document.getElementById("jsonlUpload").addEventListener("change", handleJsonlUpload);
  document.getElementById("cancelComment").addEventListener("click", closeCommentModal);
  document.getElementById("saveComment").addEventListener("click", saveComment);

  await initSessions();
};
