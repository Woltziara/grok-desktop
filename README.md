# Grok Desktop

给**不写代码的人**用的 Grok Build 桌面壳：打开就能说话，像聊天客厅，不像代码工作台。

底层仍是已安装的 `grok`（ACP）。本仓库只改人看见的那一层。

不是 SpaceXAI 官方产品。许可证 **MIT**，详见文末与 [`NOTICE.md`](NOTICE.md)。

## 这套界面做成了什么样

打开窗口：中间一个名字、下面一个输入框，可以直接说这件事。左边是案子。右边默认关掉，只有要盯着看的一页才滑出来。

| 位置 | 人看见的 |
|------|----------|
| **左** | **项目**（每个文件夹一个项目，里面是这个项目的对话）和 **最近**。正在跑的对话右边有转动的小圆圈。切换对话不会取消正在进行的一轮。 |
| **中** | 对话本身。你说的话靠右、深色圆角气泡；回复靠左、不装进气泡，标题/列表/引用/代码按正文排。纸色 `#FAF7F2`，墨色暖灰，唯一强调色青绿。正文用仓耳今楷（本机已装时），代码用 Hack。 |
| **右** | 对话里写出来的页面和文稿；点 **Preview** 或 ⌘T 在这一栏打开网页，不再另开黑窗口。 |
| **输入框** | 贴在中间底部。模型和权限藏在框内小标签。还剩约 25% 上下文时可点余量格子：先 Compact Prep 写胶囊，再压缩，再强制读 Catch up。你发消息时若它还在想，会马上插入，不排队。 |

对话里还可以：改自己刚说的话（铅笔）、复制回复、从某条回复 **分支** 开一条新对话。工具过程收成安静的活动条，不拿大徽章当主角。

意图锁定（给后续改界面的人）：[`docs/INTENT-LOCK.md`](docs/INTENT-LOCK.md)。

## 安装 / 保存这一版

本叉目前提供 **Apple Silicon Mac** 的应用程序压缩包（GitHub Releases）。需要本机已安装 [Grok Build CLI](https://github.com/xai-org/grok-build)。

1. 打开 [Releases](https://github.com/Woltziara/grok-desktop/releases/latest)，下载 `GrokDesktop-*-Mac-AppleSilicon.zip`
2. 解压，把 **Grok Desktop** 拖进「应用程序」
3. 若系统说已损坏，在终端执行：`xattr -cr "/Applications/Grok Desktop.app"`，再从「应用程序」打开
4. 应用内 **用浏览器登录**，再打开一个项目文件夹

从源码运行：`npm install && npm run dev`（Node 22+）。打安装包：`npm run pack`。

Windows / Linux 安装包尚未由本叉打包；上游原版在 [liaan/grok-desktop](https://github.com/liaan/grok-desktop/releases)。

### Mac: “damaged and can’t be opened”

macOS does this for **unsigned / team builds** downloaded from the internet (Safari quarantine). Use **v0.1.3+** if Apple Silicon DMGs from 0.1.2 refuse to open (broken partial signature — fixed in 0.1.3).

**Fix (once per install):**

1. Drag **Grok Desktop** into **Applications** (not only run from the DMG).
2. Eject the DMG.
3. Open **Terminal** and run:

```bash
xattr -cr "/Applications/Grok Desktop.app"
```

4. Open **Grok Desktop** from Applications (double-click or Spotlight).

If it still complains: right-click the app → **Open** → **Open**.

Until the company signs + notarizes with an Apple Developer ID, this step is normal for internal team builds.

> **Windows:** SmartScreen → **More info → Run anyway**.

---

This project is **not** a reimplementation of the agent, models, or tools. It is an **Electron + React** app that:

1. Signs you in with the same browser flow as the Grok CLI (`grok login`)
2. Opens a project folder
3. Spawns `grok agent stdio` and talks **Agent Client Protocol (ACP)** over JSON-RPC
4. Reuses your existing `~/.grok` setup — skills, MCP servers, plugins, models, and auth

```text
┌────────────────────────────┐
│  Grok Desktop (this repo)  │  chat · tools · approvals · Preview · projects
└─────────────┬──────────────┘
              │ ACP / stdio
┌─────────────▼──────────────┐
│  grok agent (installed CLI)│  models · skills · MCP · auth · tools
└────────────────────────────┘
```

Runs on **Windows, macOS, and Linux** (Electron). Team installers ship for **Windows, macOS, and Linux** from Releases. You need the Grok Build CLI installed; day-to-day login can be done entirely in the app.

## Features

| Area | Status |
|------|--------|
| In-app browser sign-in / sign-out | Done |
| Optional API key for this session | Done |
| Skills, plugins & MCP **inherited** from `~/.grok` (same as CLI) | Done — invoke skills in chat; **list/toggle in Settings** |
| Project rules (`AGENTS.md`, etc.) via open folder | Done — agent uses project as cwd (same as CLI) |
| Open project + recent folders | Done |
| Multi-window same repo (Grok worktrees) | **Done** — same as TUI `/new` worktree: ACP `x.ai/git/worktree/*`. Opening a folder already open prompts to switch, reuse, or create. File → **New Worktree Window…**. Second Start Menu launch joins this process (new window). Grok worktrees auto-trust so project MCP/hooks load (TUI `/hooks-trust`). |
| Streaming messages, thoughts, plans, tool cards | Done |
| Tool permission approvals + always-approve | Done |
| Cancel + mid-turn queue / send-now | Done |
| Slash menu (skills + local `/new`) | Done |
| Simple file list peek | Done — in-app peek + Changes tab |
| Diff review pane | Done — ACP diffs + git Changes |
| Resume CLI sessions with history | Done (same `~/.grok/sessions`) |
| Multi-session tabs | Basic (sidebar chat list) |
| Settings UI (MCP list / add / edit / toggle / OAuth sign-in) | **Done** — via `grok mcp` + ACP auth (never edits `config.toml` in-app) |
| Settings UI (plugins list / enable / disable / install-from-git) | **Done** — via `grok plugin` (never edits `config.toml` in-app) |
| Settings UI (skills list) | **Done** — read-only from `grok inspect`; invoke via `/` |
| Settings UI (model / skills editor) | **Planned** — configure under `~/.grok` for now |
| Native installers | **Windows + macOS + Linux Done** — [Releases](https://github.com/Woltziara/grok-desktop/releases) |
| Detachable **Preview** window (you or the agent open / snapshot / click / fill / network waterfall) | **Done** — topbar **Preview**, `/preview [url\|close]`, or ask the agent to show a URL |

## Requirements

1. **Grok Build CLI** installed (`grok` on `PATH`, or `~/.grok/bin/grok` / `grok.exe`)
2. **Sign-in** from the app (browser OAuth), or an API key / `XAI_API_KEY`
3. **Node.js 22+** — only if building/running from source (`npm run dev`)

Install the CLI with the official installer for your OS (see [Grok Build](https://github.com/xai-org/grok-build) / project docs), then start this app and use **Sign in with browser**.

### Agent config: what works in the GUI vs CLI-only

Desktop does **not** reimplement skills, MCP, models, or project rules. It opens a project folder and spawns the same `grok` agent the TUI uses.

| Config | In GUI today | Still CLI / files only |
|--------|--------------|-------------------------|
| Auth | Sign in / out in app | — |
| Session API key | Optional (applies on next agent start) | `XAI_API_KEY` env |
| **Skills** (runtime) | Settings list + invoke via `/skill-name` slash menu | Install / edit under `~/.grok` (no in-app editor) |
| **MCP servers** | Settings → MCP (list / add / edit / toggle / test / sign in) | Still stored in `~/.grok` / project `.grok` via `grok mcp`. OAuth uses the live agent (same as TUI `/mcps` + `i`) |
| **Plugins** | Settings → Plugins (list / enable / disable / install from git URL) | Marketplace browse still CLI |
| **Models** | Whatever the agent session uses | Model / routing in CLI config |
| **Project rules** (`AGENTS.md`, `CLAUDE.md`, …) | Apply when you **Open project…** to that repo | Edit the files in the repo (agent loads from cwd) |
| Tool permission mode (Ask / Auto / Always approve) | Topbar **Perms** dropdown + Settings | Agent `session/set_mode` + `_meta.yoloMode` / `permissionMode` on session start |
| Reasoning effort (`/effort`) | Topbar **Effort** dropdown (Low / Medium / High / X-High) | Agent `--reasoning-effort` on spawn + live `session/set_model` `_meta.reasoningEffort` |
| **Project-root safety** | On by default (Settings: “Allow outside project” off) | Open project + **linked git worktrees** of that repo. Agent fs/terminal also allow **Grok worktrees** of this repo (`~/.grok/worktrees`). File browser stays project + porcelain. Turn on only for unrelated host paths. Independent of terminal sandbox. |
| **Terminal sandbox** | On by default (Settings: “Sandbox terminal”) | macOS Seatbelt / Linux `bwrap` / Windows WSL+bwrap or Docker (no host docker.sock). Turn off only for unrestricted host shell |
| **Preview window** | Topbar **Preview**, `/preview [url\|close]`, or ask the agent to open a URL | Desktop attaches its own Preview MCP; **Restart agent** if those tools are missing |

**After changing** MCP or plugins in Settings, Desktop restarts the agent automatically. Skills added under `~/.grok/skills` still need **Restart agent** (or re-open the project) so a new process picks them up. The welcome “N skills · M MCP · P plugins” strip is a `grok inspect` summary.

Optional environment variables:

| Variable | Purpose |
|----------|---------|
| `GROK_BINARY` | Full path to the `grok` executable |
| `GROK_HOME` | Override config/auth home (default `~/.grok`) |
| `XAI_API_KEY` | API key fallback when no session token is present |
| `GROK_DESKTOP_SANDBOX_IMAGE` | Docker image for terminal sandbox (default `buildpack-deps:noble-scm`, must include `git`) |
| `GROK_DESKTOP_ALLOW_DOCKER_SANDBOX` | Set `1` to allow Docker tool sandbox on Windows (off by default — hangs on bind mounts) |
| `GROK_DESKTOP_WSL_DISTRO` | Preferred WSL distro for Windows terminal sandbox |
| `GROK_DESKTOP_MULTI_INSTANCE` | Set `1` to skip the single-instance lock (second launch starts a separate process). Unpackaged `npm run dev` already skips joining an installed app |
| `GROK_DESKTOP_DEBUG` | Set `1` to enable desktop-debug.log (tools/hooks/terminals) |
| `GROK_DESKTOP_TERMINAL_TIMEOUT_MS` | Kill hung tool shells after N ms (default `900000` = 15 min; `0` = off) |

## Preview window

A second Electron window you can drag to another screen. Use it to look at localhost, a ticket URL, or a page the agent is testing. The agent drives that window (open, snapshot, click, type) instead of curling the site or spinning up a separate browser.

**Open it**

- Topbar **Preview** (empty window, then load a URL from the address bar)
- Composer: `/preview https://localhost:5173` or `/preview close`
- Ask in chat: “preview this URL” / “show the login page” — the agent opens Preview and reads a **text snapshot** (copy, controls). For layout/CSS, frame the issue (Size / zoom) and press **Send screenshot** so the capture goes into chat.

**Network waterfall:** toolbar **Network** (always recording). Status, type, size, timing bars, initiator. **After load** isolates lazy/deferred requests. The agent can call `desktop-preview__preview_network` (`afterLoad: true` for post-load only).

**If the agent says Preview tools are missing:** Settings → **Restart agent** so Desktop can attach the Preview MCP. That MCP is part of this app (not something you add under `~/.grok`).

This is **not** Settings → **Preview updates**. That switch only opts you into GitHub prerelease installers (`vX.Y.Z-beta.N`). Stable `1.2.0+` already includes the Preview window.

## Quick start (developers)

```bash
git clone https://github.com/Woltziara/grok-desktop.git
cd grok-desktop
npm install
npm run dev
```

- Vite serves the UI at `http://127.0.0.1:5173`
- Electron opens the window and uses your local `grok` binary

Production-style run from source:

```bash
npm run build
npm start
```

Local installer smoke-test (current OS only):

```bash
npm run pack    # unpacked app under release/
npm run dist    # installer for this machine
```

### First launch

1. If Grok Build is missing, use **Open install guide** in the app.
2. Click **Sign in with browser** (or device code / API key).
3. **Open project…** and chat — the agent uses the same skills and MCP as the CLI.

## Maintainers / agents

How to cut a release, CI, packaging invariants: **`AGENTS.md`** (canonical). Do not duplicate that process here.

## Architecture

```text
grok-desktop/
  electron/
    main.mjs           # window, IPC, auth bridge
    preload.cjs        # renderer ↔ main bridge
    acp-client.mjs     # grok agent stdio + JSON-RPC
    auth.mjs           # login / logout / status (via CLI)
    backbone.mjs       # grok inspect summary (skills, MCP)
    grok-home.mjs      # binary + env discovery
  src/
    App.tsx            # main layout
    components/        # chat timeline, side panel, auth UI
    lib/               # session update helpers
    styles/
```

### ACP (client ↔ agent)

**Client → agent:** `initialize`, `session/new`, `session/load`, `session/prompt`, `session/cancel`

**Agent → client:** `session/update`, `session/request_permission`, `fs/*`, `terminal/*`

`session/new` / `session/load` use an empty client `mcpServers` list (same pattern as other embeds). The agent still merges MCP and skills from `~/.grok` and plugins. Project instruction files are loaded by the agent from the session **cwd** (the folder you opened).

## Desktop vs terminal CLI

| | Grok CLI (TUI) | Grok Desktop |
|--|----------------|--------------|
| UI | Terminal | Electron GUI + detachable **Preview** window |
| Agent | `grok` binary | Same binary via ACP |
| Auth | `grok login` / env | In-app (same underlying login) |
| Skills / MCP | `~/.grok` | Same `~/.grok` + Desktop Preview MCP (agent can drive the Preview window) |
| Models | From Grok install | Same |

## Authors

- **Karman de Lange** — original Grok Desktop shell ([liaan/grok-desktop](https://github.com/liaan/grok-desktop))
- **Oscar Woltz** — this fork’s living-room UI and session/workbench changes

## License

**MIT** — see [`LICENSE`](./LICENSE) and [`NOTICE.md`](NOTICE.md).

This repository is an independent GUI client. It does **not** ship Grok Build source code. The installed `grok` CLI remains under its own upstream license; using that binary is separate from this MIT-licensed UI.
