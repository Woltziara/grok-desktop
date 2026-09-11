import { useEffect, useMemo, useRef, useState } from "react";
import { searchByTitle } from "../../shared/title-search.mjs";
import type { SessionSummary } from "../vite-env";
import { folderDisplayName } from "../../shared/sidebar-chats.mjs";

export type PaletteCommand = {
  id: string;
  title: string;
  subtitle?: string;
  run: () => void;
};

export function CommandPalette({
  open,
  sessions,
  projects = [],
  commands,
  onClose,
  onOpenSession,
  onOpenProject,
}: {
  open: boolean;
  sessions: SessionSummary[];
  projects?: Array<{ cwd: string; name: string }>;
  commands: PaletteCommand[];
  onClose: () => void;
  onOpenSession: (opts: {
    mode: "new" | "resume";
    sessionId?: string;
    cwd?: string;
  }) => void;
  onOpenProject?: (cwd: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setIndex(0);
      return;
    }
    const t = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(t);
  }, [open]);

  const rows = useMemo(() => {
    const sessionRows = sessions.map((s) => ({
      id: `s:${s.cwd}:${s.id}`,
      kind: "session" as const,
      title: s.title || "新对话",
      subtitle: folderDisplayName(s.cwd),
      session: s,
    }));
    const commandRows = commands.map((c) => ({
      id: `c:${c.id}`,
      kind: "command" as const,
      title: c.title,
      subtitle: c.subtitle || "操作",
      command: c,
    }));
    const projectRows = projects.map((p) => ({
      id: `p:${p.cwd}`,
      kind: "project" as const,
      title: p.name,
      subtitle: p.cwd,
      project: p,
    }));
    const all = [...commandRows, ...projectRows, ...sessionRows];
    return searchByTitle(all, query, { keys: ["title", "subtitle"], limit: 24 });
  }, [sessions, projects, commands, query]);

  useEffect(() => {
    if (index >= rows.length) setIndex(Math.max(0, rows.length - 1));
  }, [index, rows.length]);

  if (!open) return null;

  const run = (i: number) => {
    const hit = rows[i]?.item;
    if (!hit) return;
    if (hit.kind === "command") hit.command?.run();
    else if (hit.kind === "project" && hit.project) {
      onOpenProject?.(hit.project.cwd);
    } else if (hit.session) {
      onOpenSession({
        mode: "resume",
        sessionId: hit.session.id,
        cwd: hit.session.cwd,
      });
    }
    onClose();
  };

  return (
    <div className="palette-scrim" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label="搜索对话和操作"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          placeholder="搜索对话、项目或操作"
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((n) => (rows.length ? (n + 1) % rows.length : 0));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((n) =>
                rows.length ? (n - 1 + rows.length) % rows.length : 0,
              );
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(index);
            }
          }}
        />
        <ul className="palette-list">
          {rows.length === 0 ? (
            <li className="palette-empty">没有匹配的对话或操作</li>
          ) : (
            rows.map(
              (
                row: {
                  item: { id: string; title: string; subtitle?: string };
                  snippet: string;
                },
                i: number,
              ) => (
              <li key={row.item.id}>
                <button
                  type="button"
                  className={"palette-item" + (i === index ? " active" : "")}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => run(i)}
                >
                  <span className="palette-item-title">{row.item.title}</span>
                  <span className="palette-item-sub">
                    {row.snippet || row.item.subtitle}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
