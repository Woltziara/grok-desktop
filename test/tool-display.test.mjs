import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

const toolDisplayUrl = pathToFileURL(
  path.resolve("src/lib/tool-display.ts"),
).href;

const {
  formatThoughtInlineSummary,
  formatThoughtSummary,
  formatTuiDuration,
  formatToolInlineSummary,
  formatToolPlainSummary,
  formatWorkedFor,
  shouldShowThought,
  summarizeExecuteLabel,
} = await import(toolDisplayUrl);

test("edit summary uses filename, not line counts or the diff body", () => {
  const summary = formatToolPlainSummary({
    title: "Edit BubbleApp.swift",
    kind: "edit",
    status: "completed",
    raw: {
      target_file: "/Users/oscarwoltz/codex-quota-bubble/BubbleApp.swift",
      old_string: "let size = NSSize(width: 380, height: 500)\n",
      new_string: "let size = NSSize(width: 340, height: 430)\n",
    },
  });
  assert.equal(summary, "修改了 BubbleApp.swift");
  assert.doesNotMatch(summary, /NSSize/);
  assert.doesNotMatch(summary, /\+/);
});

test("busy edit uses progressive phrasing", () => {
  const summary = formatToolPlainSummary({
    title: "Edit src/App.tsx",
    kind: "edit",
    status: "in_progress",
    raw: { path: "src/App.tsx" },
  });
  assert.equal(summary, "正在修改 App.tsx…");
});

test("execute summary shortens the command", () => {
  const summary = formatToolPlainSummary({
    title: "Execute `npm run build`",
    kind: "execute",
    status: "completed",
    raw: { command: "npm run build" },
  });
  assert.equal(summary, "运行了 npm run build");
});

test("failed execute is a red-prefix line, not a gray suffix", () => {
  assert.equal(
    formatToolInlineSummary({
      title: "Execute `exit 1`",
      kind: "execute",
      status: "failed",
      raw: { command: "exit 1" },
    }),
    "✗ 运行失败",
  );
});

test("read / search / fetch summaries stay one line", () => {
  assert.equal(
    formatToolPlainSummary({
      title: "Read MessageList.tsx",
      kind: "read",
      raw: { path: "src/components/MessageList.tsx" },
    }),
    "读取了 MessageList.tsx",
  );
  assert.equal(
    formatToolPlainSummary({
      title: "Search",
      kind: "search",
      raw: { pattern: "tool-card", path: "src" },
    }),
    "搜索了 tool-card",
  );
  assert.equal(
    formatToolPlainSummary({
      title: "Fetch",
      kind: "fetch",
      raw: { url: "https://github.com/xai-org/grok-build" },
    }),
    "访问了 github.com",
  );
});

test("Chinese description on the tool call is kept", () => {
  assert.equal(
    formatToolPlainSummary({
      title: "Edit foo.ts",
      kind: "edit",
      raw: {
        path: "foo.ts",
        description: "调整窗口默认显示位置",
      },
    }),
    "调整窗口默认显示位置",
  );
});

test("TUI duration clock matches pager: 2.7s / 1m57s", () => {
  assert.equal(formatTuiDuration(2700), "2.7s");
  assert.equal(formatTuiDuration(0), "0.0s");
  assert.equal(formatTuiDuration(117_000), "1m57s");
  assert.equal(formatWorkedFor(117_000), "Worked for 1m57s");
});

test("thought summary formats running vs done", () => {
  assert.equal(formatThoughtSummary(2700, true), "Thinking… 2.7s");
  assert.equal(formatThoughtSummary(2700, false), "Thought for 2.7s");
  assert.equal(formatThoughtSummary(0, false), "Thought for 0.0s");
});

test("inline summaries use a gray mark, not emoji", () => {
  assert.equal(
    formatToolInlineSummary({
      title: "Read App.tsx",
      kind: "read",
      raw: { path: "src/App.tsx" },
    }),
    "· 读取了 App.tsx",
  );
  const edited = formatToolInlineSummary({
    title: "Edit App.tsx",
    kind: "edit",
    raw: {
      path: "src/App.tsx",
      old_string: "a\n",
      new_string: "b\nc\n",
    },
  });
  assert.equal(edited, "· 修改了 App.tsx");
  assert.equal(
    formatToolInlineSummary({
      title: "Execute `npm run build`",
      kind: "execute",
      raw: { command: "npm run build" },
    }),
    "· 运行了 npm run build",
  );
  assert.equal(formatThoughtInlineSummary(2700, false), "◆ Thought for 2.7s");
});

test("execute labels stay short: script name, git, heredoc", () => {
  assert.equal(
    summarizeExecuteLabel("bash /tmp/install-desktop.sh --force"),
    "install-desktop.sh",
  );
  assert.equal(summarizeExecuteLabel("git status"), "git status");
  assert.equal(
    summarizeExecuteLabel("python3 - <<'PY'\nprint(1)\nPY"),
    "python3 脚本",
  );
});

test("live thinking always shows; completed under 0.5s stays hidden", () => {
  assert.equal(shouldShowThought({ ms: 0, running: true }), true);
  assert.equal(shouldShowThought({ ms: 200 }), false);
  assert.equal(shouldShowThought({ ms: 500 }), true);
  assert.equal(shouldShowThought({ ms: 2700 }), true);
});
