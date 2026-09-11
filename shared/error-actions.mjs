/**
 * Map a red-banner error to one obvious next step.
 */

export function classifyErrorAction(message) {
  const msg = String(message || "").trim();
  if (!msg) return null;
  if (/auth|login|unauthor|401|credential|sign in|sign-in|登录|失效/i.test(msg)) {
    return { kind: "signin", label: "重新登录" };
  }
  if (/not found|enoent|no such file|不存在|找不到/i.test(msg)) {
    return { kind: "reselect", label: "重新选择文件" };
  }
  if (
    /network|offline|econn|etimedout|fetch failed|socket|网络|超时/i.test(msg)
  ) {
    return { kind: "retry", label: "重试" };
  }
  if (/binary|grok cli not found|spawn/i.test(msg)) {
    return { kind: "install", label: "查看安装说明" };
  }
  return { kind: "dismiss", label: "知道了" };
}
