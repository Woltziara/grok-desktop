/**
 * When the user pastes a lone file:// URL or absolute path, the agent
 * otherwise sees only a string and does nothing. Expand it into the file body.
 */

export function parseSoloLocalPath(text: string): string | null {
  const t = String(text || "").trim();
  if (!t || /[\s\n]/.test(t)) return null;

  if (/^file:/i.test(t)) {
    try {
      const url = new URL(t);
      if (url.protocol !== "file:") return null;
      let p = decodeURIComponent(url.pathname);
      if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
      return p || null;
    } catch {
      return null;
    }
  }

  if (t.startsWith("/") && /\.[A-Za-z0-9]{1,12}$/.test(t)) return t;
  return null;
}

export function formatInlinedFilePrompt(path: string, body: string): string {
  const name = path.split(/[/\\]/).filter(Boolean).pop() || path;
  return `请按照下面这份文件里的说明执行：\n\n--- ${name} ---\n${body}`;
}
