/**
 * Read per-model context windows from ~/.grok/models_cache.json
 * (same file the CLI uses).
 */
import fs from "node:fs";
import path from "node:path";
import { grokHomeDir } from "./grok-home.mjs";

/**
 * @returns {Record<string, number>}
 */
export function readModelContextWindows() {
  /** @type {Record<string, number>} */
  const out = {};
  const file = path.join(grokHomeDir(), "models_cache.json");
  if (!fs.existsSync(file)) return out;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const models = raw?.models;
    if (!models || typeof models !== "object") return out;
    for (const [id, entry] of Object.entries(models)) {
      const n = Number(entry?.info?.context_window);
      if (id && Number.isFinite(n) && n > 0) out[id] = n;
    }
  } catch {
    return out;
  }
  return out;
}

/**
 * @param {string | null | undefined} modelId
 * @param {Record<string, number> | null | undefined} windows
 */
export function contextWindowForModel(modelId, windows) {
  const id = String(modelId || "").trim();
  if (id && windows && windows[id] > 0) return windows[id];
  if (/^grok-4(\.|$)/i.test(id)) return 500_000;
  return 0;
}
