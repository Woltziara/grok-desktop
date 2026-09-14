import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";
import {
  latestUserTurnId,
  shouldRevealTurnOnReturn,
  timelineGrewSince,
} from "../../shared/reveal-turn.mjs";
import type { TimelineItem } from "../vite-env";

function revealLatest(items: TimelineItem[], revealStart: (el: HTMLElement) => void) {
  const id = latestUserTurnId(items);
  const user = id ? document.getElementById(`msg-${id}`) : null;
  if (!(user instanceof HTMLElement)) return false;
  revealStart(user);
  return true;
}

/**
 * After send, park on the new reply's head. If the window was away and the
 * timeline grew, jump down to that head on return — not the old reading spot.
 */
export function useRevealLatestTurn(opts: {
  items: TimelineItem[];
  scrollerRef: RefObject<HTMLElement | null>;
  revealStart: (el: HTMLElement) => void;
  resetKey: string;
}): { markPendingReveal: () => void; revealNow: () => boolean } {
  const { items, scrollerRef, revealStart, resetKey } = opts;
  const pendingRef = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const revealStartRef = useRef(revealStart);
  revealStartRef.current = revealStart;
  const snapshotRef = useRef<{ lastId: string; length: number } | null>(null);
  const resetKeyRef = useRef(resetKey);

  const markPendingReveal = useCallback(() => {
    pendingRef.current = true;
  }, []);

  const revealNow = useCallback(
    () => revealLatest(itemsRef.current, revealStartRef.current),
    [],
  );

  useLayoutEffect(() => {
    if (resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey;
      pendingRef.current = false;
      snapshotRef.current = null;
      return;
    }
    if (!pendingRef.current) return;
    if (revealLatest(items, revealStartRef.current)) pendingRef.current = false;
  }, [items, resetKey]);

  useEffect(() => {
    const snap = () => {
      const list = itemsRef.current;
      const last = list[list.length - 1];
      snapshotRef.current = {
        lastId: last?.id ? String(last.id) : "",
        length: list.length,
      };
    };
    const catchUp = () => {
      const shot = snapshotRef.current;
      if (!shot) return;
      const list = itemsRef.current;
      if (!timelineGrewSince(shot, list)) {
        snapshotRef.current = null;
        return;
      }
      const id = latestUserTurnId(list);
      const user = id ? document.getElementById(`msg-${id}`) : null;
      const scroller = scrollerRef.current;
      if (!(user instanceof HTMLElement) || !scroller) return;
      if (
        !shouldRevealTurnOnReturn(
          user.getBoundingClientRect().top,
          scroller.getBoundingClientRect().top,
        )
      ) {
        snapshotRef.current = null;
        return;
      }
      snapshotRef.current = null;
      revealStartRef.current(user);
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") snap();
      else catchUp();
    };
    window.addEventListener("blur", snap);
    window.addEventListener("focus", catchUp);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("blur", snap);
      window.removeEventListener("focus", catchUp);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [resetKey, scrollerRef]);

  return { markPendingReveal, revealNow };
}
