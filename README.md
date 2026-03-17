# 🔬 Claude Code Lens

**A local session inspector for Claude Code.** Visualize every prompt, AI response, and tool call from your Claude Code sessions as an interactive timeline — with reasoning traces, file diffs, and inline annotations.

> No cloud. No accounts. Reads directly from `~/.claude/projects/` on your machine.

---

## What it does

Claude Code stores every session as a JSONL file. A typical hour-long session can contain 80+ raw events — tool calls, thinking traces, assistant turns, user messages — all interleaved in a flat log.

Claude Code Lens parses those logs and renders them as a **compressed, navigable timeline**:

| Node type | What it represents |
|---|---|
| **User Prompt** (cyan) | Your messages to Claude |
| **AI Response** (blue) | Claude's concluding response per exchange, with thinking trace and file diffs |
| **Segment Divider** (amber) | Intermediate steps collapsed — tool calls, internal AI turns |

Click any node to open the **three-panel inspector**:
- **Metadata** — node ID, timestamp, model, working directory, inline notes
- **Reasoning & Actions** — full response text, expandable thinking trace, terminal commands with output
- **Artifacts & Diffs** — every file written or edited at this step, with unified diffs

---

## Features

- **Message-level compression** — 80+ raw events collapsed into a readable timeline
- **Thinking trace viewer** — Claude's internal reasoning exposed per node
- **File diff attribution** — diffs shown on the AI Response that completed each exchange, not buried in dividers
- **Session naming** — reads your `/rename` titles; falls back to first user message
- **Inline annotations** — add review notes to any node, persisted in local SQLite
- **Branch export** — export a conversation branch as a JSONL from any point
- **JSONL upload** — drag in any `.jsonl` file without configuring a path
- **No build step** — vanilla JS, zero frontend dependencies

---

## Getting started

### Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **Claude Code** installed and at least one session recorded in `~/.claude/projects/`

---

### macOS

```bash
# 1. Clone the repository
git clone https://github.com/your-username/claude-code-lens.git
cd claude-code-lens

# 2. Install dependencies
npm install

# 3. Start the server
npm start
```

Open **http://localhost:3456** in your browser. The app auto-discovers your sessions from `~/.claude/projects/`.

> **Tip:** Use `/rename` inside a Claude Code session to give it a readable name — it will appear in the session dropdown immediately.

---

### Linux

```bash
# 1. Install Node.js 18+ if not already installed
# Ubuntu / Debian:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Fedora / RHEL:
sudo dnf install nodejs

# 2. Clone and install
git clone https://github.com/your-username/claude-code-lens.git
cd claude-code-lens
npm install

# 3. Start
npm start
```

Open **http://localhost:3456** in your browser.

> **Note:** `better-sqlite3` requires a C++ build toolchain. If `npm install` fails, install build tools first:
> ```bash
> # Ubuntu / Debian
> sudo apt-get install -y build-essential python3
>
> # Fedora / RHEL
> sudo dnf groupinstall "Development Tools"
> ```

---

### Windows

#### Option A — WSL (recommended)

Run inside [Windows Subsystem for Linux](https://learn.microsoft.com/en-us/windows/wsl/install) for the best experience:

```powershell
# In PowerShell (run as Administrator) — install WSL if you haven't already
wsl --install
```

Then open your WSL terminal and follow the **Linux** instructions above. Claude Code session files are typically at:

```
~/.claude/projects/
```

#### Option B — Native Windows (PowerShell)

```powershell
# 1. Install Node.js 18+ from https://nodejs.org (LTS recommended)
#    Ensure "Add to PATH" is checked during install.

# 2. Install windows-build-tools (required for better-sqlite3)
#    Run PowerShell as Administrator:
npm install --global windows-build-tools

# 3. Clone and install
git clone https://github.com/your-username/claude-code-lens.git
cd claude-code-lens
npm install

# 4. Start
npm start
```

Open **http://localhost:3456** in your browser.

> **Note:** Windows session files are stored at `%USERPROFILE%\.claude\projects\`. The app resolves `~` automatically, but if the path isn't detected you can paste the full path in the Config drawer.

---

## Configuration

Click **⚙️ Config** in the header to open the config drawer:

| Setting | Default | Description |
|---|---|---|
| Projects path | `~/.claude/projects` | Directory where Claude Code stores JSONL session files |
| Browse JSONL | — | Upload any `.jsonl` file directly without scanning a directory |

Hit **SCAN** after changing the path to reload the session list.

---

## Session naming

Claude Code auto-generates session names. To set a readable name, run inside a Claude Code session:

```
/rename My session name
```

Claude Code Lens reads this immediately on the next scan.

---

## Interactive demo

Visit **http://localhost:3456/demo.html** for a fully self-contained interactive demo using mock data — no sessions required. Includes a guided tour of every feature.

---

## Project structure

```
claude-code-lens/
├── server.js              # Express entry point (port 3456)
├── src/
│   ├── config.js          # Port and path constants
│   ├── db/
│   │   └── claudeDb.js    # JSONL parsing, two-pass compression, diff computation
│   └── routes/
│       ├── sessions.js    # GET /api/sessions, GET /api/session/:id
│       ├── comments.js    # POST /api/comments
│       └── export.js      # POST /api/export-branch
└── public/
    ├── index.html
    ├── demo.html          # Self-contained interactive demo
    ├── css/app.css
    └── js/
        ├── state.js       # Shared mutable state
        ├── api.js         # Fetch wrappers
        ├── renderer.js    # DOM rendering
        └── app.js         # Init, event handlers, grouping algorithm
```

---

## How it works

### Two-pass grouping algorithm

**Pass 1** collapses consecutive tool-call assistant turns into agent groups. Each group represents one logical unit of work (read files → edit → verify).

**Pass 2** uses real user prompts as anchors. Everything between two user prompts is either:
- The final AI Response (shown as a primary card), or
- Intermediate steps (collapsed into an amber Segment Divider)

### File diff attribution

File changes from `Write` and `Edit` tool calls are propagated to the **last AI Response per exchange** — not to the tool-call nodes that produced them. This means every AI Response card shows exactly which files changed as a result of that exchange.

### Session name resolution

1. Most recent `custom-title` event in the JSONL (written by `/rename`)
2. First user message text (truncated to 65 characters)

---

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Server | Express 5 |
| Database | better-sqlite3 (comments only) |
| Frontend | Vanilla JS, no framework, no build step |
| Data source | Claude Code JSONL files (`~/.claude/projects/`) |

---

## Contributing

Contributions are welcome. Please open an issue before submitting a large pull request so we can discuss the approach.

```bash
# Run with auto-reload during development
node --watch server.js
```

There is no test suite or linter configured. Keep PRs focused and include a description of what changed and why.

---

## License

MIT
