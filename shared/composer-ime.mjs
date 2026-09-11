/**
 * Chinese / Japanese IME: Enter while composing confirms a candidate,
 * it must not send the half-finished sentence.
 */

export function isImeComposing(event) {
  const native = event?.nativeEvent || event;
  if (!native) return false;
  if (native.isComposing === true) return true;
  if (native.keyCode === 229 || native.which === 229) return true;
  if (event?.key === "Process") return true;
  return false;
}

/**
 * @param {{
 *   key?: string,
 *   shiftKey?: boolean,
 *   metaKey?: boolean,
 *   ctrlKey?: boolean,
 *   nativeEvent?: { isComposing?: boolean, keyCode?: number, which?: number },
 *   isComposing?: boolean,
 *   keyCode?: number,
 *   which?: number,
 * }} event
 * @returns {"ignore" | "newline" | "now" | "submit"}
 */
export function composerEnterAction(event) {
  if (!event || event.key !== "Enter") return "ignore";
  if (isImeComposing(event)) return "ignore";
  if (event.shiftKey) return "newline";
  if (event.metaKey || event.ctrlKey) return "now";
  return "submit";
}
