/**
 * Preview MCP tool catalog + dispatch (Electron-free).
 * HTTP JSON-RPC and tests share this. There is no second stdio implementation.
 */
import { SNAPSHOT_NO_SCREENSHOT_HINT } from "./preview-snapshot.mjs";

export const PREVIEW_MCP_TOOLS = [
  {
    name: "preview_open",
    description:
      "Open Grok Desktop's detachable Preview window (the user can see it) and navigate to a URL. Returns a text snapshot of the page — read that. Do NOT use cloakbrowser, playwright, puppeteer, docker browsers, web_fetch, or curl. Qualified name: desktop-preview__preview_open.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "http(s) URL, e.g. http://localhost:5173 or https://example.com",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "preview_snapshot",
    description:
      "Read the Preview page as an accessibility tree (YAML with [ref=e5], including iframes as f1e12). Cheap. Qualified name: desktop-preview__preview_snapshot.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "preview_network",
    description:
      "Read the Preview request waterfall (status, type, size, timing, initiator). Debug lazy-load, 404s, cache. Qualified name: desktop-preview__preview_network.",
    inputSchema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          description:
            "all | doc | css | js | img | media | font | xhr | other",
        },
        afterLoad: {
          type: "boolean",
          description:
            "Only requests that started after the window load event (lazy / deferred).",
        },
        limit: {
          type: "number",
          description: "Max rows in the text dump (default 80, max 120).",
        },
      },
    },
  },
  {
    name: "preview_state",
    description:
      "Current Preview window URL, title, and whether it is open. Qualified name: desktop-preview__preview_state.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "preview_close",
    description:
      "Close the Grok Desktop Preview window. Qualified name: desktop-preview__preview_close.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "preview_click",
    description:
      "Click a control in the Preview window. Prefer ref from the latest snapshot (e.g. e3 or f1e12). x,y only when no ref exists (canvas / icon). Result includes a text snapshot. Qualified name: desktop-preview__preview_click.",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Snapshot ref such as e3 or f1e12" },
        selector: { type: "string", description: "CSS selector" },
        name: {
          type: "string",
          description: "Visible label, placeholder, or aria-label",
        },
        x: {
          type: "number",
          description: "Viewport X in CSS pixels. Only when no ref.",
        },
        y: {
          type: "number",
          description: "Viewport Y in CSS pixels. Only when no ref.",
        },
      },
    },
  },
  {
    name: "preview_hover",
    description:
      "Hover a control in the Preview window (menus that open on hover). Prefer snapshot ref. Result includes a text snapshot. Qualified name: desktop-preview__preview_hover.",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Snapshot ref such as e3" },
        selector: { type: "string" },
        name: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
      },
    },
  },
  {
    name: "preview_fill",
    description:
      "Type/fill a text field in the Preview window. Prefer snapshot ref. Result includes a text snapshot. Qualified name: desktop-preview__preview_fill.",
    inputSchema: {
      type: "object",
      properties: {
        value: { type: "string", description: "Text to enter" },
        ref: { type: "string", description: "Snapshot ref such as e2" },
        selector: { type: "string" },
        name: { type: "string" },
      },
      required: ["value"],
    },
  },
  {
    name: "preview_press",
    description:
      "Press a key in Preview (Enter to submit, Tab, Escape). Result includes a text snapshot. Qualified name: desktop-preview__preview_press.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Enter, Tab, or Escape" },
        ref: { type: "string" },
        selector: { type: "string" },
      },
    },
  },
  {
    name: "preview_fill_form",
    description:
      "Fill a login or other form in the Preview window (multiple fields) then submit. Result includes a text snapshot. Use this instead of PowerShell, curl, or CSRF. Qualified name: desktop-preview__preview_fill_form.",
    inputSchema: {
      type: "object",
      properties: {
        fields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              ref: { type: "string" },
              selector: { type: "string" },
              name: { type: "string" },
              value: { type: "string" },
            },
          },
          description: "[{ ref: \"e2\", value: \"user\" }, { ref: \"e3\", value: \"wrong\" }]",
        },
        submit: {
          description:
            "false to skip submit; or { ref/name } of the button; default press Enter",
        },
      },
      required: ["fields"],
    },
  },
];

export const SCREENSHOT_DISABLED_TEXT =
  "preview_screenshot is disabled (viewport JPEGs stay in context). Use preview_snapshot to read the page. The user can already see the Preview window.";

/** MCP header binding a Preview request to the owning chat BrowserWindow. */
export const PREVIEW_OWNER_HEADER = "X-Grok-Desktop-Window";

export function previewOwnerHeaders(windowId) {
  const id = Number.parseInt(String(windowId ?? ""), 10);
  return Number.isInteger(id) && id > 0
    ? [{ name: PREVIEW_OWNER_HEADER, value: String(id) }]
    : [];
}

export function previewOwnerHeaderStamped(headers) {
  if (!headers || typeof headers !== "object") return false;
  return Object.keys(headers).some(
    (key) => key.toLowerCase() === PREVIEW_OWNER_HEADER.toLowerCase(),
  );
}

export function previewOwnerIdFromHeaders(headers) {
  if (!headers || typeof headers !== "object") return null;
  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === PREVIEW_OWNER_HEADER.toLowerCase(),
  );
  const raw = Array.isArray(entry?.[1]) ? entry[1][0] : entry?.[1];
  const id = Number.parseInt(String(raw || ""), 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * @param {{ url?: string, token?: string }} api
 * @returns {object[]}
 */
export function previewMcpHttpServers(api, windowId) {
  const url = String(api?.url || "").replace(/\/$/, "");
  const token = String(api?.token || "");
  if (!url || !token) return [];
  return [
    {
      type: "http",
      name: "desktop-preview",
      url: `${url}/mcp`,
      headers: [
        { name: "Authorization", value: `Bearer ${token}` },
        ...previewOwnerHeaders(windowId),
      ],
    },
  ];
}

export function textResult(text, extra = []) {
  return {
    content: [{ type: "text", text: String(text) }, ...extra],
  };
}

/**
 * @param {(req: { method: string, path: string, body?: object }) => Promise<any>} dispatch
 */
async function fetchSnapshotText(dispatch) {
  const data = await dispatch({
    method: "POST",
    path: "/snapshot",
    body: {},
  });
  const text = String(data?.text || "").trim();
  const tokens = Math.ceil((data.chars || text.length) / 4);
  return { text, tokens };
}

async function withPreviewSnapshot(dispatch, lead) {
  try {
    const { text, tokens } = await fetchSnapshotText(dispatch);
    return textResult(
      `${lead}\n\n${text}\n\n(~${tokens} tokens of text. ${SNAPSHOT_NO_SCREENSHOT_HINT})`,
    );
  } catch (err) {
    return textResult(`${lead}\n\n(snapshot failed: ${err?.message || err})`);
  }
}

/**
 * @param {string} name
 * @param {Record<string, unknown>} [args]
 * @param {(req: { method: string, path: string, body?: object }) => Promise<any>} dispatch
 */
export async function callPreviewTool(name, args, dispatch) {
  switch (name) {
    case "preview_open": {
      const data = await dispatch({
        method: "POST",
        path: "/open",
        body: { url: args?.url || "" },
      });
      return withPreviewSnapshot(
        dispatch,
        `Preview open. url=${data.url || args?.url || ""} title=${data.title || "(loading)"}. The user can see this window.`,
      );
    }
    case "preview_snapshot": {
      const { text, tokens } = await fetchSnapshotText(dispatch);
      return textResult(
        `${text}\n\n(~${tokens} tokens of text. ${SNAPSHOT_NO_SCREENSHOT_HINT})`,
      );
    }
    case "preview_screenshot":
      return textResult(SCREENSHOT_DISABLED_TEXT);
    case "preview_network": {
      const data = await dispatch({
        method: "POST",
        path: "/network",
        body: args || {},
      });
      return textResult(data.text || JSON.stringify(data));
    }
    case "preview_state": {
      const data = await dispatch({ method: "GET", path: "/state" });
      return textResult(JSON.stringify(data));
    }
    case "preview_close": {
      const data = await dispatch({
        method: "POST",
        path: "/close",
        body: {},
      });
      return textResult(data.open ? "Preview still open" : "Preview closed");
    }
    case "preview_click": {
      const data = await dispatch({
        method: "POST",
        path: "/click",
        body: args || {},
      });
      return withPreviewSnapshot(dispatch, `Clicked. ${JSON.stringify(data)}`);
    }
    case "preview_fill": {
      const data = await dispatch({
        method: "POST",
        path: "/fill",
        body: args || {},
      });
      return withPreviewSnapshot(dispatch, `Filled. ${JSON.stringify(data)}`);
    }
    case "preview_press": {
      const data = await dispatch({
        method: "POST",
        path: "/press",
        body: args || {},
      });
      return withPreviewSnapshot(dispatch, `Pressed. ${JSON.stringify(data)}`);
    }
    case "preview_hover": {
      const data = await dispatch({
        method: "POST",
        path: "/hover",
        body: args || {},
      });
      return withPreviewSnapshot(dispatch, `Hovered. ${JSON.stringify(data)}`);
    }
    case "preview_interact":
    case "interact": {
      const action = String(args?.action || "click").toLowerCase();
      const path =
        action === "fill" || action === "type"
          ? "/fill"
          : action === "press" || action === "enter"
            ? "/press"
            : action === "hover"
              ? "/hover"
              : "/click";
      const data = await dispatch({
        method: "POST",
        path,
        body: args || {},
      });
      return withPreviewSnapshot(
        dispatch,
        `${action}. ${JSON.stringify(data)}`,
      );
    }
    case "preview_fill_form":
    case "fill_form": {
      const fields = Array.isArray(args?.fields) ? args.fields : [];
      if (!fields.length) {
        throw new Error(
          "preview_fill_form needs fields: [{ ref, value }] from the snapshot",
        );
      }
      const results = [];
      for (const field of fields) {
        results.push(
          await dispatch({
            method: "POST",
            path: "/fill",
            body: field || {},
          }),
        );
      }
      if (args?.submit !== false) {
        const submit =
          args?.submit && typeof args.submit === "object" ? args.submit : {};
        if (submit.ref || submit.name || submit.selector) {
          results.push(
            await dispatch({
              method: "POST",
              path: "/click",
              body: submit,
            }),
          );
        } else {
          results.push(
            await dispatch({
              method: "POST",
              path: "/press",
              body: { key: "Enter" },
            }),
          );
        }
      }
      return withPreviewSnapshot(
        dispatch,
        `Form filled. ${JSON.stringify({ ok: true, steps: results })}`,
      );
    }
    case "preview_type":
    case "type": {
      const data = await dispatch({
        method: "POST",
        path: "/fill",
        body: args || {},
      });
      return withPreviewSnapshot(dispatch, `Typed. ${JSON.stringify(data)}`);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
