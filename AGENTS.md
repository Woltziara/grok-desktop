# Grok Desktop 项目约定

本目录是唯一产品源码与 Git 工作区，常用分支为 `main`。产品方向以 [docs/INTENT-LOCK.md](docs/INTENT-LOCK.md) 为准；当前功能与待验证边界见 [docs/FEATURES.md](docs/FEATURES.md)，使用与构建说明只在 [README.md](README.md) 维护。

## 产品与运行

- Electron + React，通过 ACP 连接已安装的 `grok agent stdio`。模型、认证、技能、MCP、原生会话、工具与工作树由 Grok Build 提供。
- 保持非程序员的对话客厅、Paper & Ink、左项目/最近、中对话、右按需产物。不要把 Git、文件树、终端或诊断放回默认主页。
- Grok 账号与本机的项目、会话、个人工具分开；登出或切换 Grok 账号不得清空这些内容。
- Grok 原始会话仍在 `~/.grok/sessions`；桌面草稿、排序和阅读状态是 UI 状态，不是第二份会话正本。
- 工作认识是按业务对象明确选择的扩展：普通未绑定请求原文直通；业务材料只留在本机用户数据，不写入源码或发布包。探针必须显式启动。
- 现行发送语义：空闲 Enter 发送；忙碌 Enter/插入进入当前回合；“稍后”排队；Cmd/Ctrl+Enter 取消当前回合后发送。真实不支持插话才回退队列，其余错误明确返回。
- 所有新回合经 `GrokAcpClient.prompt()` 的同一 WK 边界；内部 followup/scheduled 不冒充用户原话。取消和失败不能提交不完整认识。

## 并行与版本

- 同一工作树、构建输出和应用安装目标只由一个执行者写入。需要独立施工时使用真实隔离的工作区并记录最终合入；不要复制整树到固定 `/tmp/grok-desktop-run` 后反复覆盖。
- 本地主分支承接公开 `origin/main` 的历史。上游 `upstream/master` 是参考输入；按行为吸收修复，不整体覆盖本地界面，也不强行合并无共同祖先的旧开发历史。
- 退役源码与历史只在项目外的恢复归档中保留，不作为构建输入。不要恢复旧 Tauri、旧 upstream clone 或旧静态目录。
- 本软件源码不参加 Peer Sync 的文件时间覆盖。应用包、源码版本、会话资料和凭据有不同的同步边界。
- 不把个人业务种子、访问材料、调试日志或运行数据放进 Git。

## 构建与交付

- `npm run check` 检查类型与测试；共享 `.mjs` 直接通过 JSDoc 参与类型推断，不新增无法解析的相对 ambient 声明。
- `npm run pack` 执行检查、渲染构建与 electron-builder。macOS 的 `afterPack` 实际检查 Helper 名称、ASAR 依赖、unpacked 文件和完整性哈希，再签名。
- 不把新代码叠入旧 ASAR，不单独修改 CFBundleName 来造测试版，不以源码依赖存在证明安装包依赖齐全。
- 正式 macOS 入口是 `/Applications/Grok Desktop.app`。切换前先备份旧包；无活动回合时停应用，静止备份 `~/Library/Application Support/grok-desktop`，再替换与读回。
- 隔离候选使用同一正确包结构与独立 `--user-data-dir=/absolute/path`。核对 `getInfo()` 的版本、PID、executable、appPath、userData/sessionData 后再测功能，不能误验正式旧进程。
- Preview 使用自身持久 Session。禁止导入其他浏览器的 Cookie/钥匙串；CDP 仅 loopback、随机端口，不允许任意网页 Origin。MCP 工具只能认领明确所属的 Preview。
- 实机验收至少覆盖打开应用、正常输入、会话恢复、插话/排队/取消、工作认识和 Preview。Mac 检查不冒充 Windows/Linux 验收；机制测试不冒充真实账号登录。
- 本地提交、源码推送、创建公开 Release、部署及用户验收分别记录。不要把旧安装 Release 当作当前源码的二进制交付。
