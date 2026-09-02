/** Plus-menu catalog — grok-app SidePicker / Codex (MIT structure). */
export type SidePickerKind = "file" | "chat" | "browser";

const OPTIONS: Array<{
  kind: SidePickerKind;
  label: string;
  shortcut: string;
}> = [
  { kind: "file", label: "文件", shortcut: "⌘P" },
  { kind: "chat", label: "侧边聊天", shortcut: "⌥S" },
  { kind: "browser", label: "浏览器", shortcut: "⌘T" },
];

function KindIcon({ kind }: { kind: SidePickerKind }) {
  if (kind === "file") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <path
          d="M3.5 2.5h6l3 3V13.5h-9z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (kind === "chat") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M5.5 8h.1M8 8h.1M10.5 8h.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.8 8h10.4M8 2.8c1.6 1.7 2.4 3.4 2.4 5.2S9.6 11.5 8 13.2C6.4 11.5 5.6 9.8 5.6 8S6.4 4.5 8 2.8z" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function SidePicker({
  onPick,
}: {
  onPick: (kind: SidePickerKind) => void;
}) {
  return (
    <div className="sw-picker" role="menu" aria-label="在侧栏打开">
      {OPTIONS.map((opt) => (
        <button
          key={opt.kind}
          type="button"
          role="menuitem"
          className="sw-picker__item"
          onClick={() => onPick(opt.kind)}
        >
          <span className="sw-picker__ico">
            <KindIcon kind={opt.kind} />
          </span>
          <span className="sw-picker__label">{opt.label}</span>
          <span className="sw-picker__shortcut">{opt.shortcut}</span>
        </button>
      ))}
    </div>
  );
}
