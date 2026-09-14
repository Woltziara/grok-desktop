/**
 * Prefer the in-memory timeline of a parked session over a disk snapshot.
 * Disk lags the live stream; replacing it looks like the turn was cut off.
 */

export function pickResumeTimeline(disk, cached, turnOpen) {
  const fromDisk = Array.isArray(disk) ? disk : [];
  const fromCache = Array.isArray(cached) ? cached : [];
  if (!fromCache.length) return fromDisk;
  if (turnOpen) return fromCache;
  if (fromCache.length >= fromDisk.length) return fromCache;
  return fromDisk;
}
