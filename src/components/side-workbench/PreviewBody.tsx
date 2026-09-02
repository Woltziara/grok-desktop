import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { artifactKindFromPath } from "../../lib/session-artifacts.ts";
import type { SideFileTab } from "../../lib/side-tabs.ts";
import { SideBrowser } from "./SideBrowser";
import { SideChat } from "./SideChat";

const REMARK_PLUGINS = [remarkGfm];

export function PreviewBody({
  tab,
  project,
  onSidePrompt,
}: {
  tab: SideFileTab | null;
  project: string | null;
  onSidePrompt?: (text: string) => void;
}) {
  const [href, setHref] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const kind = tab
    ? tab.kind === "browser" || tab.kind === "chat"
      ? tab.kind
      : artifactKindFromPath(tab.absPath)
    : null;

  useEffect(() => {
    if (!tab || tab.kind === "browser" || tab.kind === "chat" || !project) {
      setHref(null);
      setText(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setError(null);
    if (kind === "markdown" || kind === "text" || kind === "other") {
      setHref(null);
      setLoading(true);
      void window.grokDesktop
        .readFile(tab.absPath)
        .then((r) => {
          if (cancelled) return;
          setText(r.binary ? null : r.text);
          setLoading(false);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setText(null);
          setLoading(false);
          setError(e instanceof Error ? e.message : String(e));
        });
      return () => {
        cancelled = true;
      };
    }
    setText(null);
    setLoading(true);
    void window.grokDesktop
      .artifactPreview(tab.absPath)
      .then((r) => {
        if (cancelled) return;
        setHref(r.href);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setHref(null);
        setLoading(false);
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [tab?.absPath, tab?.id, project, kind]);

  if (tab?.kind === "chat") {
    return <SideChat onSend={onSidePrompt} />;
  }
  if (tab?.kind === "browser") {
    return <SideBrowser initialUrl={tab.url} />;
  }
  if (!tab) {
    return (
      <div className="sw-empty">
        <div className="sw-empty__title">还没有打开的文件</div>
        <div className="sw-empty__hint">
          对话里写出的页面和文稿，会以标签页开在这里。点开就能读、就能试。
        </div>
      </div>
    );
  }
  if (error) return <p className="sw-empty__hint">{error}</p>;
  if (loading) return <p className="sw-empty__hint">打开中…</p>;

  if (kind === "html" && href) {
    return (
      <iframe className="sw-frame" title={tab.name} src={href} />
    );
  }
  if (kind === "image" && href) {
    return <img className="sw-image" alt={tab.name} src={href} />;
  }
  if (kind === "markdown") {
    return (
      <div className="sw-markdown markdown-body">
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
          {text || ""}
        </ReactMarkdown>
      </div>
    );
  }
  if (text != null) {
    return <pre className="sw-text">{text}</pre>;
  }
  return (
    <p className="sw-empty__hint">这个文件请到文件夹里打开。</p>
  );
}
