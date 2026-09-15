import { useCallback, useEffect, useState } from "react";

type PreviewState = Awaited<ReturnType<typeof window.grokDesktop.previewState>>;

function normalizeUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const href = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(t) ? t : `https://${t}`;
    const u = new URL(href);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

export function SideBrowser({
  initialUrl,
}: {
  initialUrl?: string;
}) {
  const [input, setInput] = useState(initialUrl || "");
  const [state, setState] = useState<PreviewState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { setState(await window.grokDesktop.previewState()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  useEffect(() => {
    let live = true;
    const off = window.grokDesktop.on("preview:changed", (next: PreviewState) => { if (live) setState(next); });
    void window.grokDesktop.openPreview(initialUrl || undefined).then(next => { if (live) setState(next); }).catch(async e => {
      if (live) { setError(e instanceof Error ? e.message : String(e)); await refresh(); }
    });
    return () => { live = false; off(); };
  }, [initialUrl, refresh]);

  const go = async () => {
    const next = normalizeUrl(input);
    if (!next) { setError("请输入 http(s) 网页地址。"); return; }
    try {
      setError(null);
      setState(state?.open ? await window.grokDesktop.navigatePreview(next) : await window.grokDesktop.openPreview(next));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="sw-browser">
      <form
        className="sw-browser__bar"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <input
          value={input}
          placeholder="输入网址"
          spellCheck={false}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" className="btn ghost btn-sm">
          打开
        </button>
      </form>
      <div className="sw-empty">
        <div className="sw-empty__title">Grok 自有浏览器</div>
        <div className="sw-empty__hint">
          {state?.open
            ? `${state.loading ? "正在打开" : "已打开"} · ${state.title || state.url || "空白页"}`
            : state?.ownedElsewhere
              ? "浏览器属于另一段对话。打开时会先请你决定是否转交。"
              : "浏览器会在独立窗口打开，并保留自己的登录状态。"}
        </div>
        {error ? <div className="sw-empty__hint">{error}</div> : null}
        <button type="button" className="btn ghost btn-sm" onClick={() => void window.grokDesktop.openPreview().then(setState).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))}>
          显示浏览器
        </button>
        <div className="sw-empty__hint">需要让 Grok 查看或操作当前页时，在输入框点 @浏览器。</div>
      </div>
    </div>
  );
}
