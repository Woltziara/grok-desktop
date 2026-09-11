/**
 * Read/write Grok memory files under ~/.grok/memory and [memory] enabled.
 */
import fs from "node:fs";
import path from "node:path";
import { configTomlPath, grokHomeDir } from "./grok-home.mjs";
import {
  memoryEnabledFromToml,
  setMemoryEnabledInToml,
} from "../shared/memory-config.mjs";
import {
  parseMemoryMarkdown,
  pickWorkspaceSlug,
  removeMemoryEntryFromMarkdown,
} from "../shared/memory-files.mjs";

function memoryRoot() {
  return path.join(grokHomeDir(), "memory");
}

function assertInsideMemory(abs) {
  const root = path.resolve(memoryRoot());
  const resolved = path.resolve(abs);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(prefix)) {
    throw new Error("Memory path is outside ~/.grok/memory");
  }
  return resolved;
}

function relToMemory(abs) {
  const root = path.resolve(memoryRoot());
  return path.relative(root, abs).replace(/\\/g, "/");
}

export function getMemoryEnabled() {
  const p = configTomlPath();
  if (!fs.existsSync(p)) return false;
  try {
    return memoryEnabledFromToml(fs.readFileSync(p, "utf8"));
  } catch {
    return false;
  }
}

export function setMemoryEnabled(enabled) {
  const p = configTomlPath();
  let current = "";
  if (fs.existsSync(p)) {
    current = fs.readFileSync(p, "utf8");
  }
  const next = setMemoryEnabledInToml(current, Boolean(enabled));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, next, "utf8");
  fs.renameSync(tmp, p);
  return getMemoryEnabled();
}

function readIfFile(abs) {
  try {
    const st = fs.statSync(abs);
    if (!st.isFile()) return "";
    return fs.readFileSync(abs, "utf8");
  } catch {
    return "";
  }
}

function listSessionFiles(dir) {
  const sessions = path.join(dir, "sessions");
  if (!fs.existsSync(sessions)) return [];
  let names = [];
  try {
    names = fs.readdirSync(sessions);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(".md"))
    .map((n) => {
      const abs = path.join(sessions, n);
      let mtime = 0;
      try {
        mtime = fs.statSync(abs).mtimeMs;
      } catch {
        mtime = 0;
      }
      return { name: n, abs, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

/**
 * @param {string | null | undefined} projectPath
 */
export function listMemoryEntries(projectPath) {
  const root = memoryRoot();
  const enabled = getMemoryEnabled();
  /** @type {Array<ReturnType<typeof parseMemoryMarkdown>[number] & { label: string }>} */
  const entries = [];
  if (!fs.existsSync(root)) {
    return { enabled, entries };
  }

  const globalAbs = assertInsideMemory(path.join(root, "MEMORY.md"));
  const globalMd = readIfFile(globalAbs);
  for (const e of parseMemoryMarkdown(globalMd, {
    file: "MEMORY.md",
    scope: "global",
  })) {
    entries.push({ ...e, label: "所有项目都会用到" });
  }

  let slugs = [];
  try {
    slugs = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    slugs = [];
  }
  const preferred = pickWorkspaceSlug(slugs, projectPath);
  const ordered = preferred
    ? [preferred, ...slugs.filter((s) => s !== preferred)]
    : slugs;

  for (const slug of ordered) {
    const dir = assertInsideMemory(path.join(root, slug));
    const memAbs = path.join(dir, "MEMORY.md");
    const isCurrent = slug === preferred;
    const label = isCurrent ? "这个项目" : `其他项目（${slug}）`;
    const md = readIfFile(memAbs);
    const rel = relToMemory(memAbs);
    for (const e of parseMemoryMarkdown(md, { file: rel, scope: "workspace" })) {
      entries.push({ ...e, label });
    }
    if (!isCurrent) continue;
    for (const sess of listSessionFiles(dir).slice(0, 20)) {
      const relSess = relToMemory(sess.abs);
      const body = readIfFile(sess.abs).trim();
      if (!body) continue;
      entries.push({
        id: `${relSess}::file`,
        file: relSess,
        scope: "session",
        heading: "",
        text: body.slice(0, 400),
        wholeFile: true,
        label: "过去的对话纪要",
      });
    }
  }

  return { enabled, entries };
}

/**
 * @param {string} entryId
 */
export function deleteMemoryEntry(entryId) {
  const id = String(entryId || "");
  const sep = id.lastIndexOf("::");
  if (sep < 0) throw new Error("Unknown memory item");
  const rel = id.slice(0, sep);
  const abs = assertInsideMemory(path.join(memoryRoot(), rel));
  if (id.endsWith("::file")) {
    fs.unlinkSync(abs);
    return { ok: true };
  }
  if (!fs.existsSync(abs)) throw new Error("Memory file missing");
  const scope = rel === "MEMORY.md" ? "global" : "workspace";
  const current = fs.readFileSync(abs, "utf8");
  const next = removeMemoryEntryFromMarkdown(current, id, {
    file: rel,
    scope,
  });
  if (next == null) throw new Error("Could not find that memory item");
  if (!next.trim()) {
    fs.writeFileSync(abs, "", "utf8");
  } else {
    fs.writeFileSync(abs, next, "utf8");
  }
  return { ok: true };
}
