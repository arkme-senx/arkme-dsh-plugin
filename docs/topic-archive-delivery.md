# 主题归档能力矩阵

本任务基于用户指定的 `dev`，不修改插件版本、根 README 或 DSH 源码。归档事实由 Record owner 裁决，插件不推导主题树状态。

| 能力面 | 接入 | 验证 |
| --- | --- | --- |
| Host | ArchiveService：账号引用、状态验证、CAS、目录失效 | archive-service / archive-host-api 测试覆盖越权引用、换账号、冲突、未知写结果和隐私；9 个相关测试文件共 201 项通过 |
| UI | 主题菜单；设置 → 数据管理 → 已归档主题；自身和继承分别呈现 | React 交互测试通过；打包产物装入隔离的官方 DSH Profile 后，Chrome 实际页面完成父子归档、父恢复、子恢复和空列表验收 |
| Tools | 列表、状态读取；独立标记写入使用 explicit-user-write | archive-runtime.test.ts 使用官方 Session / Inbox / ToolRuntime 验证发现、授权后写入及生命周期；打包端到端测试同时验证真实会话可见和读取 |
| SDK | listArchives/getArchiveStates/setArchiveState，能力发现、AbortSignal | 公开 SDK 单测通过；仓外 Consumer 只导入打包后的公开入口，严格类型编译及 Node 执行通过，包含不支持能力和 AbortSignal |

恢复父主题仅撤销该主题自身标记，子主题独立标记保留。仅继承的条目可单独归档或查看来源，不自动恢复祖先。隐私标题不从 sourceRef 的历史名称补齐；内容按原权限读取。复用 settings.section、Tools 正式注册与既有 Host API；不增加 DSH 私有扩展点。

## 可复现验证

测试目标：未修改的官方 DSH `fb2c4b9e698e30edb738bca4cf0618587db7d203`，版本 `0.1.5-rc.2`；Node `24.19.0`。插件最初基于用户指定的 dev `e9ac7f135769d0569417d8c7dd13ff8cf040036a`，审查收口合入 dev `d5cc136bede1f4e1c70d20bfed990168d8880a38`。当前 0.1.60 版本及元数据全部来自 dev 的同步提交，归档差异不修改版本。

先运行仓库 typecheck、build，再用 `pnpm pack` 生成产物。使用官方 `dsh plugin --profile web add <artifact.tgz> --ignore-scripts --ignore-workspace` 装入独立的 `DSH_HOME`，避免接触用户 Profile。

```bash
ARKME_DSH_CHECKOUT=<official-unmodified-checkout> \
ARKME_DSH_REF=refs/tags/dsh-v0.1.5-rc.2 \
ARKME_PACKED_PROFILE=<fresh-profile-with-packed-plugin> \
bash scripts/run-topic-archive-e2e.sh
```

runner 创建隔离 Record / Mongo / Redis / search 测试服务，并在结束时清理。本地真实链路通过；不代表修改或发布了 DSH。仓外 SDK 验证入口为 `scripts/verify-archive-consumer.mjs`，Consumer 源文件为 `tests/consumers/archive-consumer.mts`。

初次实现日志在任务父目录：`dsh-archive-regression-final.log`、`dsh-archive-build.log`、`dsh-profile-install-v2.log`、`dsh-archive-consumer.log`、`topic-archive-cross-e2e.log`，对应早期 dev 与 DSH 0.1.3-alpha.1；最终基线证据以下方复验为准。没有修改版本、根 README 或依赖锁文件，没有发布。

## 合并前审查与修复复验

- 目录消费刷新通知，归档成功后及时隐藏；归档专用目录通知与 Record 内容通知的区分见下方最新复验。直接打开的主题和草稿保持原 owner。
- 按用户反馈，归档/取消归档改为单击直接提交，不显示二次确认弹窗。写请求仍由稳定 breadcrumb / 管理页持有，不随目录行消失或普通投影通知取消；在途禁止重复写，失败重读事实并显示简短提示，CAS 不自动改用新 revision 重试。
- 分页按账号内稳定的 topicHierarchyKey 去重；带显示名的 sourceRef 更新不会生成重复条目。
- 列表分页和归档来源查询共用页面加载状态，避免交叉取消后一直显示加载中；切换账号取消旧请求。
- 同步新的共享主题目录 owner 与外置菜单机制；归档写入仍由稳定 surface 持有。新建子主题回执早于/晚于父归档时，创建后重新核对目录归属，已打开主题保持可访问，继承归档节点不能被创建缓存重新显示。
- 上轮完整 `pnpm test`：593 个文件通过、8 个跳过，6953 项通过、11 项跳过；typecheck、build、pack 通过。
- 最终不可变 tgz 通过官方 CLI 装入新的临时 Profile。真实 Chrome 从主题操作菜单归档 B/A，再从设置的数据管理恢复 A/B；确认目录及时更新、父恢复保留子标记、继承条目无误导性恢复入口。另验证归档前记录仍可读、归档后仍可写入/读取、CAS 冲突，以及真实会话 Tool 和仓外 SDK Consumer。

复验日志：`review-dsh-ux-full-tests.log`、`review-dsh-ux-typecheck.log`、`review-dsh-ux-build.log`。最终打包链路和截图见下方本轮反馈验收。运行证据为 macOS 官方 DSH + Chrome，不代表 Windows/Linux 已进行真实平台验收。

同步最新 dev 后，曾用旧官方 0.1.3-alpha.1 重跑；其页面缺少当前 dev 使用的会话视口结构，浏览器在业务操作前超时。最终改用与 dev 已验收基线匹配的官方 0.1.5-rc.2，没有为旧宿主添加兼容分支，也没有修改 DSH 源码。runner 允许指定官方目标 ref，并继续要求 checkout 的 tracked 状态干净。官方依赖安装与构建分别记录在 `review-dsh-official-install.log`、`review-dsh-official-build.log`。


## 本轮体验修复

- 数据管理位于我的账户下方；通过既有生命周期可清理的设置导航图标适配器显示 Archive 图标。公开 settings.section 尚无 icon 参数，因此复用单一导航适配器，不伪造公共接口、不修改官方 DSH、不复用其他业务 section id。
- 页面使用既有 settings surface、shell、group 与标题间距；长标题省略、隐私标题受保护、操作区可换行。空状态仅显示归档图形，保留屏幕阅读器名称；移除常驻刷新按钮和业务实现说明。失败时提供重试读取，聚焦、联网及 Record 通知自动刷新。
- 主题菜单归档项与相邻操作复用同一 hover 样式。点击后直接提交并通过目录 owner 刷新移除，不出现确认弹窗；恢复操作也直接提交。查看来源是行内信息，必须点击该来源的取消按钮才会撤销其独立标记。
- 新增重复点击、切换同用户环境、旧响应隔离回归；菜单行被移除、通知先于回执、CAS 失败不重放、分页重命名去重等异步回归保留。
- 本轮修改仅为现有能力的 UI/客户端状态修复；Host、Tools、SDK 协议不变。仍以真实 Record + 打包插件浏览器验收核对跨层语义，并复跑公开 SDK Consumer。

上一轮不可变验收包为 `senguoyun-dsh-arkme-review6-0.1.60.tgz`，SHA-256 `bca5651a455e02b68bb6c993b1aa046e0b88fdcc251aa1cdd8e86a0e9a125b93`。官方 CLI 安装成功，真实浏览器跨仓链路 31 秒通过，公开 SDK Consumer 通过。日志为 `review-dsh-ux-install6.log`、`review-dsh-ux-cross-e2e.log`、`review-dsh-ux-consumer.log`；列表与空状态截图为 `review-dsh-ux-e2e.png`、`review-dsh-ux-e2e.png.empty.png`，已人工查看布局。包后只调整验收文档与测试说明，无运行代码差异。用户已有 3081 服务和真实 Profile 保持不变，本轮未替换常驻服务。

## 2026-09-17 选中主题归档刷新与视觉层级

归档写入原来复用整个 Record 内容失效通知，浏览器会硬清目录、刷新消息读取及日历/关联投影。旧打包产物的真实浏览器用例捕获到了归档后的额外 `source.timeline` 请求；旧包 DOM 节点保留检查本身通过，因此不把它描述为已复现整页 DOM 被卸载。

现在由既有实时通知 owner 发出 `topic-directory` 投影失效，仅失效发给自己主题目录。浏览器保留目录现有数据进行重读，目录刷新代次与消息内容代次分离；归档列表和菜单状态消费同一目录代次。既有 Record 内容、隐私和层级通知保持原处理。菜单回执不确定时仍重读 owner，不自动重放写入。已打开主题不在目录时向 archive owner 确认，确认为归档则保留选择与内容，不误切换到「全部」。普通 breadcrumb 和导航目录均遵循这一语义。

数据管理分类标题改为「已归档主题」。分类用字体和留白分层，去掉标题下重复横线；条目间才使用从文字处开始的细分割线，并统一紧凑行高。列表、空态最终截图已查看。

最终验证：5 个聚焦文件 112 项通过；完整 `pnpm test` 为 593 文件通过/8 跳过、6956 项通过/11 跳过；typecheck/build/pack 通过。真实 Chrome 选中 B 后归档 B，再归档父 A，验证两次操作均无额外消息列表请求、仍选中 B 且原消息节点一直连接；再完整验证父恢复保留 B/D、自身恢复及空态、CAS、实际 Record 内容读写和 Session Tool。公开 SDK Consumer 严格类型与 Node 运行通过。

最终不可变包 `senguoyun-dsh-arkme-review7-0.1.60.tgz`，SHA-256 `df39f0305208eb22ac4c9e7dba0172906480f1b2ad081a7c0286e51b064e1de8`。使用未修改官方 DSH 0.1.5-rc.2，由官方 CLI 装入新的 review7 临时 Profile。日志：`review-dsh-directory-unit.log`、`review-dsh-directory-full-tests.log`、`review-dsh-directory-typecheck.log`、`review-dsh-directory-build.log`、`review-dsh-directory-pack.log`、`review-dsh-directory-install7.log`、`review-dsh-directory-cross-e2e.log`、`review-dsh-directory-consumer.log`。旧包请求回归失败证据为 `review-dsh-flash-before.log`。截图：`review-dsh-directory-e2e.png`、`review-dsh-directory-e2e.png.empty.png`。包后仅调整测试断言和验收文档，业务产物不变；没有替换用户 3081 服务或真实 Profile。


最终继续同步 dev `437fda1c4af2280539fea51b2df27328d327cd59`，逐项核对重叠 facade/Host/SDK/types 中的文件接口与归档接口互不覆盖。补齐基线新增 `fileOpenLocalFolder` 的公共方法测试清单，未更改文件业务。默认并发下两条发布测试超过原 5 秒限制，最终使用命令级 `pnpm test --maxWorkers=4`（未改超时或仓库配置）完整通过：603 文件通过/8 跳过，7096 项通过/11 跳过。typecheck/build/pack 与仓外 Consumer 再次通过。

最终包为 `senguoyun-dsh-arkme-review8-0.1.60.tgz`，SHA-256 `d94ac8e9a78a6676cc504862d1df03be6cfcd970508ffe03f97e94dbba10f435`。官方 CLI 安装到全新 review8 Profile 后，真实浏览器完整归档场景 32 秒通过；最终列表/空态截图 `review-dsh-integrated-e2e.png`、`review-dsh-integrated-e2e.png.empty.png` 已查看。日志为 `review-dsh-integrated-tests-final.log`、`review-dsh-integrated-typecheck.log`、`review-dsh-integrated-build.log`、`review-dsh-integrated-pack.log`、`review-dsh-integrated-install8.log`、`review-dsh-integrated-cross-e2e.log`、`review-dsh-integrated-consumer.log`。打包后仅补充验收文档，无业务代码改动。用户 3081 服务与真实 Profile 未替换，官方 DSH tracked 状态干净。

## 2026-09-17 主题窗口后台更新闪动

上一轮已消除归档触发的内容读取，但完整目录后台重读时，菜单仍按 `loading` 插入「加载更多主题」行，改变窗口高度。本轮用 review8 包和实际浏览器 MutationObserver 复现：菜单及保留行没有卸载，但加载行确实被插入。证据为 `review-quiet-directory-before-e2e.log`；新增单测在修复前有两项失败，见 `review-quiet-directory-before.log`。

现在使用已有 `countsReady` 完整快照状态控制加载展示：只有不完整目录才显示加载行，完整目录后台校准期间保留原有菜单，owner 返回后仅更新实际成员。子主题加载行遵循同一条件；首次加载和失败重试仍可见。不新增本地归档状态，不在回执前猜测后代删除，不改变 Host/Tools/SDK、CAS 或账号隔离语义。

同步 dev `d7daef1` 后，5 个聚焦文件 52 项通过；完整 `pnpm test --maxWorkers=4` 为 604 文件通过/8 跳过，7098 项通过/11 跳过。typecheck、build、pack、仓外 SDK Consumer 通过。日志为 `review-quiet-directory-{tests,full-tests,typecheck,build,pack,consumer}.log`。

新不可变包 `senguoyun-dsh-arkme-review9-0.1.60.tgz`，SHA-256 `5912886940dd67e2a1fae7861e6573f0bb262bd788a992705c0cbe180d0b0abc`。经官方 DSH 0.1.5-rc.2 CLI 装入全新 review9 Profile，完整浏览器 UI → Host → Record 链路 37 秒通过。归档当前 B 和父 A 的全过程均断言菜单/保留行持续连接、无加载行插入、无额外内容读取；父恢复保留独立子标记、子恢复、内容读写、CAS 和真实 Session Tool 验证继续通过。证据为 `review-quiet-directory-install9.log`、`review-quiet-directory-cross-e2e.log`。列表及空态截图 `review-quiet-directory-e2e.png`、`.empty.png` 已核验。用户 3081 服务、真实 Profile 和官方 DSH 源码未修改。
