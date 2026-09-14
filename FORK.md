# How this relates to Grok Build

## Layers

| Layer | What it is | Where it lives |
|-------|------------|----------------|
| Agent (models, tools, skills, MCP, auth) | Official Grok Build CLI | Installed `grok` binary + `~/.grok` |
| Desktop GUI | This project | Electron + React ACP client |

Grok Build already supports embedding via:

```bash
grok agent stdio
```

This app is a graphical client on that interface. It does not replace or patch the agent monorepo UI.

## Agent source is an external reference

Read ACP implementation details in [xai-org/grok-build](https://github.com/xai-org/grok-build).
The installed CLI is the runtime dependency; this workspace keeps only the
desktop product source. Do not recreate sibling agent/Tauri/old-desktop source
copies as build inputs.

## Why a separate repo?

1. The agent project is maintained separately; this is a product shell around ACP.
2. Replacing the terminal UI inside that tree is a large effort; ACP is the supported boundary for alternate clients.
3. Keeps this UI’s license (**MIT**) clean of vendored agent source.

**GUI product layer · reuse the agent process.**
