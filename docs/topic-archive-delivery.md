# 主题归档能力矩阵

本任务基于用户指定的 `dev`，不修改插件版本、根 README 或 DSH 源码。归档事实由 Record owner 裁决，插件不推导主题树状态。

| 能力面 | 接入 | 验证 |
| --- | --- | --- |
| Host | ArchiveService：账号引用、状态验证、CAS、目录失效 | archive-service / archive-host-api 测试覆盖越权引用、换账号、冲突、未知写结果和隐私；9 个相关测试文件共 201 项通过 |
| UI | 主题菜单；设置 → 数据管理 → 已归档；自身和继承分别呈现 | React 交互测试通过；打包产物装入隔离的官方 DSH Profile 后，Chrome 实际页面完成父子归档、父恢复、子恢复和空列表验收 |
| Tools | 列表、状态读取；独立标记写入使用 explicit-user-write | archive-runtime.test.ts 使用官方 Session / Inbox / ToolRuntime 验证发现、授权后写入及生命周期；打包端到端测试同时验证真实会话可见和读取 |
| SDK | listArchives/getArchiveStates/setArchiveState，能力发现、AbortSignal | 公开 SDK 单测通过；仓外 Consumer 只导入打包后的公开入口，严格类型编译及 Node 执行通过，包含不支持能力和 AbortSignal |

恢复父主题仅撤销该主题自身标记，子主题独立标记保留。仅继承的条目可单独归档或查看来源，不自动恢复祖先。隐私标题不从 sourceRef 的历史名称补齐；内容按原权限读取。复用 settings.section、Tools 正式注册与既有 Host API；不增加 DSH 私有扩展点。

## 可复现验证

测试目标：未修改的官方 DSH `d347e703908d0406b7a7ef80e3a0e594d86b2215`，版本 `0.1.3-alpha.1`；Node `24.19.0`。插件最初基于用户指定的 dev `e9ac7f135769d0569417d8c7dd13ff8cf040036a`，审查时已合入 dev `21ceaed083b3dc22f099981eb28bd5b10283b31b`。

先运行仓库 typecheck、build，再用 `pnpm pack` 生成产物。使用官方 `dsh plugin --profile web add <artifact.tgz> --ignore-scripts --ignore-workspace` 装入独立的 `DSH_HOME`，避免接触用户 Profile。

```bash
ARKME_DSH_CHECKOUT=<official-unmodified-checkout> \
ARKME_PACKED_PROFILE=<fresh-profile-with-packed-plugin> \
bash scripts/run-topic-archive-e2e.sh
```

runner 创建隔离 Record / Mongo / Redis / search 测试服务，并在结束时清理。本地真实链路通过；不代表修改或发布了 DSH。仓外 SDK 验证入口为 `scripts/verify-archive-consumer.mjs`，Consumer 源文件为 `tests/consumers/archive-consumer.mts`。

本轮原始日志在任务父目录：`dsh-archive-regression-final.log`、`dsh-archive-build.log`、`dsh-profile-install-v2.log`、`dsh-archive-consumer.log`、`topic-archive-cross-e2e.log`。页面截图为 `dsh-archive-e2e.png`。没有修改版本、根 README 或依赖锁文件，没有发布。

## 合并前审查与修复复验

- 目录订阅现有 Record 刷新通知，归档成功后立即隐藏；直接打开的主题和草稿保持原 owner。
- 主题菜单的确认框由稳定的 breadcrumb surface 持有，不随目录行消失而卸载；管理页也不因普通投影通知关闭确认框。失败可查看，CAS 不自动改用新 revision 重试。
- 分页按账号内稳定的 topicHierarchyKey 去重；带显示名的 sourceRef 更新不会生成重复条目。
- 列表分页和归档来源查询共用页面加载状态，避免交叉取消后一直显示加载中；切换账号取消旧请求。
- 完整 `pnpm test`：570 个文件通过、8 个跳过，6780 项通过、11 项跳过；typecheck、build、pack 通过。
- 最终不可变 tgz 通过官方 CLI 装入新的临时 Profile。真实 Chrome 从主题操作菜单归档 B/A，再从设置的数据管理恢复 A/B；确认目录及时更新、父恢复保留子标记、继承条目无误导性恢复入口。另验证归档前记录仍可读、归档后仍可写入/读取、CAS 冲突，以及真实会话 Tool 和仓外 SDK Consumer。

复验日志：`review-dsh-full-tests.log`、`review-dsh-typecheck.log`、`review-dsh-build.log`、`review-dsh-install3.log`、`review-dsh-cross-e2e.log`、`review-dsh-consumer.log`。运行证据为 macOS 官方 DSH + Chrome，不代表 Windows/Linux 已进行真实平台验收。
