import { useState } from "react";

export function SideChat({
  onSend,
}: {
  onSend?: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [notes, setNotes] = useState<string[]>([]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setNotes((prev) => [...prev, text]);
    setDraft("");
    onSend?.(text);
  };

  return (
    <div className="sw-chat">
      <div className="sw-chat__log">
        {notes.length === 0 ? (
          <p className="sw-empty__hint">
            写一句给主对话。这边看着文件，那边继续问。
          </p>
        ) : (
          notes.map((n, i) => (
            <div key={i} className="sw-chat__bubble">
              {n}
            </div>
          ))
        )}
      </div>
      <div className="sw-chat__compose">
        <textarea
          value={draft}
          placeholder="问一句…"
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="button" className="btn primary btn-sm" onClick={send}>
          发送
        </button>
      </div>
    </div>
  );
}
