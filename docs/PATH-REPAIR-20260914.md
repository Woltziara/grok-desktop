# 原生会话路径修复（连贯单元，非总任务完成）

输入为 bc7f7a6c9c2466b61da190846e8694cbe0ecadef；保留该提交的 macOS smoke profile 创建。
本轮从 Actions 34859559566 的 source 归档恢复，归档 SHA-256 为 d46230e932f5723d66ce99c27f95fa41a3570d5bd95b3b1979c5559f3c0380fe；本地原始 Git tree 与远端 a5c8cc96ca332b09ca4cdddaf46d4678f38e7cf9 一致。

迁移现在保留 path.resolve 后的 cwd 拼写，和 encodeSessionCwd、原生存储键、摘要、移动日志、界面返回及下一次 ACP load 一致。realpath/文件身份只用来识别别名与冲突，不再将目标静默改写为物理路径。不重编码旧 CLI 存储，不批量移动现有用户数据。

碰撞检查扫描同一物理项目的现存路径别名，包括空目录和失效链接。不同原生同 ID 数据拒绝覆盖；多个原生来源拒绝自动选择。连续/反向移动仍保留历史、附件原绝对引用和恢复备份。

实际执行：Linux x64、Node 22.16.0；原有锁定依赖归档。npm run check：类型检查、733/733 tests；npm run build 成功。新增五项测试使用实际 fs.symlinkSync 的项目别名，覆盖双向别名碰撞、摘要/历史/日志 cwd、连续/反向移动和中断恢复。原 session-move 测试保留，未将期望值改成 realpath。

macOS /var 与 /private/var、安装的 Grok CLI 和真实账号仍需宿主复验。真实子进程 ACP 测试的服务端是隔离测试 peer，不是 Grok 模型。其他未完成范围继续施工，不以本单元替代完整交付。
