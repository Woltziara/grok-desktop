# Grok Desktop

Grok Desktop 是面向日常工作的对话桌面：左边放项目和最近对话，中间讨论与推进事情，右边按需查看产物。它使用本机的 **Grok Build** 处理模型、技能、工具和会话，通过 Electron + React 提供桌面界面。

这是独立维护的 MIT 分支，源自 [liaan/grok-desktop](https://github.com/liaan/grok-desktop)，不是 xAI 官方桌面产品。

## 唯一版本入口

- 源码：当前仓库根目录，分支 `main`。
- 已安装应用：macOS 的 `/Applications/Grok Desktop.app`。
- 开发基线：`1.4.2-unified.1`。保留本地对话界面，吸收上游 1.4.2 的协议与稳定性修复。
- 旧源码副本和旧开发历史已退出开发路径。恢复归档是恢复点，不是另一套开发版。
- GitHub 源码与 Releases 安装包分开更新；下载前核对 Release 的版本，旧 Release 不代表当前主线。

## 日常使用

打开应用后可以直接开始说话，也可以从左边选择项目或旧对话。项目旁的加号新建该项目的对话；切换对话时，其他正在运行的回合继续保留。

- 空闲时按 Enter 发送。忙碌时 Enter/“插入”补充当前回合，“稍后”排到下一回合，Cmd/Ctrl+Enter 先取消再改方向。
- 草稿、附件和引用跟随各自会话。可以选择回复中的一段文字带入输入区，文件夹作为路径附件加入。
- 用 `/plan` 进入计划模式；审批、补充意见和资料确认使用正常对话入口。
- 输入区的“认识”查看或选择业务对象，支持纠正、撤回和关闭。没有选择对象时，不注入其他对象的认识。业务材料不随源码分发。
- 打开“浏览器”或输入 `/preview 网址`，使用 Grok 自己的浏览器窗口。在输入区点 `@浏览器` 引用当前页面，再告诉 Grok 要做什么；页面关闭、跳转或转交后，需要重新引用。失败发送可直接“重新引用”或“去掉引用”，原文保留。
- 浏览器使用自己的登录资料。首次登录由本人完成；它不会复制 Chrome、Edge 或其他应用的登录资料。Google / OpenAI 的真实登录兼容性仍在验收，详见功能状态。
- 账号、设置和工具管理在左下角。换 Grok 账号不会清空本机项目、对话或个人工具登录。

当前实现与仍需验证/继续的事项见 [功能状态](docs/FEATURES.md)。

## 本地构建

需要 Node.js 22+、npm，以及本机已安装并登录的 [Grok Build](https://docs.x.ai/build/overview)。

```sh
npm ci
npm run check
npm run dev
```

`npm run dev` 启动开发窗口。要生成完整 macOS 应用：

```sh
npm run pack
```

Apple Silicon 产物位于 `release/mac-arm64/Grok Desktop.app`。构建会检查类型、测试、实际打包依赖和 Helper/ASAR 完整性；不要用手工解包覆盖来制作新版本。

维护者检查隔离候选时，使用独立的 `--user-data-dir=/absolute/path`，确认运行信息指向该候选；正式替换前保留旧包及静止的用户数据恢复副本。不要在回合执行中替换应用。

## 数据在哪里

| 数据 | 归属 |
| --- | --- |
| 原始 Grok 会话、技能和认证 | Grok Build 的 `~/.grok` |
| 桌面项目排序、草稿和 Preview 登录 | `~/Library/Application Support/grok-desktop` |
| 可选择的工作认识 | `~/Library/Application Support/GrokDesktopWorkingKnowledge` |
| 源码与测试 | 当前仓库；不保存以上运行数据 |

Peer Sync 仍按明确范围处理文件资料，应用包单独传送。本软件源码不参与双向文件时间覆盖，工作认识目前留在本机；不能把文件复制当成 Git 合并或多机一致性保证。

## 许可证与来源

本仓库采用 [MIT](LICENSE)。第三方来源见 [NOTICE.md](NOTICE.md)，分支说明见 [FORK.md](FORK.md)。Grok Build 由其上游独立维护；本仓库不复制模型或重做 agent。
