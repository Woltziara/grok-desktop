/** ACP descriptor for the one loopback Preview MCP server. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { grokHomeDir } from "./grok-home.mjs";
import { previewApiAddress } from "./preview-api.mjs";
import { previewMcpHttpServers } from "./preview-mcp-tools.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_MARKER = "managed-by: grok-desktop-preview";
const WEB_PRO_MARKER = "managed-by: grok-desktop-web-pro";

export function desktopPreviewMcpServers(windowId, scopeId = "") {
  return previewMcpHttpServers(previewApiAddress(), windowId, scopeId);
}

function installManagedSkill(name, relative, marker) {
  const src = path.join(__dirname, relative);
  const dest = path.join(grokHomeDir(), "skills", name, "SKILL.md");
  try {
    const body = fs.readFileSync(src, "utf8");
    const stamped = body.includes(marker) ? body : `${body.trimEnd()}\n\n<!-- ${marker} -->\n`;
    if (fs.existsSync(dest) && !fs.readFileSync(dest, "utf8").includes(marker)) return;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!fs.existsSync(dest) || fs.readFileSync(dest, "utf8") !== stamped) fs.writeFileSync(dest, stamped);
  } catch {
    /* ~/.grok may be unavailable */
  }
}

/** Keep only the Desktop-managed copies current; never overwrite a user copy. */
export function installDesktopPreviewSkill() {
  installManagedSkill("desktop-preview", "preview/SKILL.md", SKILL_MARKER);
  installManagedSkill("web-pro-handoff", "web-pro/SKILL.md", WEB_PRO_MARKER);
}
