import { extractCommitJson } from "./envelope.mjs";
import { isSafeObjectId } from "./paths.mjs";
import {
  EPISTEMIC,
  KINDS,
  STATUSES,
  findIdempotent,
  listInbox,
  markInbox,
  newId,
  readCurrent,
  rememberCommit,
  writeRecord,
} from "./store.mjs";

function parseJson(raw) {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function normalizeChange(raw) {
  const op = String(raw?.op || "upsert").trim();
  if (!["upsert", "withdraw"].includes(op)) {
    return { error: `unsupported op: ${op}` };
  }
  const kind = String(raw?.kind || "").trim();
  if (op === "upsert" && !KINDS.includes(kind)) {
    return { error: `unknown kind: ${kind}` };
  }
  const epistemic = String(raw?.epistemic || "model_inferred").trim();
  if (!EPISTEMIC.includes(epistemic)) {
    return { error: `unknown epistemic: ${epistemic}` };
  }
  const status = String(raw?.status || (op === "withdraw" ? "withdrawn" : "active")).trim();
  if (!STATUSES.includes(status)) {
    return { error: `unknown status: ${status}` };
  }
  if (Boolean(raw?.test)) {
    return { error: "test-marked changes cannot write into this store path" };
  }
  return {
    op,
    kind: op === "withdraw" ? "withdrawal" : kind,
    id: raw?.id ? String(raw.id) : "",
    text: String(raw?.text || "").trim(),
    analysis: String(raw?.analysis || "").trim(),
    scope: String(raw?.scope || "").trim(),
    sourceQuote: String(raw?.sourceQuote || "").trim(),
    epistemic,
    status,
    supersedes: Array.isArray(raw?.supersedes)
      ? raw.supersedes.map(String).filter(Boolean)
      : raw?.id
        ? [String(raw.id)]
        : [],
    inboxIds: Array.isArray(raw?.inboxIds) ? raw.inboxIds.map(String) : [],
  };
}

function exactUserEvidence(root, objectId, ctx, change) {
  if (!ctx.fromModel || !ctx.inboxId) return null;
  const inbox = listInbox(root, objectId, "pending").find(
    (row) => row.id === ctx.inboxId && row.source === "user",
  );
  if (!inbox) return null;
  const quote = String(inbox.text || "").trim();
  if (!quote || change.sourceQuote !== quote || change.text !== quote) return null;
  return inbox;
}

function protectedSupersedeTargets(current, change) {
  const ids = new Set(change.supersedes || []);
  return (current.items || []).filter(
    (item) => ids.has(item.id) && item.epistemic !== "model_inferred",
  );
}

function recordSource(ctx, inbox) {
  if (!ctx.fromModel) {
    return ctx.source || {
      type: "user",
      sessionId: ctx.sessionId || "",
      cwd: ctx.cwd || "",
    };
  }
  if (inbox) {
    return {
      type: "user",
      inboxId: inbox.id,
      sessionId: inbox.sessionId || ctx.sessionId || "",
      cwd: inbox.cwd || ctx.cwd || "",
      quote: String(inbox.text || "").trim(),
    };
  }
  return {
    type: "model",
    sessionId: ctx.sessionId || "",
    cwd: ctx.cwd || "",
  };
}

/**
 * Apply a model or UI commit. Stale versions and object mismatch fail closed.
 * Inbox is only marked processed after a successful write.
 */
export function applyCommit(root, commit, ctx) {
  const objectId = String(ctx.objectId || "");
  if (!isSafeObjectId(objectId)) {
    return { ok: false, error: "no bound object" };
  }
  if (commit.objectId && commit.objectId !== objectId) {
    return { ok: false, error: "object mismatch", expected: objectId, got: commit.objectId };
  }
  const current = readCurrent(root, objectId);
  const key = String(commit.idempotencyKey || "").trim();
  if (key) {
    const prev = findIdempotent(root, objectId, key);
    if (prev) {
      return { ...prev, duplicate: true };
    }
  }
  if (ctx.fromModel && commit.baseVersion == null) {
    return { ok: false, error: "model commit missing baseVersion" };
  }
  if (
    commit.baseVersion != null &&
    Number(commit.baseVersion) !== Number(current.version || 0)
  ) {
    return {
      ok: false,
      error: "stale version",
      baseVersion: commit.baseVersion,
      currentVersion: current.version || 0,
    };
  }

  const changes = Array.isArray(commit.changes) ? commit.changes : [];
  if (changes.length === 0) {
    return { ok: true, written: [], currentVersion: current.version || 0, empty: true };
  }

  const written = [];
  const errors = [];
  const inboxIds = new Set();
  for (const raw of changes) {
    const change = normalizeChange(raw);
    if (change.error) {
      errors.push(change.error);
      continue;
    }
    if (change.op === "upsert" && !change.text) {
      errors.push("upsert missing text");
      continue;
    }
    const userInbox = exactUserEvidence(root, objectId, ctx, change);
    const protectedTargets = protectedSupersedeTargets(current, change);
    if (ctx.fromModel && protectedTargets.length && !userInbox) {
      errors.push("model cannot supersede protected user record without exact inbox quote");
      continue;
    }
    // A model may infer candidates automatically, but cannot promote its own
    // paraphrase to a user decision or completed action. Exact source text is
    // provenance, not proof that the model's broader interpretation is right.
    const epistemic = ctx.fromModel
      ? userInbox
        ? "user_said"
        : "model_inferred"
      : change.epistemic;
    const rec = writeRecord(root, {
      objectId,
      kind: change.kind,
      status: change.status,
      epistemic,
      text:
        change.text ||
        (change.op === "withdraw" ? `撤回 ${change.id || "一条认识"}` : ""),
      analysis: change.analysis,
      scope: change.scope,
      source: recordSource(ctx, userInbox),
      occurredAt: ctx.occurredAt,
      supersedes:
        change.op === "withdraw"
          ? change.supersedes.length
            ? change.supersedes
            : change.id
              ? [change.id]
              : []
          : change.supersedes,
      test: false,
      idempotencyKey: key || undefined,
    });
    written.push(rec.record);
    for (const id of change.inboxIds) inboxIds.add(id);
    if (ctx.inboxId) inboxIds.add(ctx.inboxId);
  }

  if (written.length === 0) {
    return { ok: false, error: errors.join("; ") || "no changes applied", errors };
  }

  const processed = [];
  for (const id of inboxIds) {
    const marked = markInbox(root, objectId, id, {
      status: "processed",
      processedBy: written.map((w) => w.id),
    });
    if (marked.ok) processed.push(id);
  }

  const next = readCurrent(root, objectId);
  const result = {
    ok: true,
    objectId,
    written: written.map((w) => ({
      id: w.id,
      kind: w.kind,
      epistemic: w.epistemic,
    })),
    processedInbox: processed,
    currentVersion: next.version || 0,
    errors,
    idempotencyKey: key || newId("idem"),
    at: new Date().toISOString(),
  };
  rememberCommit(root, objectId, result);
  return result;
}

export function applyCommitFromAssistantText(root, assistantText, ctx) {
  const json = extractCommitJson(assistantText);
  if (!json) {
    return { ok: true, skipped: true, reason: "no commit block" };
  }
  const parsed = parseJson(json);
  if (!parsed.ok) {
    return { ok: false, error: `commit JSON: ${parsed.error}` };
  }
  const value = parsed.value;
  if (!value || typeof value !== "object") {
    return { ok: false, error: "commit is not an object" };
  }
  return applyCommit(root, value, { ...ctx, fromModel: true });
}

export function uiCorrect(root, { objectId, id, text, analysis, scope, sessionId, cwd }) {
  const current = readCurrent(root, objectId);
  const target = (current.items || []).find((it) => it.id === id);
  if (!target && id) {
    return { ok: false, error: "item not found" };
  }
  return applyCommit(
    root,
    {
      objectId,
      idempotencyKey: `ui-correct-${id || "new"}-${Date.now()}`,
      changes: [
        {
          op: "upsert",
          kind: target?.kind || "correction",
          id,
          text,
          analysis: analysis || "用户在工作认识面板中纠正",
          scope: scope || target?.scope || "",
          epistemic: "user_said",
          status: "active",
          supersedes: id ? [id] : [],
        },
      ],
    },
    {
      objectId,
      sessionId,
      cwd,
      source: { type: "user", sessionId, cwd, pointer: "working-knowledge-ui" },
    },
  );
}

export function uiWithdraw(root, { objectId, id, sessionId, cwd }) {
  if (!id) return { ok: false, error: "missing id" };
  return applyCommit(
    root,
    {
      objectId,
      idempotencyKey: `ui-withdraw-${id}-${Date.now()}`,
      changes: [
        {
          op: "withdraw",
          kind: "withdrawal",
          id,
          text: `撤回 ${id}`,
          epistemic: "user_said",
          status: "withdrawn",
          supersedes: [id],
        },
      ],
    },
    {
      objectId,
      sessionId,
      cwd,
      source: { type: "user", sessionId, cwd, pointer: "working-knowledge-ui" },
    },
  );
}
