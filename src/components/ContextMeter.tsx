import { memo, useMemo } from "react";
import { contextMeter } from "../lib/usage";

export const ContextMeter = memo(function ContextMeter({
  used,
  windowSize,
  onCompress,
}: {
  used: number;
  windowSize: number;
  onCompress?: () => void;
}) {
  const meter = useMemo(
    () => contextMeter(used, windowSize),
    [used, windowSize],
  );
  if (!meter.label) return null;

  const r = 7;
  const c = 2 * Math.PI * r;
  const fill = (meter.usedPct ?? 0) / 100;
  const dash = c * (1 - fill);
  const clickable = Boolean(onCompress) && (meter.remainingPct ?? 100) <= 25;

  return (
    <button
      type="button"
      className={`context-meter tone-${meter.tone}${clickable ? " is-action" : ""}`}
      title={meter.tooltip}
      aria-label={meter.tooltip.replace(/\n/g, " · ")}
      disabled={!clickable}
      onClick={() => {
        if (clickable) onCompress?.();
      }}
    >
      {meter.usedPct != null ? (
        <svg
          className="context-meter-ring"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          aria-hidden
        >
          <circle className="track" cx="8" cy="8" r={r} />
          <circle
            className="fill"
            cx="8"
            cy="8"
            r={r}
            strokeDasharray={c}
            strokeDashoffset={dash}
          />
        </svg>
      ) : null}
      <span>{meter.label}</span>
    </button>
  );
});
