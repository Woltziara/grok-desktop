import { memo } from "react";

export type ScheduledLoop = {
  id: string;
  prompt: string;
  schedule: string;
  nextFireAt?: string | null;
};

export const ScheduledLoopsBar = memo(function ScheduledLoopsBar({
  loops,
  busy,
  onStop,
}: {
  loops: ScheduledLoop[];
  busy?: boolean;
  onStop: (id: string) => void;
}) {
  if (!loops.length) return null;
  return (
    <div className="scheduled-bar" role="status">
      <div className="scheduled-bar-label">定时还在转</div>
      <ul className="scheduled-bar-list">
        {loops.map((loop) => (
          <li key={loop.id} className="scheduled-bar-item">
            <span className="scheduled-bar-prompt" title={loop.prompt}>
              {loop.schedule ? `${loop.schedule} · ` : ""}
              {loop.prompt}
            </span>
            <button
              type="button"
              className="btn ghost btn-sm"
              disabled={busy}
              onClick={() => onStop(loop.id)}
            >
              停止
            </button>
          </li>
        ))}
      </ul>
      <p className="scheduled-bar-hint">关掉窗口后，定时会停。</p>
    </div>
  );
});
