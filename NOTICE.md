# Notices

This file records where this project came from, what it borrows, and what it
does **not** include. Keep it when you copy or redistribute the Software.

## This project

**Grok Desktop** is an Electron + React desktop shell for the Grok Build
coding agent. It talks to an already-installed `grok` CLI over ACP. It does
not ship models, the agent runtime, skills, or MCP servers.

License of *this* repository: **MIT** (see `LICENSE`).

Copyright:

- 2026 Karman de Lange — original Grok Desktop shell
  ([liaan/grok-desktop](https://github.com/liaan/grok-desktop))
- 2026 Oscar Woltz — living-room UI, side workbench, session sidebar,
  compact-prep, message edit/fork, and related changes in this tree

The MIT license requires keeping the copyright notice and permission text.
That is why Karman’s notice stays in `LICENSE` even though this fork is
maintained separately.

## Upstream agent (not in this repo)

[xai-org/grok-build](https://github.com/xai-org/grok-build) is SpaceXAI’s
agent harness and TUI, licensed **Apache-2.0**. This GUI launches that
binary; it does not vendor grok-build source.

SpaceXAI / Grok’s public open-source home is **GitHub (`xai-org`)**. There
is no separate Grok source-hosting community that accepts third-party
desktop apps. The official plugin catalog
([xai-org/plugin-marketplace](https://github.com/xai-org/plugin-marketplace))
is for Grok Build *plugins* (skills, commands, agents, hooks, MCP). This
repository is a GUI, not a plugin, so it is not listed there.

## Code and structure we adapted (MIT — notice required)

These projects are MIT. We rewrote the equivalent layout in *this* Electron
tree rather than copying their repositories wholesale. Their copyright
notices still apply to the ideas/structure we followed:

| Source | License | How we used it |
|--------|---------|----------------|
| [liaan/grok-desktop](https://github.com/liaan/grok-desktop) | MIT | This app is a fork of that shell (ACP, login, sessions, Preview MCP). |
| [RongleCat/grok-app](https://github.com/RongleCat/grok-app) | MIT | Side workbench structure (tab strip, file tabs, in-pane browser/chat). Rewritten for Electron; not a copy of the Tauri tree. |
| [sindresorhus/github-markdown-css](https://github.com/sindresorhus/github-markdown-css) | MIT | `src/styles/github-markdown-light.css` is based on that stylesheet. Colors were remapped in `markdown-paper-ink.css`. |

github-markdown-css:

```
MIT License
Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)
```

## npm dependencies

Runtime and build dependencies are listed in `package.json` /
`package-lock.json` with their own licenses (MIT, ISC, Apache-2.0, and
similar). They are not copied into this notice one-by-one; install the
lockfile to obtain them.

## Behavior we looked at — no source copied

| Source | License | Rule |
|--------|---------|------|
| Codex desktop / ChatGPT | proprietary | Sidebar (projects + recents), turn layout, in-pane browser. Behavior only. |
| Claude desktop / Claude Code | proprietary | Chat living-room, artifact timing. Behavior only. |
| Cherry Studio | AGPL-3.0 | Quiet chrome / principles. **No source, no components.** |
| opcode | AGPL-3.0 | Window feel. **No source.** |
| Wave Terminal “Paper & Ink” | user’s local appearance | Palette restated (`#FAF7F2` paper, ink, accent `#0E7490`). No Wave source tree is vendored. |

AGPL projects must not be copied, linked, or vendored into this MIT tree.

## Fonts

- **Hack** (`src/assets/fonts/hack-*.woff2`) is included under the Hack /
  Source Foundry license (MIT-style). See
  [source-foundry/Hack](https://github.com/source-foundry/Hack).
- **仓耳今楷** is *not* redistributed here. The UI may request it if the
  user already has it installed. Do not add those font files unless you
  have a license to redistribute them.

## Trademark

“Grok”, “Grok Build”, “xAI”, and “SpaceXAI” are marks of their owners.
This project is an independent GUI. It is not an official SpaceXAI product.
