export type AppTheme = "dark" | "light";

export function applyTheme(theme: AppTheme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export function readStoredTheme(): AppTheme {
  try {
    const t = localStorage.getItem("grok-desktop-theme");
    if (t === "dark") return "dark";
    return "light";
  } catch {
    return "light";
  }
}

export function storeTheme(theme: AppTheme): void {
  try {
    localStorage.setItem("grok-desktop-theme", theme);
  } catch {
    /* ignore */
  }
}
