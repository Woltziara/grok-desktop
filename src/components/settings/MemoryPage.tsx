import { useCallback, useEffect, useState } from "react";

type MemoryEntry = {
  id: string;
  file: string;
  scope: string;
  heading: string;
  text: string;
  wholeFile?: boolean;
  label: string;
};

export function MemoryPage({
  open,
  offerRestart,
  restarting,
  onRestartAgent,
}: {
  open: boolean;
  offerRestart?: boolean;
  restarting?: boolean;
  onRestartAgent: () => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsRestart, setNeedsRestart] = useState(false);

  const reload = useCallback(async () => {
    const res = await window.grokDesktop.getMemoryStatus();
    setEnabled(Boolean(res.enabled));
    setEntries(Array.isArray(res.entries) ? res.entries : []);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setNote(null);
    void reload().catch((e: unknown) => {
      if (!cancelled) {
        setNote(e instanceof Error ? e.message : String(e));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, reload]);

  return (
    <section className="settings-section">
      <label className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">记住说过的事</span>
          <span className="settings-desc">
            打开以后，Grok 会把你交代过的习惯记在这台电脑上，换一场对话还能用。关掉只是不再带上这些记忆，已经写下的条目还在。
          </span>
          {offerRestart || needsRestart ? (
            <span className="settings-desc settings-note">
              改完后请重启智能体，正在进行的对话才会跟上。
            </span>
          ) : null}
        </div>
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy || restarting}
          onChange={(e) => {
            const next = e.target.checked;
            void (async () => {
              setBusy(true);
              setNote(null);
              try {
                const res = await window.grokDesktop.setMemoryEnabled(next);
                setEnabled(Boolean(res.enabled));
                setNeedsRestart(true);
              } catch (err: unknown) {
                setNote(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            })();
          }}
        />
      </label>
      {offerRestart || needsRestart ? (
        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-label">重启智能体</span>
            <span className="settings-desc">
              让正在开着的对话开始（或停止）使用记忆。
            </span>
          </div>
          <button
            type="button"
            className="btn"
            disabled={restarting}
            onClick={() => onRestartAgent()}
          >
            重启
          </button>
        </div>
      ) : null}
      <div className="settings-row settings-row-stack">
        <div className="settings-row-text">
          <span className="settings-label">它现在记得什么</span>
          <span className="settings-desc">
            不该记的可以忘掉。对话里说「记住……」也会写到这里。
          </span>
        </div>
        {entries.length === 0 ? (
          <p className="settings-desc">还没有记下任何事。</p>
        ) : (
          <ul className="memory-list">
            {entries.map((e) => (
              <li key={e.id} className="memory-item">
                <div className="memory-item-head">
                  <span className="memory-item-label">{e.label}</span>
                  {e.heading ? (
                    <span className="memory-item-heading">{e.heading}</span>
                  ) : null}
                </div>
                <p className="memory-item-text">{e.text || "（空）"}</p>
                <button
                  type="button"
                  className="btn ghost btn-sm"
                  disabled={busy}
                  onClick={() => {
                    if (
                      !window.confirm(
                        e.wholeFile
                          ? "忘掉这份对话纪要？"
                          : "忘掉这一条？",
                      )
                    ) {
                      return;
                    }
                    void (async () => {
                      setBusy(true);
                      try {
                        await window.grokDesktop.deleteMemoryEntry(e.id);
                        await reload();
                      } catch (err: unknown) {
                        setNote(
                          err instanceof Error ? err.message : String(err),
                        );
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                >
                  忘掉
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {note ? <p className="settings-desc settings-note">{note}</p> : null}
    </section>
  );
}
