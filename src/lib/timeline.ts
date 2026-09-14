// @ts-nocheck — imports shared pure ESM without package types
import type { TimelineItem } from "../vite-env";
import {
  applySessionUpdate as applyShared,
  applySessionInterjection as applyInterjectionShared,
  appendWorkedIfNeeded as appendWorkedShared,
  finalizeOpenTools as finalizeShared,
  uid as sharedUid,
  formatOptionLabel as formatShared,
  shouldApplySessionInterjection as shouldApplyInterjectionShared,
} from "../../shared/session-timeline.mjs";

export function uid(prefix = "id") {
  return sharedUid(prefix);
}

export function applySessionUpdate(
  items: TimelineItem[],
  params: any,
): TimelineItem[] {
  return applyShared(items, params);
}

export function applySessionInterjection(
  items: TimelineItem[],
  payload: { text?: unknown; interjectionId?: unknown },
): TimelineItem[] {
  return applyInterjectionShared(items, payload);
}

export function shouldApplySessionInterjection(
  payload: { sessionId?: unknown } | null | undefined,
  opts: { opening?: boolean; sessionId?: string | null },
): boolean {
  return shouldApplyInterjectionShared(payload, opts);
}

/** Close open tool cards when session/prompt returns or the user cancels. */
export function finalizeOpenTools(
  items: TimelineItem[],
  status: string = "completed",
): TimelineItem[] {
  return finalizeShared(items, status);
}

/** Append TUI `Worked for` once when a turn ends. */
export function appendWorkedIfNeeded(
  items: TimelineItem[],
  at: number,
  elapsedMs?: number,
): TimelineItem[] {
  return appendWorkedShared(items, at, elapsedMs);
}

export function formatOptionLabel(optionId: string, name?: string) {
  return formatShared(optionId, name);
}
