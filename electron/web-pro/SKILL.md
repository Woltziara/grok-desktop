---
name: web-pro-handoff
description: >
  Hand a bounded development task to the real ChatGPT GPT Pro webpage through
  Grok Desktop's own Preview window, wait until the reply is finished, read it
  back, apply it with ordinary file tools, then test and repair. Use when the
  user asks Grok Desktop to assign work to web GPT Pro / ChatGPT Pro.
---

# Web GPT Pro via Grok Desktop Preview

You are running inside **Grok Desktop**. Web GPT Pro is the ChatGPT page in this conversation's Preview window. Do **not** invent a second agent, a headless browser, a second assignment store, or a fake Pro reply.

## Binding

1. Use only `desktop-preview__preview_*` for **this** conversation's Preview lease.
2. If those tools are missing, tell the user to **Restart agent** in Settings. Do not open cloakbrowser, Playwright MCP, Puppeteer, `web_fetch`, curl, or another Chrome/Edge/Codex profile.
3. Never copy cookies, passwords, or keychain items from other apps. The user logs into ChatGPT inside Preview.

## Confirm GPT Pro before sending

Account plan named Pro is not enough. The **currently selected model** on the page must be GPT Pro.

1. `desktop-preview__preview_open` `{ "url": "https://chatgpt.com/" }` unless Preview is already that site. Read the snapshot.
2. If the snapshot is a login / captcha / passkey wall (Chinese or English: 登录或注册, Log in, Sign up, Continue with Google, 验证码): **stop**. Tell the user to sign in in that same Preview window, then wait. Keep polling `preview_snapshot` until a composer appears, or until the user says they signed in. Do not report the round trip as finished. Do not paste the task.
3. Find the **model picker** in the snapshot (typically a `combobox` or header `button` whose name is the current model). Do not treat upgrade/subscribe/升级/订阅 links as the current model.
4. The picker name must show Pro as the selected model, in whatever language the page uses (for example a name containing `Pro` or `专业版`). If it does not:
   - Click the picker.
   - From the **new** snapshot, click the option whose accessible name is the GPT Pro model (again `Pro` or `专业版`, not Plus/升级).
   - Snapshot again. If the picker still is not Pro, stop and report the visible model names. Do not send the task.
5. Only after that confirmation, paste the bounded task with `preview_fill` / `preview_fill_form` / `preview_press` Enter. No secrets.

## Wait until the reply is actually finished

Do not use a short fixed sleep as “done”. Poll `preview_snapshot` until:

- There is no Stop generating / 停止生成 / streaming control, and
- A completed assistant reply is visible (Copy / 复制 or equivalent),

or the user says the reply is complete. Then read the full snapshot.

## Apply, test, repair

1. From the page text, take only the agreed files. Write them with ordinary project file tools (the same path-safe writes as any other Desktop turn). Do not call a special apply/assignment API.
2. Run the tests those files declare. If they fail, paste the failure back into Preview as a repair turn, wait for a finished reply again, and rewrite.
3. Report: whether GPT Pro was the selected model (quote the picker name), which files were written, test output, and what still needs the human in Preview.

## Do not do this

- Do not write the answer yourself and pretend ChatGPT produced it.
- Do not read GitHub as a stand-in for the webpage reply.
- Do not treat “opened the login page” as a completed round trip.
- Do not drive any browser except this Desktop Preview.

<!-- managed-by: grok-desktop-web-pro -->
