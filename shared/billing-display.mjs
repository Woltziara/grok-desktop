/**
 * Human remaining-quota line from ACP x.ai/billing.
 */

function num(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function centsVal(c) {
  if (c == null) return null;
  if (typeof c === "number") return c;
  if (typeof c === "object" && c.val != null) return num(c.val);
  return null;
}

function periodEnd(config) {
  const current = config?.currentPeriod || config?.current_period;
  return (
    current?.end ||
    config?.currentPeriodEnd ||
    config?.billingPeriodEnd ||
    config?.billing_period_end ||
    null
  );
}

/**
 * @param {any} raw
 * @returns {{
 *   kind: "percent" | "unknown",
 *   usedPct: number | null,
 *   remainingPct: number | null,
 *   periodEnd: string | null,
 *   line: string,
 * }}
 */
export function remainingFromBilling(raw) {
  const body =
    raw?.result && typeof raw.result === "object" ? raw.result : raw;
  const config = body?.config && typeof body.config === "object" ? body.config : body;
  if (!config || typeof config !== "object") {
    return {
      kind: "unknown",
      usedPct: null,
      remainingPct: null,
      periodEnd: null,
      line: "暂时查不到额度",
    };
  }
  let usedPct = num(
    config.creditUsagePercent ?? config.credit_usage_percent,
  );
  if (usedPct == null) {
    const limit = centsVal(config.monthlyLimit ?? config.monthly_limit);
    const used = centsVal(config.used);
    if (limit && limit > 0 && used != null) {
      usedPct = (used / limit) * 100;
    }
  }
  if (usedPct == null) {
    return {
      kind: "unknown",
      usedPct: null,
      remainingPct: null,
      periodEnd: periodEnd(config),
      line: "暂时查不到额度",
    };
  }
  const clamped = Math.max(0, Math.min(100, usedPct));
  const remaining = Math.max(0, Math.min(100, 100 - clamped));
  const rounded = Math.round(remaining);
  let line;
  if (remaining <= 0.5) line = "额度已用完";
  else if (remaining >= 99.5) line = "本周期额度几乎没用";
  else line = `本周期大约还剩 ${rounded}%`;
  return {
    kind: "percent",
    usedPct: clamped,
    remainingPct: remaining,
    periodEnd: periodEnd(config),
    line,
  };
}
