# Grok Desktop：已写源码归档与交接（项目未完成）

## 本次边界与版本

本次只归档上一轮已交给用户的 23 个完整源码/测试文件，加上本说明；没有新增网页 Pro 往返或其他功能，没有重写这批文件。归档父提交为 `832ed7d79f57fd9da73382ed4a40300f7992a09a`，唯一分支为 `pro/complete-desktop-20260914`，对应 PR #1，继续保持草稿。包含本说明的归档提交完整 SHA 以 Git 提交对象及交接回复为准。

23 个原件共 322394 字节，逐文件 Git blob SHA 与 SHA-256 均已核对。将其原样叠加到父提交后、加入本说明前的完整 Git tree 为 `770e8407ef13111c1392c4635eff9955d6adb4f1`。GitHub 直接创建的树与本地从原始字节计算出的树一致；本次没有使用或扩张源码运输 workflow。

保留了父提交的全部其他文件及历史，包括 `bc7f7a6c9c2466b61da190846e8694cbe0ecadef` 的侧栏测试 profile 目录修复，以及 `9c79f08f07f868e87f4b825d9488ee7ce40e9d22` 的 ASAR 测试等待写入完成修复。两份文件的 blob 仍分别是：

- `test/electron/sidebar-move-smoke.mjs`：`5204e1f230b3f683a1cb9e1ef79f9bd88295ea74`
- `test/package-integrity.test.mjs`：`071c84d96daff090f4c476c8f96626a823b39fcb`

应用版本字段仍为 `1.4.2-unified.1`，不能单靠这个名称判断源码相同。依赖声明与父提交一致，`package-lock.json` 未改；本次 `package.json` 的变化是已有构建/测试脚本接线。

## 已归档实现

### 父提交已有、此次保留

已有 ACP 取消/新连接恢复、工作认识原话 ID 来源隔离与 Preview 所有权修复继续保留。会话移动路径及别名碰撞修复已在 `c27fe56056f8fcfacbb7794a2dc11be162447be3` 保存；持久发送箱、草稿及附件生命周期已在 `592d81e83dce97c69885730e3499fdc54bb88271` 保存；工作认识的显式导出/接入、版本关系、并发冲突选择及原件恢复已在 `832ed7d79f57fd9da73382ed4a40300f7992a09a` 保存。

详细范围继续见 `docs/PATH-REPAIR-20260914.md`、`docs/DELIVERY-REPAIR-20260914.md`、`docs/KNOWLEDGE-TRANSFER-20260914.md`。父提交对应的上一轮检查为 760 项；不能把下面本批 773 项结果归给未包含这 23 个文件的旧提交。

### 本次收齐的 23 个原件

普通会话接续：从设置中明确选择一段原生对话及项目资料，导出可校验接续包，在另一数据目录预览并确认接入。保留原生历史和附件，历史原话不进行路径字符串替换；另存旧路径到新路径的映射并接入 ACP 的会话规则。目标同 ID 或资料有差异时需明确选择，不按文件时间自动覆盖；预览后变化会阻止应用。接入前保存原件，记录中断状态，支持显式检查回退；中断后有新改动时拒绝自动回退。

草稿/阅读/发送箱接续：包含草稿、引用、原图 Blob、阅读位置以及发送箱记录。草稿接入前再次核对本机当前快照；接入后的发送箱暂停，未确认回执保留不确定状态，不自动重发。缺少的外部原件需重新选择。主进程、preload、设置组件与现有发送路径已经接线；没有建立第二条 ACP 协议实现。

Peer Sync 收紧：旧整机时间覆盖、远端配对/登录搬运及远端应用覆盖入口返回明确停用结果，不执行这些远端动作。资料包不用于覆盖本产品源码；工作认识继续走父提交已有的独立接续入口。明确排除的凭据/配置/依赖路径不参与资料接续，但普通业务文件仍可能含敏感内容，接续包不能当作已脱敏材料公开传播。

构建身份与候选导出：构建时写入源码提交、内容摘要、版本及工作区是否有修改。当前运行包信息可以读回；候选导出只接受带干净提交身份的当前 macOS 完整应用，生成归档与校验清单，不回退复制旧安装、不远程安装。这条 macOS 打包导出路径已有源码，尚未在 macOS 执行验收。

## 本次实际执行的验证

执行环境：Linux，Node `22.16.0`，Electron `35.7.5`，Playwright Core `1.63.0`。依赖来自先前 GitHub 验证 artifact 的 Linux 缓存恢复，本次没有进行新的联网 `npm ci`，不把缓存恢复称作全新安装验证。

| 命令/检查 | 实际结果 | 能证明的范围 |
| --- | --- | --- |
| 23 文件逐字节、blob 和树核对 | 全部一致 | 本次归档的是已交出的实际原件，不是重新编写的替代品 |
| `npm run check` | 退出 0；TypeScript 通过；773/773，失败/取消/跳过均为 0 | 这批源码叠加父提交后的机制回归，不等于全部用户路径验收 |
| `npm run build` | 退出 0，renderer 与构建身份生成成功 | Linux 上前端构建；不等于 macOS 完整安装包 |
| 首次 `npm run test:continuation` | 退出 1，容器继承的 DISPLAY 没有可用 X server | 测试宿主启动失败，未当作功能通过 |
| `env -u DISPLAY npm run test:continuation` | 退出 0，由原测试脚本使用 Xvfb | 真实 Electron 的设置组件、preload、接续 IPC、原生文件与草稿 Blob/阅读位置读回 |
| `env -u DISPLAY npm run test:delivery` | 退出 0，两次独立 Electron 进程通过 | 迟到回执保留后来草稿、后台会话隔离、附件准备期切换、重载及重启恢复、不确定发送不自动重放 |

Electron 测试使用合成资料、隔离 profile 和数据目录。接续测试的文件选择器与空闲检查由测试注入；发送测试使用测试 peer。它们没有调用真实 Grok 或 GPT Pro 账号，没有在两台物理机器之间传送业务数据，不能证明完整主应用权限门禁及真实 CLI 兼容已经验收。

本次提交前构建身份为父提交 `832ed7d...` 加 `dirty:true`，因为当时 23 个文件尚在工作区。其内容摘要为 `98400bdf477ca343e8fae044e181c472c491b4a86c4d39284a73eb9216536f46`（262 个构建输入文件），与上一轮提供的构建日志一致。最终归档后应从固定提交的干净 checkout 重新构建，使包内 `sourceCommit` 对应该归档提交、`dirty:false`；不能把旧的 dirty 构建直接当作新提交安装包。

构建仍有 theme-boot.js 的 module 提示及较大 chunk 警告；这次归档未修改源码消除警告。随交接核验包保留本次 `check.log`、`build.log`、首次显示服务失败日志、Xvfb 接续通过日志及发送箱两进程日志，并给出各文件 SHA-256；日志不作为生产程序或样例数据写入源码树。

## 完整变更清单

相对归档父提交：下列 23 文件为 11 个新增、12 个修改；另新增本说明，总计 24 个变更文件，无删除。A=新增，M=修改。

```text
M electron/acp-client.mjs
A electron/build-identity.mjs
A electron/continuation-ipc.mjs
A electron/continuation-pack.mjs
A electron/continuation-rules.mjs
M electron/main.mjs
M electron/peer-sync.mjs
M electron/preload.cjs
M electron/session-delivery.mjs
M electron/window-session.mjs
M package.json
A scripts/test-continuation.mjs
A scripts/write-build-identity.mjs
M shared/peer-sync.mjs
M src/components/settings/PeerSyncPage.tsx
A src/lib/continuation-flow.ts
M src/vite-env.d.ts
M test/agent-access-policy.test.mjs
A test/continuation-pack.test.mjs
A test/electron/continuation-preload.cjs
A test/electron/continuation-smoke.mjs
M test/peer-sync.test.mjs
A test/ui/continuation-harness.tsx
A IMPLEMENTATION-RESULT.md
```

## 未完成项与宿主待验边界

**网页 GPT Pro 完整开发往返仍未实现。** 没有完整的网页交办、等待/读取交付、源码接回、应用修改、执行测试、返修与报告闭环，也没有真实网页 Pro 验收证据。不能将已有 Preview 或工具名当作闭环完成，也不能把它描述成“只差账号验证”。此次用户只要求归档，未继续开发该功能。

仍需 Codex 在固定提交上进行本机阶段：

1. macOS 干净 checkout 执行 `npm run check`、`npm run build`，以及 `npm run test:preview`、`npm run test:sidebar`、`npm run test:delivery`、`npm run test:knowledge-transfer`、`npm run test:continuation`；记录实际平台、版本、完整输出与退出码。此前 macOS 结果不能自动覆盖新增文件。
2. 使用隔离数据目录验证 `/var` 与 `/private/var`、项目符号链接、同 ID 碰撞、连续及反向会话移动；用安装的官方 Grok CLI 实际恢复历史、发送、取消/恢复及权限请求，核对工作目录。测试 peer 只证明协议生命周期。
3. 真实账号分别正常登录，验证历史/工具登录不因 Grok 切号丢失，以及 Preview 本站会话跨重启；不索取或拷贝其他应用 Token/Cookie。
4. 两台机器分别对选定会话/资料和工作认识执行导出、预览、冲突选择、备份读回；覆盖两边各自纠正、撤回、预览后变化及中断恢复。核对发送箱不会擅自重放，未带入的外部附件有明确提示。
5. 从固定源码提交完整构建 macOS 候选，核对 `getInfo()` 的版本、进程路径、profile、源码提交与内容摘要，再验候选导出及校验清单；没有完成这些检查前不宣称两机同版本或安装完成。

原完整范围仍以 `docs/IMPLEMENTATION-BRIEF.md` 为准；773 项测试不是该范围全部兑现的证明。原有临时 `apply-desktop-checkpoint.yml` 仍留在父源码树中；本次不新增 payload、不触发源码应用、不扩张该流程，清理工作未完成，应由交接后的唯一写入者统一处理。现有普通 CI 可以验证归档提交，但不能冒充生产验收。

## 恢复与交接

先保护原生会话目录、桌面 userData、独立工作认识目录及用户项目资料；源码归档不包含这些原件或任何凭据。升级遵循 README/AGENTS 的完整构建与隔离候选路径，不把新源码叠入旧 ASAR，不用 mtime 把旧副本回灌。所有安装和两机部署都留在本机验收阶段，本次未执行。

直接 GitHub 归档读回成功后，本执行者停止向本分支写入，Codex 从交接回复给出的固定提交继续。PR #1 保持草稿，不合并 main、不强推、不发 Release、不部署。此次完成的是有界源码归档交接，整个 Grok Desktop 项目未完成。
