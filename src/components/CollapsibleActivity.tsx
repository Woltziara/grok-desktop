import { useState, type ReactNode } from "react";

/**
 * Codex-style inline activity: one muted line in the prose flow.
 * Click expands details in place. No card, no timestamp.
 */
export function InlineActivity({
  summary,
  className = "",
  children,
}: {
  summary: string;
  className?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const canExpand = Boolean(children);

  return (
    <div
      className={`inline-activity ${open ? "is-open" : "is-collapsed"} ${className}`.trim()}
    >
      <button
        type="button"
        className="inline-activity-toggle"
        aria-expanded={open}
        disabled={!canExpand}
        onClick={() => {
          if (!canExpand) return;
          setOpen((v) => !v);
        }}
      >
        <span className="inline-activity-summary">{summary}</span>
      </button>
      {open && canExpand ? (
        <div className="inline-activity-body">{children}</div>
      ) : null}
    </div>
  );
}

/** @deprecated Use InlineActivity. */
export const CollapsibleActivity = InlineActivity;
