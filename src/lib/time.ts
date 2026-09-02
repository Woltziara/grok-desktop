/** Clock-style timestamps (CLI-like): time only, date when the day changes. */

export {
  formatClockShort,
  formatDayLabel,
  sameCalendarDay,
  shouldShowTimeDivider,
} from "../../shared/time.mjs";

/** Sidebar chat list: "Jul 27, 3:45 PM" from ISO strings. */
export function formatSessionWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  try {
    return new Date(t).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function formatClock(at: number | undefined | null): string {
  if (at == null || !Number.isFinite(at)) return "";
  try {
    return new Date(at).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

/** Full datetime for hover title. */
export function formatFullTimestamp(at: number | undefined | null): string {
  if (at == null || !Number.isFinite(at)) return "";
  try {
    return new Date(at).toLocaleString();
  } catch {
    return "";
  }
}
