/** Pure Preview lifecycle guards, kept Electron-free for regression tests. */
export function shouldApplyDeviceEmulation(url, viewport) {
  return Boolean(viewport?.width && url && url !== "about:blank");
}
