/**
 * Catalog of project folders on this machine.
 * Adding a folder must not imply opening it as the live workspace.
 */

export const RECENT_PROJECTS_MAX = 24;

export function nextRecentProjects(list, cwd, max = RECENT_PROJECTS_MAX) {
  const p = String(cwd || "").trim();
  const cur = Array.isArray(list) ? list.map(String) : [];
  if (!p) return cur.slice(0, max);
  return [p, ...cur.filter((x) => x !== p)].slice(0, max);
}
