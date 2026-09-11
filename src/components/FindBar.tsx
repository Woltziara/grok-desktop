import { useEffect, useRef } from "react";
import {
  searchTimeline,
  timelineHitKey,
} from "../../shared/chat-search.mjs";
import type { TimelineItem } from "../vite-env";

type TimelineHit = {
  id: string;
  kind: string;
  snippet: string;
  key?: string;
  nth?: number;
  offset?: number;
};

export function FindBar({
  open,
  query,
  onQuery,
  items,
  activeId,
  onClose,
  onJump,
}: {
  open: boolean;
  query: string;
  onQuery: (q: string) => void;
  items: TimelineItem[];
  activeId: string | null;
  onClose: () => void;
  onJump: (hit: { id: string; key: string }) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hits = searchTimeline(items, query) as TimelineHit[];

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const jump = (hit: TimelineHit) => {
    onJump({ id: String(hit.id), key: timelineHitKey(hit) });
  };

  return (
    <div className="find-bar" role="search">
      <input
        ref={inputRef}
        value={query}
        placeholder="在这场对话里找一句话"
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
            return;
          }
          if (e.key === "Enter" && hits.length) {
            e.preventDefault();
            const i = Math.max(
              0,
              hits.findIndex((h) => timelineHitKey(h) === activeId),
            );
            const next = e.shiftKey
              ? hits[(i - 1 + hits.length) % hits.length]
              : hits[(i + (activeId ? 1 : 0)) % hits.length];
            if (next) jump(next);
          }
        }}
      />
      <span className="find-bar-count">
        {query.trim() ? `${hits.length} 处` : ""}
      </span>
      <button type="button" className="btn ghost btn-sm" onClick={onClose}>
        关闭
      </button>
      {query.trim() && hits.length > 0 ? (
        <ul className="find-bar-hits">
          {hits.slice(0, 8).map((hit) => {
            const key = timelineHitKey(hit);
            return (
              <li key={key}>
                <button
                  type="button"
                  className={
                    "find-bar-hit" + (key === activeId ? " active" : "")
                  }
                  onClick={() => jump(hit)}
                >
                  <span className="find-bar-kind">
                    {hit.kind === "user" ? "你" : "回复"}
                    {hit.nth && hit.nth > 1 ? ` · ${hit.nth}` : ""}
                  </span>
                  <span>{hit.snippet}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
