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
  onBack,
  reconnecting = false,
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
  onBack?: () => void;
  reconnecting?: boolean;
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
          {onBack ? (
            <button
              type="button"
              className="btn ghost btn-sm topbar-btn"
              title="回到上一条对话"
              onClick={onBack}
            >
              上一条
            </button>
          ) : null}
          <div className="topbar-title">{workspaceLabel || basen(project)}</div>
          {reconnecting ? (
            <span className="topbar-reconnect">正在恢复连接…</span>
          ) : null}
        </div>
        <div className="topbar-actions row">
          <span
            className={`status-dot-only ${isOpening ? "status-pill-loading" : ""}`}
            title={
              runningTasks.length > 0
                ? conn === "busy"
                  ? `正在回复，还有 ${runningTasks.length} 个后台任务`
                  : `还有 ${runningTasks.length} 个后台任务`
                : statusLabel
            }
            aria-label={
              runningTasks.length > 0
                ? `后台任务 ${runningTasks.length}`
                : statusLabel
            }
          >
            {isOpening ? (
              <Spinner size={12} className="spinner status-spinner" />
            ) : (
              <span
                className={`status-dot ${conn === "busy" || runningTasks.length > 0 ? "busy" : connDot}`}
              />
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
