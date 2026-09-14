import { useState } from "react";
import { copyPayloads } from "../../shared/copy-variants.mjs";
import { copyMarkdownRich } from "../lib/copy-formatted";
import { Menu, MenuItem, MenuSep } from "./ui/dropdown-menu";

export function CopyMenu({ markdown }: { markdown: string }) {
  const [label, setLabel] = useState("复制");
  const payload = copyPayloads(markdown);
  const flash = (next: string) => {
    setLabel(next);
    window.setTimeout(() => setLabel("复制"), 1200);
  };
  const trigger = (
    <button
      type="button"
      className="user-action copy-menu-trigger"
      title={label}
      aria-label={label}
    >
      {label === "复制" ? (
        <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden>
          <rect
            x="9"
            y="9"
            width="11"
            height="11"
            rx="2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="M5 15V5a2 2 0 0 1 2-2h10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          />
        </svg>
      ) : (
        <span className="copy-menu-flash">{label}</span>
      )}
    </button>
  );
  return (
    <Menu trigger={trigger}>
      <MenuItem
        onSelect={() => {
          void copyMarkdownRich(payload.plain, { markdownOnly: true }).then(() =>
            flash("已复制正文"),
          );
        }}
      >
        复制正文
      </MenuItem>
      <MenuItem
        onSelect={() => {
          void copyMarkdownRich(payload.markdown).then(() => flash("已复制 Markdown"));
        }}
      >
        复制 Markdown
      </MenuItem>
      <MenuSep />
      <MenuItem
        onSelect={() => {
          const sel = window.getSelection()?.toString().replace(/\u00a0/g, " ").trim();
          const text = sel || payload.plain;
          if (!text) return;
          window.dispatchEvent(
            new CustomEvent("grok-add-quote", { detail: { text } }),
          );
          flash("已引用");
        }}
      >
        引用到输入框
      </MenuItem>
      {payload.tables.length ? (
        <>
          <MenuSep />
          <MenuItem
            onSelect={() => {
              const tsv = payload.tables
                .map((t: { tsv: string }) => t.tsv)
                .join("\n\n");
              void copyMarkdownRich(tsv, { markdownOnly: true }).then(() =>
                flash("已复制表格"),
              );
            }}
          >
            复制表格
          </MenuItem>
        </>
      ) : null}
    </Menu>
  );
}
