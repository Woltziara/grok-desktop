/** Chat timestamps: 今天 13:36 */

export function sameCalendarDay(a, b) {
  const da = a instanceof Date ? a : new Date(a);
  const db = b instanceof Date ? b : new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

export function formatClockShort(at) {
  if (at == null || !Number.isFinite(at)) return "";
  try {
    return new Date(at).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return "";
  }
}

export function formatDayLabel(at) {
  try {
    const d = new Date(at);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const clock = formatClockShort(at);
    if (sameCalendarDay(d, today)) return clock ? `今天 ${clock}` : "今天";
    if (sameCalendarDay(d, yesterday)) return clock ? `昨天 ${clock}` : "昨天";
    const day = d.toLocaleDateString("zh-CN", {
      month: "numeric",
      day: "numeric",
      year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
    });
    return clock ? `${day} ${clock}` : day;
  } catch {
    return "";
  }
}

export function shouldShowTimeDivider(prevAt, at, gapMs = 5 * 60 * 1000) {
  if (at == null || !Number.isFinite(at)) return false;
  if (prevAt == null || !Number.isFinite(prevAt)) return true;
  if (!sameCalendarDay(prevAt, at)) return true;
  return at - prevAt >= gapMs;
}
