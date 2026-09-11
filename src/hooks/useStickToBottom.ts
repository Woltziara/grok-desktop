import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  distanceFromBottom,
  isNearBottom,
  shouldHonorScrollPosition,
  wheelWantsEarlierContent,
} from "../../shared/stick-to-bottom.mjs";
import {
  canApplyReadingRestore,
  shouldSaveReadingPosition,
} from "../../shared/reading-restore.mjs";

function fromBottom(el: HTMLElement): number {
  return distanceFromBottom(el.scrollHeight, el.scrollTop, el.clientHeight);
}

function nearBottom(el: HTMLElement): boolean {
  return isNearBottom(fromBottom(el));
}

/**
 * Chat-style stick-to-bottom for a scroll container.
 *
 * - Follows the tail while the user is pinned (after send, or back at bottom).
 * - Wheel / trackpad / touch toward earlier content unpins immediately,
 *   even while a fast stream is writing scrollTop.
 * - Re-pins only when the user returns to the tail, or on pinToBottom().
 * Pair with `overflow-anchor: none` on the scroller.
 */
export function useStickToBottom(
  scrollerRef: RefObject<HTMLElement | null>,
  /** Fingerprint of content that should trigger a stick pass (not idle polls). */
  contentKey: string | number,
  /** Project/session switch — re-pin and rebind the listener. */
  resetKey: string | number,
  opts?: {
    restoreTop?: number | null;
    onScrollPosition?: (top: number, stuck: boolean) => void;
  },
): {
  /** Call when the user intentionally wants the live tail (e.g. send). */
  pinToBottom: () => void;
  stuckToBottom: boolean;
  hasNewContent: boolean;
  clearNewContent: () => void;
} {
  const restoreTop = opts?.restoreTop;
  const restoreTopRef = useRef(restoreTop);
  restoreTopRef.current = restoreTop;
  const onScrollPosition = opts?.onScrollPosition;
  const onScrollPositionRef = useRef(onScrollPosition);
  onScrollPositionRef.current = onScrollPosition;
  const [stuckToBottom, setStuckToBottom] = useState(true);
  const [hasNewContent, setHasNewContent] = useState(false);
  const seenResetRef = useRef(resetKey);
  const stickRef = useRef(true);
  const pendingRestoreRef = useRef<number | null>(null);
  /**
   * Nested stick writes during fast streams: count (not bool) so an early
   * clear cannot re-enable the scroll listener mid-flight of a later write.
   */
  const ignoreScrollRef = useRef(0);

  const scrollToBottom = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (!stickRef.current) return;
    ignoreScrollRef.current += 1;
    el.scrollTop = el.scrollHeight;
    // Double rAF: let the browser dispatch scroll events from this write first.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        ignoreScrollRef.current = Math.max(0, ignoreScrollRef.current - 1);
      });
    });
  }, [scrollerRef]);

  const pinToBottom = useCallback(() => {
    stickRef.current = true;
    setStuckToBottom(true);
    setHasNewContent(false);
    scrollToBottom();
  }, [scrollToBottom]);

  const clearNewContent = useCallback(() => setHasNewContent(false), []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const onScroll = () => {
      const distance = fromBottom(el);
      if (!shouldHonorScrollPosition(ignoreScrollRef.current, distance)) {
        return;
      }
      const stuck = isNearBottom(distance);
      stickRef.current = stuck;
      setStuckToBottom(stuck);
      if (stuck) setHasNewContent(false);
      if (
        shouldSaveReadingPosition({
          ignoreScroll: ignoreScrollRef.current > 0,
          pendingRestore: pendingRestoreRef.current != null,
          scrollTop: el.scrollTop,
        })
      ) {
        onScrollPositionRef.current?.(el.scrollTop, stuck);
      }
    };

    const onWheel = (event: WheelEvent) => {
      if (wheelWantsEarlierContent(event.deltaY)) {
        const nested = nestedScroller(event.target, el);
        if (nested && nested.scrollTop > 0) return;
        stickRef.current = false;
        return;
      }
      if (nearBottom(el)) stickRef.current = true;
    };

    let touchY: number | null = null;
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY;
      if (touchY == null || y == null) return;
      // Finger moving down → earlier content.
      if (y - touchY > 4) stickRef.current = false;
      touchY = y;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "PageUp" || event.key === "Home" || event.key === "ArrowUp") {
        stickRef.current = false;
      }
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("keydown", onKeyDown);
    const saved = restoreTopRef.current;
    if (typeof saved === "number" && saved > 8) {
      pendingRestoreRef.current = saved;
      stickRef.current = false;
      setStuckToBottom(false);
      setHasNewContent(false);
      if (canApplyReadingRestore(saved, el.scrollHeight, el.clientHeight)) {
        ignoreScrollRef.current += 1;
        el.scrollTop = saved;
        requestAnimationFrame(() => {
          ignoreScrollRef.current = Math.max(0, ignoreScrollRef.current - 1);
        });
      }
    } else {
      pendingRestoreRef.current = null;
      stickRef.current = true;
      setStuckToBottom(true);
    }
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("keydown", onKeyDown);
    };
  }, [resetKey, scrollerRef]);

  // Stick before paint so fast chunks never leave a "not at bottom" frame.
  // Do not re-pin here: a user who just scrolled up may still be near the
  // tail for a few tokens; stealing the viewport is the resist bug.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    const pending = pendingRestoreRef.current;
    if (pending != null && el) {
      stickRef.current = false;
      setStuckToBottom(false);
      if (canApplyReadingRestore(pending, el.scrollHeight, el.clientHeight)) {
        ignoreScrollRef.current += 1;
        el.scrollTop = pending;
        pendingRestoreRef.current = null;
        seenResetRef.current = resetKey;
        requestAnimationFrame(() => {
          ignoreScrollRef.current = Math.max(0, ignoreScrollRef.current - 1);
        });
      }
      return;
    }
    if (!stickRef.current) {
      if (seenResetRef.current === resetKey) setHasNewContent(true);
      else seenResetRef.current = resetKey;
      return;
    }
    seenResetRef.current = resetKey;
    scrollToBottom();
  }, [contentKey, resetKey, scrollToBottom, scrollerRef]);

  return { pinToBottom, stuckToBottom, hasNewContent, clearNewContent };
}

function nestedScroller(target: EventTarget | null, root: HTMLElement): HTMLElement | null {
  if (!(target instanceof HTMLElement) || target === root) return null;
  const nested = target.closest("pre, textarea");
  if (!(nested instanceof HTMLElement) || nested === root) return null;
  if (nested.scrollHeight <= nested.clientHeight + 1) return null;
  return nested;
}
