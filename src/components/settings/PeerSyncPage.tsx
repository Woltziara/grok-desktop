import { useCallback, useEffect, useState } from "react";
import type { AccountRow } from "../../vite-env";

type FileSummary = {
  count: number;
  shown: string[];
  more: number;
};

type AlignResult = {
  ok: boolean;
  applied?: boolean;
  needPair?: boolean;
  error?: string;
  preview?: string;
  label?: string;
  grok?: { pull: FileSummary; push: FileSummary };
  projects?: { pull: FileSummary; push: FileSummary };
};

type PeerStatus = {
  role: string;
  label: string;
  host: string;
  online: boolean;
  paired: boolean;
  sshReady: boolean;
  projectsPath: string;
  grokHome: string;
  lastSyncAt?: string | null;
};

type AccountList = {
  current: AccountRow | null;
  saved: AccountRow[];
  peer?: {
    ok?: boolean;
    online?: boolean;
    sshReady?: boolean;
    needPair?: boolean;
    account?: AccountRow | null;
    label?: string;
  };
};

function formatAccount(row?: AccountRow | null) {
  if (!row) return "还没有";
  const name = row.displayName || row.email || "已登录";
  if (row.email && row.displayName && row.displayName !== row.email) {
    return `${row.displayName}（${row.email}）`;
  }
  return row.email || name;
}

function FileChunk({
  title,
  summary,
}: {
  title: string;
  summary?: FileSummary;
}) {
  if (!summary || summary.count === 0) return null;
  return (
    <div className="peer-files">
      <div className="peer-files-title">
        {title}（{summary.count}）
      </div>
      <ul>
        {summary.shown.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      {summary.more > 0 ? (
        <div className="settings-desc">还有 {summary.more} 份没列出来。</div>
      ) : null}
    </div>
  );
}

export function PeerSyncPage({
  open,
  restarting,
  onRestartAgent,
}: {
  open: boolean;
  restarting?: boolean;
  onRestartAgent?: () => void;
}) {
  const [status, setStatus] = useState<PeerStatus | null>(null);
  const [accounts, setAccounts] = useState<AccountList | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [preview, setPreview] = useState<AlignResult | null>(null);

  const reload = useCallback(async () => {
    const [s, a] = await Promise.all([
      window.grokDesktop.peerStatus(),
      window.grokDesktop.listAccounts(),
    ]);
    setStatus(s);
    setAccounts(a);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setNote(null);
    void reload().catch((e: unknown) => {
      if (!cancelled) setNote(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
    };
  }, [open, reload]);

  const run = async (
    fn: () => Promise<AlignResult | { ok: boolean; error?: string }>,
  ) => {
    setNote(null);
    try {
      const res = await fn();
      if (!res.ok) {
        setNote(res.error || "没做成。");
        return res;
      }
      return res;
    } catch (e: unknown) {
      setNote(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  const peerLabel = status?.label || accounts?.peer?.label || "另一台电脑";
  const otherSaved = (accounts?.saved || []).filter((row) => !row.active);

  return (
    <section className="settings-section">
      <p className="settings-desc settings-lead">
        出差带着笔记本走几天，回来两边会对不上。这里把
        <strong> Grok 的家</strong>（对话、记忆、技能、设置）和整个
        <strong> Projects 文件夹</strong>
        对齐：先对比，再用新的盖掉旧的。只在一台电脑上有的文件会留下，不删。
        登录账号要单独送，不会跟着对齐一起被盖掉。
      </p>
      <div className="settings-row settings-row-stack">
        <div className="settings-row-text">
          <span className="settings-label">{peerLabel}</span>
          <span className="settings-desc">
            {status == null
              ? "正在找…"
              : status.online
                ? status.sshReady
                  ? "在，已经配对，可以对齐。"
                  : status.paired
                    ? "机器在，但还登不进去。再配对一次。"
                    : "找到了。先配对一次（输入对面的登录密码）。"
                : "现在找不到。出门在外请开 Tailscale；在家可以用雷雳连上。"}
          </span>
          {status?.lastSyncAt ? (
            <span className="settings-desc">
              上次对齐：{new Date(status.lastSyncAt).toLocaleString()}
            </span>
          ) : null}
        </div>
      </div>

      {!status?.sshReady ? (
        <label className="settings-row settings-row-stack">
          <div className="settings-row-text">
            <span className="settings-label">对面的登录密码</span>
            <span className="settings-desc">
              只用来写一把钥匙，不会存下来。两台都要用同一用户名。
            </span>
          </div>
          <input
            className="settings-input"
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            className="btn"
            disabled={Boolean(busy) || !password.trim()}
            onClick={() => {
              void (async () => {
                setBusy("pair");
                const res = await run(() =>
                  window.grokDesktop.peerPair(password),
                );
                setBusy(null);
                if (res?.ok) {
                  setPassword("");
                  setNote("配对好了。以后对齐不用再输密码。");
                  await reload();
                }
              })();
            }}
          >
            {busy === "pair" ? "配对中…" : "配对僚机"}
          </button>
        </label>
      ) : null}

      <div className="settings-row settings-row-stack">
        <div className="settings-row-text">
          <span className="settings-label">登录</span>
          <span className="settings-desc">
            这台现在是：{formatAccount(accounts?.current)}
          </span>
          <span className="settings-desc">
            {peerLabel}现在是：{formatAccount(accounts?.peer?.account || null)}
          </span>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">把这边的登录送过去</span>
          <span className="settings-desc">
            送到{peerLabel}。对面原来的登录会先收起来，以后还能换回来。
          </span>
        </div>
        <button
          type="button"
          className="btn primary"
          disabled={Boolean(busy) || restarting || !status?.sshReady}
          onClick={() => {
            if (
              !window.confirm(
                `把这边的登录送到${peerLabel}？对面原来的登录会收起来。`,
              )
            ) {
              return;
            }
            void (async () => {
              setBusy("push-auth");
              const res = await run(() =>
                window.grokDesktop.copyAuthToPeer("push"),
              );
              setBusy(null);
              if (res?.ok) {
                setNote(
                  ("preview" in res && res.preview) ||
                    `已经送到${peerLabel}。`,
                );
                await reload();
              }
            })();
          }}
        >
          {busy === "push-auth" ? "送过去…" : "送到对面"}
        </button>
      </div>

      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">把对面的登录拿到这台</span>
          <span className="settings-desc">
            这台原来的登录会收起来。案子和文件夹都还在，只换大脑账号。
          </span>
        </div>
        <button
          type="button"
          className="btn"
          disabled={Boolean(busy) || restarting || !status?.sshReady}
          onClick={() => {
            if (
              !window.confirm(
                `把${peerLabel}的登录拿到这台？这边原来的登录会收起来。`,
              )
            ) {
              return;
            }
            void (async () => {
              setBusy("pull-auth");
              const res = await run(() =>
                window.grokDesktop.copyAuthToPeer("pull"),
              );
              setBusy(null);
              if (res?.ok) {
                setNote(
                  ("preview" in res && res.preview) ||
                    `已经拿到${peerLabel}的登录。`,
                );
                await reload();
                onRestartAgent?.();
              }
            })();
          }}
        >
          {busy === "pull-auth" ? "拿过来…" : "拿到这台"}
        </button>
      </div>

      {otherSaved.length > 0 ? (
        <div className="settings-row settings-row-stack">
          <div className="settings-row-text">
            <span className="settings-label">换成另一份登录</span>
            <span className="settings-desc">
              收起来的登录还在这台电脑上。点一下就换，案子不会丢。
            </span>
          </div>
          <ul className="peer-account-list">
            {otherSaved.map((row) => (
              <li key={row.id}>
                <span>{formatAccount(row)}</span>
                <button
                  type="button"
                  className="btn"
                  disabled={Boolean(busy) || restarting}
                  onClick={() => {
                    void (async () => {
                      setBusy(`switch-${row.id}`);
                      const res = await run(() =>
                        window.grokDesktop.activateAccount(row.id),
                      );
                      setBusy(null);
                      if (res?.ok) {
                        setNote(`已经换成 ${formatAccount(row)}。`);
                        await reload();
                        onRestartAgent?.();
                      }
                    })();
                  }}
                >
                  {busy === `switch-${row.id}` ? "换着…" : "换成这个"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">先看差在哪</span>
          <span className="settings-desc">
            只列名单，不改文件。node_modules、git 仓库内部、编译产物不搬。
          </span>
        </div>
        <button
          type="button"
          className="btn"
          disabled={Boolean(busy) || !status?.online}
          onClick={() => {
            void (async () => {
              setBusy("preview");
              const res = (await run(() =>
                window.grokDesktop.peerAlign({ apply: false }),
              )) as AlignResult | null;
              setBusy(null);
              if (res?.ok) setPreview(res);
            })();
          }}
        >
          {busy === "preview" ? "对比中…" : "对比"}
        </button>
      </div>

      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">对齐</span>
          <span className="settings-desc">
            新的盖掉旧的。建议先对比。对齐时请不要两边同时开着同一场对话猛写。
          </span>
        </div>
        <button
          type="button"
          className="btn primary"
          disabled={Boolean(busy) || !status?.sshReady}
          onClick={() => {
            if (!window.confirm("用新的盖掉旧的。确定对齐？")) return;
            void (async () => {
              setBusy("apply");
              const res = (await run(() =>
                window.grokDesktop.peerAlign({ apply: true }),
              )) as AlignResult | null;
              setBusy(null);
              if (res?.ok) {
                setPreview(res);
                setNote(res.preview || "对齐完成。");
                await reload();
              }
            })();
          }}
        >
          {busy === "apply" ? "对齐中…" : "对齐"}
        </button>
      </div>

      {preview?.preview ? (
        <p className="settings-desc settings-note">{preview.preview}</p>
      ) : null}
      <FileChunk title="Grok 的家 · 拿来" summary={preview?.grok?.pull} />
      <FileChunk title="Grok 的家 · 送走" summary={preview?.grok?.push} />
      <FileChunk title="Projects · 拿来" summary={preview?.projects?.pull} />
      <FileChunk title="Projects · 送走" summary={preview?.projects?.push} />
      {note ? <p className="settings-desc settings-note">{note}</p> : null}
    </section>
  );
}
