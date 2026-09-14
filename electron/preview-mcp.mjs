/** ACP descriptor for the one loopback Preview MCP server. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { grokHomeDir } from "./grok-home.mjs";
import { previewApiAddress } from "./preview-api.mjs";
import { previewMcpHttpServers } from "./preview-mcp-tools.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_MARKER = "managed-by: grok-desktop-preview";

export function desktopPreviewMcpServers(windowId, scopeId = "") {
  return previewMcpHttpServers(previewApiAddress(), windowId, scopeId);
}

/** Keep only the Desktop-managed copy current; never overwrite a user copy. */
export function installDesktopPreviewSkill() {
  const src = path.join(__dirname, "preview", "SKILL.md");
  const dest = path.join(grokHomeDir(), "skills", "desktop-preview", "SKILL.md");
  try {
    const body = fs.readFileSync(src, "utf8");
    const stamped = body.includes(SKILL_MARKER) ? body : `${body.trimEnd()}\n\n<!-- ${SKILL_MARKER} -->\n`;
    if (fs.existsSync(dest) && !fs.readFileSync(dest, "utf8").includes(SKILL_MARKER)) return;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!fs.existsSync(dest) || fs.readFileSync(dest, "utf8") !== stamped) fs.writeFileSync(dest, stamped);
  } catch {
    /* ~/.grok may be unavailable */
  }
}
