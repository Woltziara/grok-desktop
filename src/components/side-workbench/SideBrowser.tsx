import { useEffect, useState } from "react";

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
  const [href, setHref] = useState<string | null>(
    initialUrl ? normalizeUrl(initialUrl) : null,
  );

  useEffect(() => {
    if (!initialUrl) return;
    setInput(initialUrl);
    const next = normalizeUrl(initialUrl);
    if (next) setHref(next);
  }, [initialUrl]);

  const go = () => {
    const next = normalizeUrl(input);
    if (next) setHref(next);
  };

  return (
    <div className="sw-browser">
      <form
        className="sw-browser__bar"
        onSubmit={(e) => {
          e.preventDefault();
          go();
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
      {href ? (
        <iframe className="sw-frame" title="浏览器" src={href} />
      ) : (
        <p className="sw-empty__hint">输入网址，在这一栏打开网页。</p>
      )}
    </div>
  );
}
