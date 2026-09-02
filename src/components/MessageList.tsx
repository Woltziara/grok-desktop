import {
  Fragment,
  memo,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  matchSlashCommand,
  parseSlashInvocation,
  type SlashCommand,
} from "../lib/commands";
import {
  formatClock,
  formatClockShort,
  formatDayLabel,
  formatFullTimestamp,
  shouldShowTimeDivider,
} from "../lib/time";
import type { PermissionRequest, TimelineItem } from "../vite-env";
import { formatOptionLabel } from "../lib/timeline";
import {
  classifyOptionId,
  permissionButtonClass,
} from "../../shared/permission-options.mjs";
import { usePrivacy } from "../lib/privacy-context";
import { InlineActivity } from "./CollapsibleActivity";
import { buildToolCard, ToolCardView } from "./ToolCardView";
import {
  formatThoughtInlineSummary,
  formatToolInlineSummary,
  formatToolPlainSummary,
  formatWorkedFor,
  shouldShowThought,
} from "../lib/tool-display";
import { DiffView } from "./DiffView";
import { shouldRenderDiff } from "../lib/line-diff";
import {
  clusterTimeline,
  formatActivityDigest,
  shouldCollapseActivity,
  type ActivityItem,
} from "../lib/activity-cluster";
import {
  applyFormattedCopy,
  copyMarkdownRich,
  installCopySelectionMarkdownHook,
} from "../lib/copy-formatted";

/** Stable empties so default props do not bust React.memo every parent render. */
const EMPTY_COMMANDS: SlashCommand[] = [];
const EMPTY_PERMISSIONS: PermissionRequest[] = [];

/** Hoisted so ReactMarkdown is not handed new plugin/component identities per render. */
const REMARK_PLUGINS = [remarkGfm];

function MarkdownLink({
  href,
  children,
}: {
  href?: string;
  children?: ReactNode;
}) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href && /^https?:\/\//i.test(href)) {
          void window.grokDesktop.openExternal(href);
        }
      }}
    >
      {children}
    </a>
  );
}

/** Only allow http(s) remote images; block data:/file: model-driven egress. */
function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  if (!src || !/^https?:\/\//i.test(src)) {
    return (
      <span className="md-img-blocked" title={src || ""}>
        [{alt || "image blocked"}]
      </span>
    );
  }
  return <img src={src} alt={alt || ""} loading="lazy" />;
}

const MD_COMPONENTS = {
  a: MarkdownLink,
  img: MarkdownImage,
};

function MsgMeta({
  role,
  at,
  status,
  actions,
}: {
  role: string;
  at?: number;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  const clock = formatClock(at);
  return (
    <div className="meta">
      <span className="meta-role">{role}</span>
      <div className="meta-end">
        {status}
        {clock ? (
          <time
            className="meta-time"
            dateTime={at ? new Date(at).toISOString() : undefined}
            title={formatFullTimestamp(at)}
          >
            {clock}
          </time>
        ) : null}
        {actions}
      </div>
    </div>
  );
}

function IconCopy() {
  return (
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
  );
}

function IconCheck() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M5 12.5 10 17.5 19 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconBranch() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden>
      <circle cx="6" cy="6" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="6" cy="18" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="18" cy="12" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M6 8.2v7.6M8.1 6.8c4 0 5.2 2.2 7.7 4.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconPencil() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 20h9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MsgCopyButton({
  text,
  rich = false,
}: {
  text: string;
  rich?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <UserActionButton
      label={copied ? "已复制" : "复制"}
      onClick={() => {
        void copyMarkdownRich(text, { markdownOnly: !rich })
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          })
          .catch(() => {});
      }}
    >
      {copied ? <IconCheck /> : <IconCopy />}
    </UserActionButton>
  );
}

function UserActionButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="user-action"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

function InlineUserEdit({
  initialText,
  busy,
  onCancel,
  onSubmit,
}: {
  initialText: string;
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState(initialText);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const canSubmit = Boolean(text.trim()) && !busy;

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.focus();
    el.selectionStart = el.value.length;
    el.selectionEnd = el.value.length;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
  }, []);

  return (
    <div className="user-inline-edit">
      <textarea
        ref={taRef}
        className="user-inline-edit-text"
        value={text}
        disabled={busy}
        rows={3}
        onChange={(e) => {
          setText(e.target.value);
          const el = e.target;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
            return;
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) {
            e.preventDefault();
            onSubmit(text.trim());
          }
        }}
      />
      <div className="user-inline-edit-actions">
        <button
          type="button"
          className="btn ghost btn-sm"
          disabled={busy}
          onClick={onCancel}
        >
          取消
        </button>
        <button
          type="button"
          className="btn primary btn-sm"
          disabled={!canSubmit}
          onClick={() => onSubmit(text.trim())}
        >
          发送
        </button>
      </div>
    </div>
  );
}

function DayDivider({ at }: { at: number }) {
  const label = formatDayLabel(at);
  if (!label) return null;
  return (
    <div className="day-divider" role="separator" aria-label={`Messages from ${label}`}>
      <span>{label}</span>
    </div>
  );
}

function sourceBadgeLabel(cmd?: SlashCommand): string {
  if (!cmd) return "slash";
  if (cmd.local || cmd.source === "desktop") return "app";
  if (cmd.source === "skill") return "skill";
  return "command";
}

function planEntryLabel(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const row = e as { content?: string; status?: string };
    const base = row.content || JSON.stringify(e);
    return row.status ? `${base} — ${row.status}` : base;
  }
  return JSON.stringify(e);
}

/**
 * One timeline row. Memoized so streaming / typing only re-renders rows whose
 * props actually changed (assistant markdown is the expensive case).
 * Relies on applySessionUpdate preserving object identity for unchanged items.
 */
function useElapsedMs(at: number, running: boolean, nextAt?: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [running]);
  if (running) return Math.max(0, now - at);
  if (nextAt && nextAt > at) return nextAt - at;
  return 0;
}

function lastUserAt(items: TimelineItem[]): number | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (items[i]?.kind === "user" && typeof items[i].at === "number") {
      return items[i].at;
    }
  }
  return undefined;
}

function ThoughtRow({
  item,
  running,
  nextAt,
  prevKind,
  nextKind,
}: {
  item: Extract<TimelineItem, { kind: "thought" }>;
  running: boolean;
  nextAt?: number;
  prevKind?: string | null;
  nextKind?: string | null;
}) {
  const { redact } = usePrivacy();
  const ms = useElapsedMs(item.at, running, nextAt);
  if (!shouldShowThought({ ms, running, prevKind, nextKind })) {
    return null;
  }
  const thought = redact(item.text);
  return (
    <InlineActivity
      className={"thought" + (running ? " is-live" : "")}
      summary={formatThoughtInlineSummary(ms, running)}
    >
      {thought ? <div className="body">{thought}</div> : null}
    </InlineActivity>
  );
}

function TurnClock({ startedAt }: { startedAt: number }) {
  const ms = useElapsedMs(startedAt, true);
  return (
    <div className="turn-waiting" role="status" aria-live="polite">
      <span className="inline-activity-summary">
        {formatThoughtInlineSummary(ms, true)}
      </span>
    </div>
  );
}

const TimelineRow = memo(function TimelineRow({
  item,
  showDay,
  knownCommands,
  nextAt,
  isLast,
  turnActive,
  prevKind,
  nextKind,
  canEditUser = false,
  editingUserId = null,
  editSubmitting = false,
  onStartEditUser,
  onCancelEditUser,
  onSubmitEditUser,
  onBranchAssistant,
}: {
  item: TimelineItem;
  showDay: boolean;
  knownCommands: SlashCommand[];
  nextAt?: number;
  isLast: boolean;
  turnActive: boolean;
  prevKind?: string | null;
  nextKind?: string | null;
  canEditUser?: boolean;
  editingUserId?: string | null;
  editSubmitting?: boolean;
  onStartEditUser?: (id: string) => void;
  onCancelEditUser?: () => void;
  onSubmitEditUser?: (id: string, text: string) => void;
  onBranchAssistant?: (id: string) => void;
}) {
  const { redact } = usePrivacy();
  const day =
    showDay && typeof item.at === "number" ? (
      <DayDivider at={item.at} />
    ) : null;

  if (item.kind === "user") {
    const text = String(item.text || "")
      .replace(/\[object Object\]/g, "")
      .trim();
    const displayText = redact(text);
    const inv = parseSlashInvocation(text);
    const isCmd = Boolean(inv);
    const matched = inv
      ? matchSlashCommand(inv.name, knownCommands)
      : undefined;
    const badge = sourceBadgeLabel(matched);
    const restLines =
      inv && displayText.includes("\n")
        ? displayText.slice(displayText.indexOf("\n") + 1)
        : "";

    const isEditing = editingUserId === item.id;
    const clock = formatClockShort(item.at);

    return (
      <Fragment>
        {day}
        <article
          className={`msg user-prose${isCmd ? " user-command" : ""}${isEditing ? " is-editing" : ""}`}
        >
          {item.images && item.images.length > 0 && !isEditing && (
            <div className="msg-images">
              {item.images.map((img, j) => (
                <button
                  key={j}
                  type="button"
                  className="msg-image"
                  title="Image attachment"
                  onClick={(e) => e.preventDefault()}
                >
                  <img src={img.previewUrl} alt={`Attachment ${j + 1}`} />
                </button>
              ))}
            </div>
          )}
          {isEditing ? (
            <InlineUserEdit
              initialText={text}
              busy={editSubmitting}
              onCancel={() => onCancelEditUser?.()}
              onSubmit={(next) => onSubmitEditUser?.(item.id, next)}
            />
          ) : displayText ? (
            <div className="user-bubble">
              {inv ? (
                <div className="body body-command">
                  <div
                    className={`cmd-invocation ${matched ? "cmd-known" : "cmd-unknown"}`}
                    title={
                      matched
                        ? `${matched.description}${matched.local ? " (handled in app)" : " (sent to agent)"}`
                        : "Looks like a slash command — agent will interpret it"
                    }
                  >
                    <span className={`cmd-badge ${badge}`}>{badge}</span>
                    <code className="cmd-name">/{inv.name}</code>
                    {matched ? (
                      <span className="cmd-picked">
                        {matched.local ? "app command" : "skill / command"}
                      </span>
                    ) : (
                      <span className="cmd-picked cmd-picked-soft">slash</span>
                    )}
                  </div>
                  {inv.args ? (
                    <div className="cmd-args">{redact(inv.args)}</div>
                  ) : null}
                  {restLines ? <div className="cmd-rest">{restLines}</div> : null}
                </div>
              ) : (
                <div className="body">{displayText}</div>
              )}
            </div>
          ) : null}
          {!isEditing && (clock || text) ? (
            <div className="user-actions">
              {clock ? (
                <time
                  className="user-actions-time"
                  dateTime={item.at ? new Date(item.at).toISOString() : undefined}
                  title={formatFullTimestamp(item.at)}
                >
                  {clock}
                </time>
              ) : null}
              {text ? <MsgCopyButton text={text} /> : null}
              {canEditUser && text ? (
                <UserActionButton
                  label="修改"
                  disabled={turnActive}
                  onClick={() => onStartEditUser?.(item.id)}
                >
                  <IconPencil />
                </UserActionButton>
              ) : null}
            </div>
          ) : null}
        </article>
      </Fragment>
    );
  }

  if (item.kind === "assistant") {
    const display = redact(item.text);
    const clock = formatClockShort(item.at);
    const canBranch = Boolean(onBranchAssistant) && !(turnActive && isLast);
    return (
      <Fragment>
        {day}
        <article className="msg grok-prose">
          <div className="body markdown markdown-body">
            <ReactMarkdown
              remarkPlugins={REMARK_PLUGINS}
              components={MD_COMPONENTS}
            >
              {display}
            </ReactMarkdown>
          </div>
          {display.trim() ? (
            <div className="assistant-actions">
              <MsgCopyButton text={display} rich />
              {onBranchAssistant ? (
                <UserActionButton
                  label="从这里开一条新对话"
                  disabled={!canBranch}
                  onClick={() => onBranchAssistant(item.id)}
                >
                  <IconBranch />
                </UserActionButton>
              ) : null}
              {clock ? (
                <time
                  className="assistant-actions-time"
                  dateTime={
                    item.at ? new Date(item.at).toISOString() : undefined
                  }
                  title={formatFullTimestamp(item.at)}
                >
                  {clock}
                </time>
              ) : null}
            </div>
          ) : null}
        </article>
      </Fragment>
    );
  }

  if (item.kind === "thought") {
    return (
      <Fragment>
        {day}
        <ThoughtRow
          item={item}
          running={isLast && turnActive}
          nextAt={nextAt}
          prevKind={prevKind}
          nextKind={nextKind}
        />
      </Fragment>
    );
  }

  if (item.kind === "tool") {
    const card = buildToolCard({
      title: item.title,
      kind: item.toolKind,
      raw: item.raw,
      content: item.content,
    });
    const summary = redact(
      formatToolInlineSummary({
        title: item.title,
        kind: item.toolKind,
        raw: item.raw,
        content: item.content,
        status: item.status,
      }),
    );
    const hasDetails =
      shouldRenderDiff(card.diff) || Boolean(card.detailDisplay) || Boolean(card.output);
    const failed = item.status === "failed" || item.status === "error";
    const running =
      item.status === "in_progress" ||
      item.status === "pending" ||
      item.status === "running";
    return (
      <Fragment>
        {day}
        <InlineActivity
          className={
            "tool" +
            (failed ? " is-fail" : running ? " is-running" : " is-done")
          }
          summary={summary}
        >
          {hasDetails ? (
            <div className="tool-body">
              {shouldRenderDiff(card.diff) && card.diff ? (
                <DiffView diff={card.diff} />
              ) : null}
              {card.detailDisplay ? (
                <pre className="tool-output" title="Command">
                  {redact(card.detailDisplay)}
                </pre>
              ) : null}
              {card.output ? (
                <pre className="tool-output" title="Output">
                  {redact(card.output)}
                </pre>
              ) : null}
            </div>
          ) : null}
        </InlineActivity>
      </Fragment>
    );
  }

  if (item.kind === "plan") {
    const entries = item.entries || [];
    return (
      <Fragment>
        {day}
        <article className="msg plan">
          <MsgMeta role="Plan" at={item.at} />
          <div className="body">
            <ol>
              {entries.map((e, j) => (
                <li key={j}>{redact(planEntryLabel(e))}</li>
              ))}
            </ol>
          </div>
        </article>
      </Fragment>
    );
  }

  if (item.kind === "recap") {
    const display = redact(item.text);
    return (
      <Fragment>
        {day}
        <InlineActivity className="recap" summary="◆ Recap">
          {display ? (
            <div className="body markdown markdown-body recap-body">
              <ReactMarkdown
                remarkPlugins={REMARK_PLUGINS}
                components={MD_COMPONENTS}
              >
                {display}
              </ReactMarkdown>
            </div>
          ) : null}
        </InlineActivity>
      </Fragment>
    );
  }

  if (item.kind === "worked") {
    return (
      <Fragment>
        {day}
        <div className="turn-worked" role="status">
          {formatWorkedFor(item.elapsedMs)}
        </div>
      </Fragment>
    );
  }

  return (
    <Fragment>
      {day}
      <article className="msg system-note">
        <div className="body">{redact(item.text || "")}</div>
      </article>
    </Fragment>
  );
});

function PendingApprovalCard({
  request,
  onPermission,
}: {
  request: PermissionRequest;
  onPermission?: (reqId: string, optionId: string | "cancelled") => void;
}) {
  const { redact } = usePrivacy();
  const tool = request.params?.toolCall;
  const options = request.params?.options?.length
    ? request.params.options
    : [
        { optionId: "allow-once", name: "Allow once" },
        { optionId: "reject", name: "Reject" },
      ];
  const card = buildToolCard({
    title: tool?.title,
    kind: tool?.kind,
    raw: tool?.rawInput,
  });
  const summary = redact(
    formatToolPlainSummary({
      title: tool?.title,
      kind: tool?.kind,
      raw: tool?.rawInput,
      status: tool?.status || "pending",
    }),
  );

  return (
    <article
      className="msg pending-approval"
      role="status"
      aria-live="polite"
    >
      <div className="meta">
        <span className="meta-role">Approval</span>
        <span className="pending-approval-pill">Waiting</span>
      </div>
      <div className="body pending-approval-body">
        <div className="pending-approval-title">{summary}</div>
        <details className="pending-approval-details">
          <summary>查看细节</summary>
          <ToolCardView card={card} />
        </details>
        {onPermission ? (
          <div className="perm-actions">
            {options.map((opt) => {
              const cls = classifyOptionId(opt.optionId, options);
              return (
                <button
                  key={opt.optionId}
                  type="button"
                  className={permissionButtonClass(cls)}
                  onClick={() => onPermission(request.reqId, opt.optionId)}
                >
                  {formatOptionLabel(opt.optionId, opt.name)}
                </button>
              );
            })}
            <button
              type="button"
              className="btn danger"
              onClick={() => onPermission(request.reqId, "cancelled")}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="pending-approval-hint">Waiting for approval…</div>
        )}
      </div>
    </article>
  );
}

function ActivityClusterView({
  items,
  lastRunning,
}: {
  items: ActivityItem[];
  lastRunning: boolean;
}) {
  const [open, setOpen] = useState(false);
  const digest = formatActivityDigest(items, { lastRunning });
  const failed = items.some(
    (item) =>
      item.kind === "tool" &&
      (item.status === "failed" || item.status === "error"),
  );
  return (
    <div
      className={
        "activity-cluster" +
        (lastRunning ? " is-running" : "") +
        (failed ? " is-fail" : "")
      }
    >
      <button
        type="button"
        className="inline-activity-toggle activity-cluster-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="inline-activity-summary">{digest}</span>
      </button>
      {open
        ? items.map((item, i) => (
            <TimelineRow
              key={item.id}
              item={item}
              showDay={false}
              knownCommands={EMPTY_COMMANDS}
              nextAt={
                typeof items[i + 1]?.at === "number"
                  ? items[i + 1].at
                  : undefined
              }
              isLast={lastRunning && i === items.length - 1}
              turnActive={lastRunning}
              prevKind={i > 0 ? items[i - 1].kind : null}
              nextKind={items[i + 1]?.kind}
            />
          ))
        : null}
    </div>
  );
}

function isLiveAgentOutput(item: TimelineItem): boolean {
  if (item.kind === "thought" || item.kind === "assistant") return true;
  if (item.kind === "tool") {
    const st = String(item.status || "").toLowerCase();
    return !st || st === "pending" || st === "in_progress";
  }
  return false;
}

/** After you send, show a beat until the first thought / tool / reply arrives. */
function shouldShowTurnWaiting(items: TimelineItem[]): boolean {
  const last = items[items.length - 1];
  if (!last) return false;
  return !isLiveAgentOutput(last);
}

export const MessageList = memo(function MessageList({
  items,
  bottomRef,
  knownCommands,
  pendingPermissions,
  onPermission,
  onAllowAllPermissions,
  turnActive = false,
  canEditUser = false,
  editingUserId = null,
  editSubmitting = false,
  onStartEditUser,
  onCancelEditUser,
  onSubmitEditUser,
  onBranchAssistant,
}: {
  items: TimelineItem[];
  bottomRef: RefObject<HTMLDivElement | null>;
  /** Skills + agent + desktop commands for slash recognition in user bubbles */
  knownCommands?: SlashCommand[];
  /** Open session/request_permission gates (renderer-only; not from ACP timeline) */
  pendingPermissions?: PermissionRequest[];
  onPermission?: (reqId: string, optionId: string | "cancelled") => void;
  /** Batch-approve every open request (multi-edit batches) */
  onAllowAllPermissions?: () => void;
  /** True while the agent turn is in flight (thought timer). */
  turnActive?: boolean;
  canEditUser?: boolean;
  editingUserId?: string | null;
  editSubmitting?: boolean;
  onStartEditUser?: (id: string) => void;
  onCancelEditUser?: () => void;
  onSubmitEditUser?: (id: string, text: string) => void;
  onBranchAssistant?: (id: string) => void;
}) {
  const cmds = knownCommands ?? EMPTY_COMMANDS;
  const perms = pendingPermissions ?? EMPTY_PERMISSIONS;
  const waitingStart = lastUserAt(items);

  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      applyFormattedCopy(e);
    };
    document.addEventListener("copy", onCopy);
    const unhook = installCopySelectionMarkdownHook();
    return () => {
      document.removeEventListener("copy", onCopy);
      unhook();
    };
  }, []);

  if (items.length === 0 && perms.length === 0) {
    return (
      <div className="empty-state empty-state-home">
        <h2>Grok</h2>
        <p>打开就能说。要用到材料时，再从左边选。</p>
      </div>
    );
  }

  const clusters = clusterTimeline(items);

  return (
    <>
      {clusters.map((cluster, i) => {
        if (cluster.type === "activity") {
          const collapse = shouldCollapseActivity(cluster.items);
          const lastRunning =
            turnActive && i === clusters.length - 1;
          if (collapse) {
            return (
              <ActivityClusterView
                key={cluster.items[0]?.id || `act-${i}`}
                items={cluster.items}
                lastRunning={lastRunning}
              />
            );
          }
          return (
            <Fragment key={cluster.items[0]?.id || `act-${i}`}>
              {cluster.items.map((item, j) => (
                <TimelineRow
                  key={item.id}
                  item={item}
                  showDay={false}
                  knownCommands={cmds}
                  nextAt={
                    typeof cluster.items[j + 1]?.at === "number"
                      ? cluster.items[j + 1].at
                      : undefined
                  }
                  isLast={lastRunning && j === cluster.items.length - 1}
                  turnActive={turnActive}
                  prevKind={j > 0 ? cluster.items[j - 1].kind : null}
                  nextKind={cluster.items[j + 1]?.kind}
                  canEditUser={canEditUser}
                  editingUserId={editingUserId}
                  editSubmitting={editSubmitting}
                  onStartEditUser={onStartEditUser}
                  onCancelEditUser={onCancelEditUser}
                  onSubmitEditUser={onSubmitEditUser}
                  onBranchAssistant={onBranchAssistant}
                />
              ))}
            </Fragment>
          );
        }

        const item = cluster.item;
        const prevCluster = i > 0 ? clusters[i - 1] : null;
        const prevItem =
          prevCluster?.type === "solo"
            ? prevCluster.item
            : prevCluster?.items[prevCluster.items.length - 1];
        const nextCluster = clusters[i + 1];
        const nextItem =
          nextCluster?.type === "solo"
            ? nextCluster.item
            : nextCluster?.items[0];
        const showDay = shouldShowTimeDivider(
          typeof prevItem?.at === "number" ? prevItem.at : null,
          typeof item.at === "number" ? item.at : null,
        );
        return (
          <TimelineRow
            key={item.id}
            item={item}
            showDay={showDay}
            knownCommands={cmds}
            nextAt={typeof nextItem?.at === "number" ? nextItem.at : undefined}
            isLast={turnActive && i === clusters.length - 1}
            turnActive={turnActive}
            prevKind={prevItem?.kind}
            nextKind={nextItem?.kind}
            canEditUser={canEditUser}
            editingUserId={editingUserId}
            editSubmitting={editSubmitting}
            onStartEditUser={onStartEditUser}
            onCancelEditUser={onCancelEditUser}
            onSubmitEditUser={onSubmitEditUser}
            onBranchAssistant={onBranchAssistant}
          />
        );
      })}
      {perms.length > 1 && onAllowAllPermissions ? (
        <div className="perm-batch-inline" role="region" aria-label="Batch approvals">
          <p className="perm-batch-hint">
            {perms.length} tools waiting — Allow all grants each once so
            multi-edit batches do not stall.
          </p>
          <button
            type="button"
            className="btn primary"
            onClick={() => onAllowAllPermissions()}
          >
            Allow all ({perms.length})
          </button>
        </div>
      ) : null}
      {perms.map((p) => (
        <PendingApprovalCard
          key={p.reqId}
          request={p}
          onPermission={onPermission}
        />
      ))}
      {turnActive && shouldShowTurnWaiting(items) ? (
        <TurnClock
          key={waitingStart ?? "turn"}
          startedAt={waitingStart ?? Date.now()}
        />
      ) : null}
      <div ref={bottomRef} />
    </>
  );
});
