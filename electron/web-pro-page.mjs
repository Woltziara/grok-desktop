/** Classify ChatGPT Preview snapshots. No second assignment store, no file writes. */

export const WEB_PRO_URL = 'https://chatgpt.com/';

function quotedControls(text, roles) {
  const names = [];
  const re = new RegExp(`^[ \\t]*- (?:${roles}) "([^"]+)"`, 'gmi');
  let match;
  while ((match = re.exec(String(text || '')))) names.push(match[1]);
  return names;
}

export function snapshotNeedsLogin(text) {
  const body = String(text || '');
  const heading = /heading "[^"]*(登录或注册|登录|注册|Log in|Sign up|Sign in|Create an account)[^"]*"/i.test(body);
  const form = /form "[^"]*(登录或注册|Log in|Sign up|Sign in)[^"]*"/i.test(body);
  const buttons = quotedControls(body, 'button').some(n =>
    /使用 Google 账户继续|使用 Apple 账户继续|Continue with Google|Continue with Apple|Log in|Sign up|登录|注册/.test(n),
  );
  return heading || form || (buttons && /Email address|电子邮件|验证码|Passkey|phone number|电话号码/i.test(body));
}

export function snapshotHasComposer(text) {
  const body = String(text || '');
  if (snapshotNeedsLogin(body)) return false;
  return /Ask anything|What can I help|Message ChatGPT|prompt-textarea|有什么可以帮忙|问问任何事/i.test(body);
}

function looksLikeUpgrade(name) {
  return /upgrade|subscribe|plus|升级|订阅|开通/.test(String(name || ''));
}

function looksLikeProModel(name) {
  const n = String(name || '');
  if (looksLikeUpgrade(n)) return false;
  return /(?:gpt[\s.\-]*\d*(?:\.\d+)?[\s.\-]*)pro\b|chatgpt[\s.\-]*pro\b|专业版/i.test(n);
}

/** Current model picker value, not a marketing/upgrade control. */
export function snapshotModelPickerNames(text) {
  return quotedControls(text, 'combobox|button').filter(n => !looksLikeUpgrade(n));
}

export function snapshotShowsGptPro(text) {
  return snapshotModelPickerNames(text).some(looksLikeProModel);
}

export function snapshotReplyFinished(text) {
  const body = String(text || '');
  if (/Stop generating|停止生成|正在生成|Stop streaming/i.test(body)) return false;
  return /Copy|复制|Good response|Share|分享/.test(body);
}

export function snapshotStage(text) {
  if (snapshotNeedsLogin(text)) return 'needs-login';
  if (!snapshotHasComposer(text)) return 'unknown';
  if (!snapshotShowsGptPro(text)) return 'needs-pro';
  if (!snapshotReplyFinished(text)) return 'composer';
  return 'reply-ready';
}
