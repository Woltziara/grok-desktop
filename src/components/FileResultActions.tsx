import { useState } from "react";

export function requestOpenArtifact(absPath: string) {
  window.dispatchEvent(
    new CustomEvent("grok-open-artifact", { detail: { absPath } }),
  );
}

export function FileResultActions({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  if (!path) return null;
  return (
    <div className="file-result-actions">
      <button
        type="button"
        className="btn ghost btn-sm"
        onClick={() => requestOpenArtifact(path)}
      >
        预览
      </button>
      <button
        type="button"
        className="btn ghost btn-sm"
        onClick={() =>
          void (window.grokDesktop.openDefault
            ? window.grokDesktop.openDefault(path)
            : window.grokDesktop.openPath(path))
        }
      >
        用默认应用打开
      </button>
      <button
        type="button"
        className="btn ghost btn-sm"
        onClick={() => void window.grokDesktop.showItem(path)}
      >
        在文件夹中显示
      </button>
      <button
        type="button"
        className="btn ghost btn-sm"
        onClick={() => {
          void window.grokDesktop
            .writeClipboard({ text: path })
            .then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            })
            .catch(() => {});
        }}
      >
        {copied ? "已复制路径" : "复制路径"}
      </button>
    </div>
  );
}
