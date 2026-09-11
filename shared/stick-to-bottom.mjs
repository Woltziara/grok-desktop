/**
 * Chat stick-to-bottom helpers.
 * Streaming must follow the tail only while the user is pinned.
 * User intent to read earlier content always wins over programmatic stick.
 */

/** Within this many px of the tail we treat the viewport as pinned. */
export const NEAR_BOTTOM_PX = 32;

/**
 * During a programmatic stick write we ignore tiny scroll events, but if
 * the viewport is farther than this from the tail, it was the user.
 */
export const FAR_FROM_BOTTOM_PX = 64;

export function distanceFromBottom(scrollHeight, scrollTop, clientHeight) {
  const h = Number(scrollHeight) || 0;
  const t = Number(scrollTop) || 0;
  const c = Number(clientHeight) || 0;
  return h - t - c;
}

export function isNearBottom(distance, nearPx = NEAR_BOTTOM_PX) {
  return distance <= nearPx;
}

/** Wheel/trackpad: negative deltaY means the user wants earlier content. */
export function wheelWantsEarlierContent(deltaY) {
  return Number(deltaY) < 0;
}

/**
 * Should this scroll position update the pin flag?
 * Programmatic stick writes fire `scroll` and must not unlock.
 * A user drag/trackpad that actually left the tail must still unlock,
 * even while those writes are in flight.
 */
export function shouldHonorScrollPosition(
  ignoreCount,
  distance,
  farPx = FAR_FROM_BOTTOM_PX,
) {
  if (ignoreCount <= 0) return true;
  return distance > farPx;
}
