# Grok Desktop：本机收尾实现（网页 Pro 登录仍待本人）

## 版本

分支 `pro/complete-desktop-20260914`，草稿 PR #1。本说明对应该分支上本轮提交，不以 `1.4.2-unified.1` 名称代替源码身份。输入归档提交为 `efb5635a98cbd201c507151d3c8ad0938ce55b1e`。完整用户范围仍以 `docs/IMPLEMENTATION-BRIEF.md` 为准。

## 本轮写进源码的结果

1. **插话回执丢失**与普通发送同一套未知结果分类：timeout、连接关闭、进程退出、disposed 等保留原文，标为 uncertain，重试必须明确确认。真实错误仍是 failed。
2. **发送箱事件**只发给正在显示该对话的窗口；队列状态里的原图字节不再随事件广播。第二窗口的大附件检查会失败如果我们再广播。
3. **会话接续**只带走官方会话材料（摘要/历史/附件/压缩检查点/子代理等），不再递归导出原生 `mcp/`。合成 token/Cookie/tool-output 样例不会进包。
4. **网页 GPT Pro**：桌面安装 `web-pro-handoff` 技能，交办记录落在本应用用户数据。第一次真实接线用生产 Preview 归属打开 `chatgpt.com`，读到登录页。没有把答案写进正式路径，没有拷其他浏览器登录。
5. **两机路径**：设置里导出选定对话/资料、工作认识独立入口、导出当前候选包。旧整机 mtime/登录搬运保持停用。
6. **临时源码运输 workflow** `apply-desktop-checkpoint.yml` 已删除；保留 `verify-desktop.yml`。

`bc7f7a6` 侧栏测试 profile 初始化与 `9c79f08` ASAR 等待写入完成仍在祖先中。

## 本机实际执行

macOS，Node 26.4.0，Electron 35.7.5，官方 grok 1.0.30。隔离 profile / GROK_HOME / WK，未动正式 `/Applications/Grok Desktop.app`。

| 检查 | 结果 |
| --- | --- |
| `npm run check` | 退出 0；TypeScript 通过；780/780 |
| `npm run test:delivery` | 通过，含第二窗口不接收另一对话原图、不确定发送不自动重放 |
| `npm run test:continuation` | 通过，生产设置/preload/主进程接续 |
| `npm run test:preview` | 通过，归属/lease/持久 Preview cookie |
| `npm run test:knowledge-transfer` | 通过，冲突选择与备份读回 |
| `npm run test:sidebar` | 通过 |
| 官方 CLI 布局接续 | 隔离 GROK_HOME 无登录（未拷凭据）；历史原话未改写 |
| Preview 打开 chatgpt.com | 绑定成功，停在登录页 |

## 未完成 / 宿主边界

- 真实 ChatGPT / GPT Pro 登录与完整网页返修仍需本人在隔离候选的 Preview 里登录。步骤见任务目录 `CODEX-STEPS.md`。
- 僚机 SSH `100.81.49.104` 本轮超时，未做两机实传。产品路径是接续包 + 工作认识入口 + 候选导出，不是旧 mtime。
- 正式安装替换与公开 Release 不在本轮。

候选包路径、sourceCommit、隔离 profile 与 `getInfo()` 身份以任务目录 `RESULT.md` 为准。
