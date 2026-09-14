# Grok Desktop：本机返修（登录闭环仍待本人）

## 版本

分支 `pro/complete-desktop-20260914`，草稿 PR #1。本说明对应该分支上本轮提交。输入为 `dc9765a4a83b6addf01ef262b618be7ff8228e74`。完整用户范围仍以 `docs/IMPLEMENTATION-BRIEF.md` 为准。前轮登录页 ok 不能当作本轮完成。

## 本轮关闭的缺口

1. 删除无消费者的 `web-pro:*` IPC / assignment / apply 写入。生产路径只剩 Preview MCP + `web-pro-handoff` Skill。Skill 必须从 snapshot 控件确认当前模型是 GPT Pro（中英、`Pro`/`专业版`，升级链接不算），并等到回复结束再读产物。Grok 用普通文件工具写入。
2. 接续导出按官方会话布局白名单；任意一级路径含 `mcp` 都不带走。`subagents/` 只保留文档允许的 `meta.json`。合成嵌套样例覆盖导入。
3. `--project` / `--open-preview` / `--handoff-prompt` 让独立候选打开合成项目、把 Preview 停在 ChatGPT，并让本对话里的 Grok 开始交办。登录页写入 `preview-launch.json` 且 `complete:false`。
4. 候选用标准 builder 参数生成独立 appId/productName，不手改 CFBundleName。

## 本机检查

macOS，Node 26.4.0，Electron 35.7.5，官方 grok 1.0.30。`npm run check` 784/784。未替换正式应用。

## 仍待真人

ChatGPT Preview 登录/验证码；登录后由候选里的 Grok 核对 Pro、交办、等待、回收、测试、返修。任务目录 `RESULT.md` 给出候选路径、PID、profile 与预期画面。
