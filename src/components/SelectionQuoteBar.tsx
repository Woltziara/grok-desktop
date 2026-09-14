import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export function SelectionQuoteBar({
  x,
  y,
  preview,
  onQuote,
  onCopy,
  onClose,
}: {
  x: number;
  y: number;
  preview: string;
  onQuote: () => void;
  onCopy: () => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  if (typeof document === "undefined") return null;
  const left = Math.max(8, Math.min(x, window.innerWidth - 280));
  const top = Math.max(8, Math.min(y, window.innerHeight - 120));
  const clip = preview.length > 72 ? `${preview.slice(0, 72)}…` : preview;

  return createPortal(
    <div
      ref={rootRef}
      className="sel-quote-bar"
      style={{ left, top }}
      role="toolbar"
      aria-label="引用选中文字"
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="sel-quote-bar__preview" title={preview}>
        {clip}
      </div>
      <div className="sel-quote-bar__row">
        <button type="button" className="sel-quote-bar__btn" onClick={onCopy}>
          复制
        </button>
        <button
          type="button"
          className="sel-quote-bar__btn sel-quote-bar__btn--primary"
          onClick={onQuote}
        >
          引用
        </button>
      </div>
    </div>,
    document.body,
  );
}
