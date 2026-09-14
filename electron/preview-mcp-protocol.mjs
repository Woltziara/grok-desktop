/**
 * In-process HTTP MCP JSON-RPC for Preview.
 */
import { dispatchPreviewApi } from "./preview-api.mjs";
import {
  PREVIEW_MCP_TOOLS,
  callPreviewTool,
} from "./preview-mcp-tools.mjs";

export { PREVIEW_MCP_TOOLS };

/**
 * Handle one MCP JSON-RPC message.
 * @returns {object | null} response to send, or null for notifications
 */
export async function handlePreviewMcpMessage(msg, context = {}) {
  if (!msg || typeof msg !== "object") return null;
  const { id, method, params } = msg;
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "desktop-preview", version: "0.1.0" },
      },
    };
  }
  if (method === "notifications/initialized" || method === "initialized") {
    return null;
  }
  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: { tools: PREVIEW_MCP_TOOLS },
    };
  }
  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }
  if (method === "tools/call") {
    try {
      const result = await callPreviewTool(
        params?.name,
        params?.arguments || {},
        (req) => dispatchPreviewApi({
          ...req,
          owner: context.owner || null,
          ownerStamped: Boolean(context.ownerStamped),
        }),
      );
      return { jsonrpc: "2.0", id, result };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [{ type: "text", text: err?.message || String(err) }],
        },
      };
    }
  }
  if (id !== undefined) {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  }
  return null;
}

export const PREVIEW_SESSION_RULE = [
  "You are in Grok Desktop. The Preview window is how the user sees and tests the UI.",
  "Read the page with desktop-preview__preview_snapshot (accessibility YAML with [ref=e5] / f1e12). preview_open, click, fill, hover, and press already return that text snapshot.",
  "Do not call preview_screenshot. For layout/CSS pixels the user sends a viewport capture from the Preview window (Send screenshot).",
  "Interact: desktop-preview__preview_click, desktop-preview__preview_fill, desktop-preview__preview_press, desktop-preview__preview_fill_form, desktop-preview__preview_hover. Pass ref like e5. Use x,y only when no ref exists.",
  "To test login: open or snapshot, then preview_fill_form with the username/password refs, or fill each field and preview_click the submit button.",
  "Never test a login or form with PowerShell, Invoke-WebRequest, curl, CSRF token scraping, or a raw HTTP POST. That bypasses the UI the user asked to see.",
  "Never launch a second browser (cloakbrowser, Docker Chromium, Playwright MCP, Puppeteer, web_fetch). Drive this Preview window only.",
  "For loading, lazy-load, 404s, or missing assets use desktop-preview__preview_network (afterLoad: true for requests after window load).",
].join(" ");
