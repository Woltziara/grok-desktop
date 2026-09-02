import { memo } from "react";
import type { BackgroundTask } from "../lib/background-tasks";
import type { ConnState } from "../lib/conn";
import { basen } from "../lib/path-utils";
import { Spinner } from "./BrandMark";

export const ChatTopbar = memo(function ChatTopbar({
  project,
  workspaceLabel,
  conn,
  statusLabel,
  isOpening,
  backgroundTasks,
  onOpenPreview,
  onStop,
  panelCollapsed,
  onTogglePanel,
}: {
  project: string;
  workspaceLabel?: string;
  conn: ConnState;
  statusLabel: string;
  isOpening: boolean;
  backgroundTasks: BackgroundTask[];
  onOpenPreview?: () => void;
  onStop: () => void;
  panelCollapsed?: boolean;
  onTogglePanel?: () => void;
}) {
  const runningTasks = backgroundTasks.filter((t) => t.status === "running");
  const connDot =
    conn === "online" || conn === "busy"
      ? conn === "busy"
        ? "busy"
        : "online"
      : conn === "error"
        ? "error"
        : "";

  return (
    <div className="topbar topbar-living">
      <div className="topbar-main">
        <div className="topbar-project">
          <div className="topbar-title">{workspaceLabel || basen(project)}</div>
        </div>
        <div className="topbar-actions row">
          {runningTasks.length > 0 ? (
            <span
              className="status-dot-only"
              title={`Tasks ${runningTasks.length}`}
              aria-label={`Tasks ${runningTasks.length}`}
            >
              <span className="status-dot busy" />
            </span>
          ) : null}
          <span
            className={`status-dot-only ${isOpening ? "status-pill-loading" : ""}`}
            title={statusLabel}
            aria-label={statusLabel}
          >
            {isOpening ? (
              <Spinner size={12} className="spinner status-spinner" />
            ) : (
              <span className={`status-dot ${connDot}`} />
            )}
          </span>
          {onOpenPreview ? (
            <button
              className="btn ghost btn-sm topbar-btn"
              type="button"
              title="在右边打开网页"
              onClick={onOpenPreview}
            >
              Preview
            </button>
          ) : null}
          {onTogglePanel ? (
            <button
              className={
                "topbar-side-toggle" + (panelCollapsed ? "" : " is-on")
              }
              type="button"
              title={panelCollapsed ? "打开侧栏" : "收起侧栏"}
              aria-label={panelCollapsed ? "打开侧栏" : "收起侧栏"}
              aria-pressed={!panelCollapsed}
              onClick={onTogglePanel}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                <rect
                  x="1.75"
                  y="3"
                  width="12.5"
                  height="10"
                  rx="2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
                <path d="M9.5 3v10" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            </button>
          ) : null}
          {conn === "busy" && (
            <button
              className="btn btn-sm topbar-btn danger"
              type="button"
              onClick={onStop}
            >
              Stop
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
