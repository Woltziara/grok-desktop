---
name: web-pro-handoff
description: >
  Hand a bounded development task to the real ChatGPT GPT Pro webpage through
  Grok Desktop's own Preview window, wait, read the delivery back, apply it
  locally, then test and repair. Use when the user asks Grok Desktop to assign
  work to web GPT Pro / ChatGPT Pro, or to complete a Desktop-bound Pro round trip.
---

# Web GPT Pro via Grok Desktop Preview

You are running inside **Grok Desktop**. Web GPT Pro is the ChatGPT webpage the user can see in the detachable Preview window. Do **not** invent a second agent, a headless browser, or a fake Pro reply.

## Binding

1. The Preview MCP tools (`desktop-preview__preview_open` and the rest) only work for **this** Desktop conversation's Preview lease.
2. If those tools are missing, tell the user to **Restart agent** in Settings. Do not open cloakbrowser, Playwright MCP, Puppeteer, `web_fetch`, curl, or another Chrome/Edge/Codex profile.
3. Never copy cookies, passwords, or keychain items from other apps. The user logs into ChatGPT inside Preview.

## Round trip

1. Create a local assignment note in the current project (task text, expected files, “not applied yet”).
2. `desktop-preview__preview_open` `{ "url": "https://chatgpt.com/" }` and **read the snapshot**.
3. If the snapshot is a login / captcha / passkey wall: stop. Tell the user to sign in in that Preview window, then continue. Do not claim Pro finished.
4. If the composer is there, paste the bounded task with `desktop-preview__preview_fill` / `preview_fill_form` / `preview_press` Enter. The task must contain no secrets.
5. Poll `desktop-preview__preview_snapshot` until the reply is complete or the user says it is done. Do not screenshot.
6. Extract delivered files from the page text (fenced paths). Write them only under the agreed project directory. Run the tests. If they fail, send the failure back in Preview as a repair turn.
7. Report what was applied, what was tested, and what still needs the human in Preview.

## Do not do this

- Do not write the answer yourself and pretend ChatGPT produced it.
- Do not read GitHub as a stand-in for the webpage reply.
- Do not drive any browser except this Desktop Preview.
- Do not expand the task into a general workflow platform.

<!-- managed-by: grok-desktop-web-pro -->
