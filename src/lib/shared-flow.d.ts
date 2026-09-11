declare module "../../shared/title-search.mjs" {
  export function normalizeSearchText(value: unknown): string;
  export function snippetAround(
    text: string,
    query: string,
    radius?: number,
  ): string;
  export function searchByTitle<T>(
    items: T[],
    query: string,
    opts?: { keys?: string[]; limit?: number },
  ): Array<{ item: T; score: number; snippet: string }>;
}

declare module "../../shared/workspace-org.mjs" {
  export function sessionOrgKey(cwd: unknown, sessionId: unknown): string;
  export function parseSessionOrgKey(key: string): {
    cwd: string;
    sessionId: string;
  };
  export function hasDraftContent(draft: unknown): boolean;
  export function stableProjectOrder(order: string[], known: string[]): string[];
  export function moveProjectOrder(
    order: string[],
    activeKey: string,
    overKey: string,
  ): string[];
  export function organizeFolderChats<T>(
    chats: T[],
    org?: {
      pinned?: Record<string, number>;
      archived?: Record<string, number>;
      showArchived?: boolean;
    },
  ): T[];
  export function archivedChats<T>(
    chats: T[],
    archived: Record<string, number>,
  ): T[];
  export function shouldAbandonEmptySession(opts: {
    hadUserSpeech?: boolean;
    hasDraft?: boolean;
    sessionId?: string;
    nextSessionId?: string;
  }): boolean;
  export function timelineHasUserSpeech(items: unknown): boolean;
  export function mergeDraftSessions(
    sessions: unknown[],
    drafts: Record<string, unknown>,
  ): any[];
  export function duplicateProjectNames(
    projects: Array<{ name?: string }>,
  ): Map<string, number>;
  export function parentPathSnippet(cwd: string): string;
}

declare module "../../shared/pending-attach.mjs" {
  export const MAX_ATTACH_BYTES: number;
  export const MAX_INLINE_TEXT_CHARS: number;
  export function fileExt(name: string): string;
  export function classifyAttachKind(name: string, mimeType?: string): string;
  export function isAllowedAttachKind(kind: string): boolean;
  export function attachKindLabel(kind: string): string;
  export function attachDuplicateKey(file: {
    path?: string;
    name?: string;
    size?: number;
  }): string;
  export function findDuplicateAttach(
    existing: unknown[],
    next: { path?: string; name?: string; size?: number },
  ): unknown;
  export function formatBytes(n: number): string;
  export function formatAttachedFilesPrompt(files: unknown[]): string;
  export function mergeComposerTextWithFiles(
    text: string,
    files: unknown[],
  ): string;
  export function attachAcceptAttr(): string;
}

declare module "../../shared/composer-ime.mjs" {
  export function isImeComposing(event: unknown): boolean;
  export function composerEnterAction(event: unknown):
    | "ignore"
    | "newline"
    | "now"
    | "submit";
}

declare module "../../shared/error-actions.mjs" {
  export function classifyErrorAction(
    message: string,
  ): { kind: string; label: string } | null;
}

declare module "../../shared/copy-variants.mjs" {
  export function markdownToPlain(markdown: string): string;
  export function extractMarkdownTables(markdown: string): string[];
  export function markdownTableToTsv(table: string): string;
  export function copyPayloads(markdown: string): {
    plain: string;
    markdown: string;
    tables: Array<{ markdown: string; tsv: string }>;
  };
}

declare module "../../shared/chat-search.mjs" {
  export function searchableTimelineItems(items: unknown[]): any[];
  export function questionIndex(
    items: unknown[],
  ): Array<{ id: string; n: number; title: string; at?: number }>;
  export function searchTimeline(
    items: unknown[],
    query: string,
    limit?: number,
  ): Array<{
    id: string;
    kind: string;
    snippet: string;
    at: number;
    offset?: number;
    nth?: number;
    key?: string;
  }>;
  export function timelineHitKey(hit: {
    id?: string;
    nth?: number;
    offset?: number;
    key?: string;
  }): string;
}

declare module "../../shared/highlight-text.mjs" {
  export function mapCollapsedToOriginal(
    src: string,
    collapsedIndex: number,
  ): number;
  export function collapsedRangeToOriginal(
    src: string,
    start: number,
    length: number,
  ): { start: number; end: number };
  export function splitHighlight(
    text: string,
    query: string,
  ): Array<{ text: string; hit: boolean }>;
}

declare module "../../shared/flow-persist.mjs" {
  export const FLOW_KEY: string;
  export const DRAFT_PREFIX: string;
  export function draftStorageKey(sessionKey: string): string;
  export function sessionKeyFromDraftStorage(key: string): string;
  export function writeJsonItem(
    storage: Storage,
    key: string,
    value: unknown,
  ): { ok: boolean; error?: string };
  export function readJsonItem(storage: Storage, key: string): any;
  export function writeDraftRecord(
    storage: Storage,
    sessionKey: string,
    draft: unknown,
  ): { ok: boolean; error?: string };
  export function readDraftRecord(storage: Storage, sessionKey: string): any;
  export function readAllDraftRecords(storage: Storage): Record<string, any>;
  export function migrateInlineDrafts(
    storage: Storage,
    drafts: Record<string, unknown>,
  ): void;
}

declare module "../../shared/stale-bundle.mjs" {
  export function isBundleNewerThanLaunch(
    currentMtime: number,
    launchedMtime: number,
    slackMs?: number,
  ): boolean;
  export function bundlePathFromExec(
    execPath: string,
    platform?: string,
  ): string;
}

declare module "../../shared/queue-order.mjs" {
  export function moveQueuedItem<T extends { id: string }>(
    list: T[],
    id: string,
    dir: number,
  ): T[];
  export function editQueuedItem<T extends { id: string; text?: string }>(
    list: T[],
    id: string,
    text: string,
  ): T[];
  export function dropQueuedItem<T extends { id?: string }>(
    list: T[],
    id: string,
  ): T[];
}

declare module "../shared/error-actions.mjs" {
  export function classifyErrorAction(
    message: string,
  ): { kind: string; label: string } | null;
}

declare module "../shared/sidebar-chats.mjs" {
  export function pathFolderKey(p: string): string;
  export function folderDisplayName(p: string): string;
  export function groupSidebarChats(opts?: any): {
    projects: Array<{ cwd: string; name: string; chats: any[] }>;
    recent: any[];
  };
  export function visibleFolderChats(
    chats: any[],
    expanded: boolean,
    previewLimit?: number,
  ): any[];
}

declare module "../shared/workspace-org.mjs" {
  export function sessionOrgKey(cwd: unknown, sessionId: unknown): string;
  export function hasDraftContent(draft: unknown): boolean;
  export function stableProjectOrder(order: string[], known: string[]): string[];
  export function organizeFolderChats<T>(chats: T[], org?: any): T[];
  export function archivedChats<T>(chats: T[], archived: Record<string, number>): T[];
  export function shouldAbandonEmptySession(opts: any): boolean;
  export function timelineHasUserSpeech(items: unknown): boolean;
  export function mergeDraftSessions(sessions: unknown[], drafts: Record<string, unknown>): any[];
  export function duplicateProjectNames(projects: Array<{ name?: string }>): Map<string, number>;
  export function parentPathSnippet(cwd: string): string;
}
