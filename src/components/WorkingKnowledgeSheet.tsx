import { useEffect, useMemo, useState } from "react";
import type {
  WorkingKnowledgeItem,
  WorkingKnowledgeSnapshot,
} from "../vite-env";

const KIND_LABEL: Record<string, string> = {
  background: "当前背景",
  preference: "个人偏好",
  decision: "已作出的决定",
  correction: "纠正",
  inference: "模型推断",
  unknown: "未知",
  conflict: "冲突",
  question: "问题",
  withdrawal: "撤回",
  replacement: "替代",
  action: "行动",
  result: "结果",
  utterance: "原话",
};

const EPI_LABEL: Record<string, string> = {
  user_said: "用户说过",
  model_inferred: "模型推断",
  decided: "已经决定",
  executed: "已经执行",
  observed_success: "实际成功",
  unknown: "待核",
};

const GROUPS: Array<{ id: string; kinds: string[] }> = [
  { id: "有效认识", kinds: ["correction", "decision", "preference", "background"] },
  { id: "推断与未知", kinds: ["inference", "unknown", "conflict"] },
  { id: "问题", kinds: ["question"] },
];

function groupItems(items: WorkingKnowledgeItem[]) {
  const used = new Set<string>();
  const out: Array<{ id: string; items: WorkingKnowledgeItem[] }> = [];
  for (const g of GROUPS) {
    const list = items.filter((it) => g.kinds.includes(it.kind));
    list.forEach((it) => used.add(it.id));
    if (list.length) out.push({ id: g.id, items: list });
  }
  const rest = items.filter((it) => !used.has(it.id));
  if (rest.length) out.push({ id: "其他", items: rest });
  return out;
}

export function WorkingKnowledgeSheet({
  open,
  snapshot,
  saveNote,
  busy,
  onClose,
  onReload,
  onSetEnabled,
  onSetObject,
  onCorrect,
  onWithdraw,
  onArmProbe,
}: {
  open: boolean;
  snapshot: WorkingKnowledgeSnapshot | null;
  saveNote: string | null;
  busy: boolean;
  onClose: () => void;
  onReload: () => void;
  onSetEnabled: (next: boolean) => void;
  onSetObject: (objectId: string) => void;
  onCorrect: (item: WorkingKnowledgeItem, text: string) => void;
  onWithdraw: (item: WorkingKnowledgeItem) => void;
  onArmProbe: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!open) {
      setEditingId(null);
      setDraft("");
    }
  }, [open]);

  const groups = useMemo(
    () => groupItems(snapshot?.items || []),
    [snapshot?.items],
  );

  if (!open) return null;
  const snap = snapshot;

  return (
    <div
      className="modal-backdrop wk-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-dialog wk-dialog" role="dialog" aria-labelledby="wk-title">
        <div className="modal-header">
          <h2 id="wk-title">工作认识</h2>
          <button type="button" className="btn ghost btn-sm" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="modal-body wk-body">
          <p className="wk-lead">
            这是客厅自己的固定认识框架，按你明确选择的业务对象记，不按文件夹记。
            未选择对象时，不会套用或写入任何对象的认识。
          </p>

          <label className="settings-row">
            <div className="settings-row-text">
              <span className="settings-label">使用工作认识</span>
              <span className="settings-desc">
                关掉后不再带进模型，已经写下的记录还在。
              </span>
            </div>
            <input
              type="checkbox"
              checked={Boolean(snap?.enabled)}
              disabled={busy}
              onChange={(e) => onSetEnabled(e.target.checked)}
            />
          </label>

          <div className="settings-row settings-row-stack">
            <div className="settings-row-text">
              <span className="settings-label">当前业务对象</span>
              <span className="settings-desc">
                软件目录和对话 ID 只是来源，不能代替这里的归属。后来的切换会马上改本会话。
              </span>
            </div>
            <select
              className="settings-select"
              disabled={busy}
              value={snap?.currentObjectId || ""}
              onChange={(e) => onSetObject(e.target.value)}
            >
              <option value="">未指定（不写入任何对象）</option>
              {(snap?.objects || []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
            </select>
          </div>

          {saveNote ? <p className="wk-save-note">{saveNote}</p> : null}

          <p className="settings-desc">
            现在带着：{snap?.activeObjectTitle || "未指定"}
            {typeof snap?.version === "number" ? ` · 版本 ${snap.version}` : ""}
            {snap?.inbox?.length ? ` · 待处理原话 ${snap.inbox.length} 条` : ""}
          </p>

          {(snap?.inbox || []).length > 0 ? (
            <section className="wk-group">
              <h3>尚未处理的原话</h3>
              <ul className="wk-list">
                {snap!.inbox.map((row) => (
                  <li key={row.id} className="wk-item">
                    <div className="wk-item-head">
                      <span className="wk-item-label">待处理</span>
                      <span className="wk-item-meta">{row.recordedAt || row.at}</span>
                    </div>
                    <p className="wk-item-text">{row.text}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {groups.length === 0 ? (
            <p className="settings-desc">还没有当前有效认识。</p>
          ) : (
            groups.map((g) => (
              <section key={g.id} className="wk-group">
                <h3>{g.id}</h3>
                <ul className="wk-list">
                  {g.items.map((item) => (
                    <li key={item.id} className="wk-item">
                      <div className="wk-item-head">
                        <span className="wk-item-label">
                          {KIND_LABEL[item.kind] || item.kind}
                        </span>
                        <span className="wk-item-meta">
                          {EPI_LABEL[item.epistemic || ""] || item.epistemic}
                          {item.scope ? ` · ${item.scope}` : ""}
                        </span>
                      </div>
                      {editingId === item.id ? (
                        <textarea
                          className="wk-edit"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          rows={4}
                        />
                      ) : (
                        <p className="wk-item-text">{item.text}</p>
                      )}
                      {item.analysis ? (
                        <p className="wk-item-analysis">理由：{item.analysis}</p>
                      ) : null}
                      <div className="wk-item-actions">
                        {editingId === item.id ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-sm"
                              disabled={busy || !draft.trim()}
                              onClick={() => {
                                onCorrect(item, draft.trim());
                                setEditingId(null);
                              }}
                            >
                              保存纠正
                            </button>
                            <button
                              type="button"
                              className="btn ghost btn-sm"
                              onClick={() => setEditingId(null)}
                            >
                              取消
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="btn ghost btn-sm"
                              disabled={busy}
                              onClick={() => {
                                setEditingId(item.id);
                                setDraft(item.text);
                              }}
                            >
                              纠正
                            </button>
                            <button
                              type="button"
                              className="btn ghost btn-sm"
                              disabled={busy}
                              onClick={() => onWithdraw(item)}
                            >
                              撤回
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}

          <section className="wk-group">
            <h3>入口探针</h3>
            <p className="settings-desc">
              探针只验证桌面输入框能不能把一次性口令送进模型背景。它不会写入任何正式记录。
            </p>
            {snap?.lastReceipt && typeof snap.lastReceipt.probeToken === "string" ? (
              <p className="wk-item-text">
                上次探针口令：{String(snap.lastReceipt.probeToken)}
              </p>
            ) : (
              <p className="settings-desc">
                {snap?.probeArmed ? "下一句用户消息会带一次探针。" : "当前没有待发探针。"}
              </p>
            )}
            <button
              type="button"
              className="btn ghost btn-sm"
              disabled={busy}
              onClick={onArmProbe}
            >
              下一句再做一次入口探针
            </button>
          </section>

          <p className="settings-desc wk-root">
            本机位置：{snap?.root || "…"}
            <button
              type="button"
              className="btn ghost btn-sm"
              onClick={() => onReload()}
            >
              重新读回
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
