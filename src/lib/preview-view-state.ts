const view = new Map<string, { scrollTop: number }>();

export function savePreviewScroll(path: string, scrollTop: number) {
  if (!path) return;
  view.set(path, { scrollTop: Math.max(0, Math.round(scrollTop)) });
}

export function readPreviewScroll(path: string): number | null {
  const row = view.get(path);
  return row ? row.scrollTop : null;
}
