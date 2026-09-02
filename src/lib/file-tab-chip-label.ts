/**
 * Tab chip labels — adapted from RongleCat/grok-app (MIT)
 * `src/lib/fileTabChipLabel.ts`. Unique basename → name; collisions →
 * shortest distinguishing parent suffix.
 */

export type FileTabChipSource = {
  id: string;
  path?: string | null;
  name?: string | null;
};

function normalizePath(path?: string | null): string {
  return (path || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

export function fileTabBasename(
  path?: string | null,
  name?: string | null,
): string {
  const p = normalizePath(path);
  if (p) {
    const base = p.split("/").pop();
    if (base) return base;
  }
  const n = (name || "").trim();
  return n || "file";
}

function pathSegments(
  path?: string | null,
  name?: string | null,
): string[] {
  const p = normalizePath(path);
  if (p) return p.split("/").filter(Boolean);
  const n = fileTabBasename(path, name);
  return n ? [n] : [];
}

export function disambiguateFileTabLabels(
  tabs: readonly FileTabChipSource[],
): Map<string, string> {
  const out = new Map<string, string>();
  const items = tabs.map((t) => ({
    id: t.id,
    segs: pathSegments(t.path, t.name),
    base: fileTabBasename(t.path, t.name),
  }));

  const byBase = new Map<string, typeof items>();
  for (const it of items) {
    const arr = byBase.get(it.base) ?? [];
    arr.push(it);
    byBase.set(it.base, arr);
  }

  for (const it of items) {
    const group = byBase.get(it.base) ?? [it];
    if (group.length === 1 || it.segs.length === 0) {
      out.set(it.id, it.base);
      continue;
    }
    let take = 1;
    while (take <= it.segs.length) {
      const suffix = it.segs.slice(-take).join("/");
      const clash = group.some(
        (o) => o.id !== it.id && o.segs.slice(-take).join("/") === suffix,
      );
      if (!clash) {
        out.set(it.id, suffix);
        break;
      }
      take += 1;
    }
    if (!out.has(it.id)) {
      out.set(it.id, it.segs.join("/") || it.base);
    }
  }
  return out;
}

export function pathCrumbs(relPath?: string | null): string[] {
  const p = normalizePath(relPath);
  if (!p) return [];
  return p.split("/").filter(Boolean);
}
