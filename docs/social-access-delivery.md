# 登录态社交资格交付记录

账号服务是唯一裁决方。登录和手机号写链未修改；独立匿名 World API 保留。UI 隐藏未获准的社交入口和内容，Tools / Host / SDK 执行端复核；个人记录、主题、DSH 会话和可信个人 Bot 保留。

| 能力面 | 集中接入与结果 |
| --- | --- |
| Host | SocialAccessService 使用账号作用域、2 秒请求期限和在途合并；不持久化服务侧许可。 |
| Tools | `arkme_social_access` 正式 catalog；业务调用复用 owner，旧引用和确认后执行仍受控。 |
| SDK | 公开 `socialAccess()`、capability discovery 与安全结果；不支持能力的 Provider 不派发业务。 |
| UI | 单一账号展示 owner；正常启动恢复持久快照，无快照时统一等待首次结果后呈现；前台和根页固定刷新；导航、菜单、正文、来源、分享目标、通知和通话运行时保持一致。 |
| 通话 | 未获准时不挂载 receiver、不轮询 outgoing intent；资格变化后清理运行时。供应商凭证和 SDK 直连不在本次范围。 |

验证完成：最新 dev 合入后 `pnpm exec vitest run --maxWorkers=2` 为 733 文件通过、9 跳过；8690 用例通过、13 跳过。构建通过。初始功能 tgz 在路径含空格的独立官方 DSH 安装并运行，未修改 DSH 源码或用户默认 Profile。

真实 DSH Agent session 已执行 false → true → 服务故障 → false 场景。外部独立 Consumer 仅导入公开 SDK，编译与真实 Host 调用通过。浏览器实际操作验证了联系人/世界/通话、作者联系与群入口在受限时隐藏，Quick Add 只保留 DSH 会话和 Bot；“发给自己”仍可打开编辑器。允许后社交入口恢复，故障后重新隐藏。React DOM 测试同时验证了通话轮询随资格启停。

验收产物为 `senguoyun-dsh-arkme-0.1.76.tgz`，SHA-256 与原日志定位由跨仓交付记录保存。未修改版本号或发布 npm。

测试使用隔离的账号/社交服务 fixture，不替代真实部署服务与供应商通话验收；fixture 关闭 DSH remote.session，因此没有把内嵌模型页实际聊天算作已验证。跨仓详细证据由同任务 jotmo-meta 的 `c20260922-phone-social-access` change 保存。

合并前复审的首轮全量出现三个时限/动画断言失败；对应单文件重跑 50 项通过，两个 worker 的全量重跑完全通过。历史官方 DSH 运行包与最新基线构建的证据分开记录；未发布新版本。

## 已绑定用户体验复核

同一账号已取得明确结果后，UI 刷新异常保留最近一次展示结果；明确 false 仍收起入口并停止通话轮询，切换账号清空快照。相同结果不重复发布，避免无变化刷新触发呈现更新。Host、Tools、SDK 的实时资格校验保持不变，UI 快照不作为执行许可。

本轮属于纯客户端状态修复：UI 为直接验证面，Host / Tools / SDK 无新增能力，其既有拒绝和账号隔离回归继续运行。新增测试先复现刷新后导航消失、轮询停止，再验证修复；相关 18 项通过，全量 738 文件、8751 项通过，9 文件/13 项跳过，类型构建与打包通过。最新产物通过官方 CLI 安装进全新 Profile；自动补 peer 时 registry 无法解析现有基线声明的 `dsh-scope >=0.1.5`，关闭自动补 peer 后仅完成了产物安装。可用的旧验收 runtime 为 rc.8，未用它冒充满足现有 peer 合同的运行时；本轮未完成新版 DSH 实际浏览器验收，不能沿用旧包的运行证据。

冷启动尚无资格结果、后端资格服务不可用，以及对端未绑定的情况仍存在体验差异；没有据此承诺所有已绑定用户在任何情况下都与基线完全无感。

## 正常首屏无补显修复

UI 按浏览器 origin、环境和账号保存最近一次后端明确 bool。启动在 layout effect 内恢复；没有快照时通过统一 SocialAccessPresentationBoundary 保持既有 DOM 根/编辑器挂载并暂不绘制，初次结果后同时呈现导航及内容。首次请求超过 3 秒释放个人界面；后台刷新不重复占位。未查询完成时不清掉选中的会话/世界，资格恢复会重新加载官方联系人入口。明确拒绝、切换账号、退出与迟到响应仍受控。

这是纯客户端展示缓存，不新增 Host API、服务端持久化、Tools 或 SDK 业务能力。能力矩阵：UI 为修改/验收面；Host / Tools / SDK 新增能力 N/A，仍使用原账号服务实时权限 owner，原拒绝和跨消费面回归通过。没有修改登录、版本号、根 README、DSH 或生产配置。

全量 740 文件 / 8764 用例通过，9 文件 / 13 用例跳过；后续新增官方联系人恢复用例的独立结果见跨仓首屏记录。类型构建及 tgz 通过。新增 tests/fixtures/social-access-startup-entry.tsx 使用生产边界与导航、隔离的本地 Host 响应做浏览器组件验收：无缓存首次 350ms 查询和缓存重启各 120 帧，均无“个人可见而联系人未补齐”的帧；刷新失败保留导航和输入，明确 false 隐藏联系人/通话/世界。该 fixture 不等于完整 DSH 验收。当前 DSH peer/runtime 缺口仍如上，不将历史包结果冒充最新运行证明。

## 最新 dev 集成后的复审

本轮纳入 dev 的共同群聊与“问 DSH／本地 Markdown”能力。共同群聊的持久缓存列表原先只检查登录，旧引用可能绕过社交资格；现在 list/sync 在 CommonGroupService.context 统一调用 requireSocialSession，再读取引用及缓存。页面、SDK、Tool 共用此入口，不新增持久状态、配置或结构。拒绝/依赖失败不读取本地群关系，不修改账号、群关系或缓存；恢复资格后原缓存可继续读取。

新增真实 ServiceRuntime + SQLite + Host/SDK/官方 DSH Tool runtime 测试覆盖 true → false/unavailable → true。真实 Chat + Mongo 的两条 opt-in 用例通过：工具分页 20/20/1、重启续读、显式移除；页面菜单、抽屉、分页、Chat 故障期间已获准缓存读取、恢复、改名和打开群聊。账号服务不可用时仍拒绝新的 Host 读取，UI 已确认的展示可保留；没有把完整离线读取算作通过。

“问 DSH”远程快记详情继续经过 openAccessibleSourceRef，纯本地文本导出使用已呈现内容；资格变化使会话 scope 切换并取消准备中的附件任务。同步更新了新增基线测试的已获准来源夹具、Host includeAttachments 默认参数和异步分页等待，未改变基线业务协议。全量 747 文件 / 8829 项通过，11 文件 / 15 项跳过；另行开启的两条 Chat E2E 均通过。类型检查、构建和 tgz 打包通过。完整 DSH 安装运行与实际平台限制，以同任务 Meta 最新合并前审核记录为准。
