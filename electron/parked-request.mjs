/** Main-owned reverse requests that can be rehydrated after renderer reload. */

export function wrapParked(settle, params) {
  return { settle, params };
}

export function settleParked(entry, decision) {
  if (!entry || typeof entry !== "object") return false;
  if (typeof entry.settle !== "function") return false;
  entry.settle(decision);
  return true;
}

export function listParked(map) {
  if (!map || typeof map.entries !== "function") return [];
  const out = [];
  for (const [reqId, entry] of map.entries()) {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.settle !== "function"
    ) {
      continue;
    }
    out.push({ reqId: String(reqId), params: entry.params });
  }
  return out;
}
