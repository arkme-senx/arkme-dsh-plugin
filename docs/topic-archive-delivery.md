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

## 2026-09-17 异步状态返回后的归档 hover

review9 的真实浏览器复现了此前遗漏的顺序：打开菜单后归档按钮等待 owner 状态而禁用，鼠标先停在该按钮，状态返回后按钮已启用但背景仍透明；相邻重命名按钮为 `rgb(243, 244, 247)`。旧测试先等启用再移入鼠标，因此未覆盖此顺序。新测试仅延迟真实 Host 响应，不替换归档结果，失败证据为 `review-archive-hover-before-e2e.log`。

根因是手动悬停状态依赖 React mouse-enter 事件，禁用按钮期间不会按可用按钮方式更新；启用也不会自动重放移入事件。现删除这组菜单的悬停状态及事件回调，四个操作共用菜单作用域内的 CSS `:hover` / `:focus-visible`，按 `:disabled` 排除不可用动作。浏览器在状态变化后自动计算高亮，工作区及 body portal 使用同一规则，颜色消费现有主题 token。原生禁用、owner 状态读取、点击时 revision 和稳定页面写入 owner 保留。

本轮仅修改 UI 展示：Host 路由、SDK、Tools 和持久化能力没有变化，后面三者无需新增适配；既有跨仓测试仍验证其调用链。组件回归补充状态返回前不能写入、返回后使用实际 revision；浏览器回归覆盖提前悬停后启用、四项一致高亮、移出清除、键盘 Tab 聚焦，同时保留归档后不闪动及父子恢复闭环。

最终验证：3 个聚焦文件 21 项通过；受支持的 Node 24.19.0 下全量 604 文件通过/8 跳过、7099 项通过/11 跳过；typecheck/build/pack 通过。新包 review10 经官方 CLI 安装至全新临时 Profile，官方 DSH `fb2c4b9` 上实际浏览器 → Host → Record 完整场景 86 秒通过。已查看 `review-archive-hover-e2e.png.hover.png`，归档高亮与相邻项一致。日志为 `review-archive-hover-focused.log`、`review-archive-hover-node24-tests.log`、`review-archive-hover-typecheck.log`、`review-archive-hover-build.log`、`review-archive-hover-pack.log`、`review-archive-hover-install10.log`、`review-archive-hover-cross-e2e.log`。

不可变包为 `senguoyun-dsh-arkme-review10-0.1.60.tgz`，SHA-256 `61069d028fd0868d999b2f9a7400fdaa6311b2bab1467de38f43c3e8a1c05360`。清单未包含意外路径，client 产物及 source map 无本机用户绝对路径。仍在原任务分支、以已同步的 dev `d7daef1` 为开发基线；本轮读取的最新 dev `ae9c02e` 未改动这三个 UI 文件，没有为局部修复引入其他业务集成。官方 DSH tracked 状态干净，3081 常驻进程/真实 Profile、Flutter 和后端代码保持原状。运行证据为 macOS Chrome，未新增其他系统的运行结论。

## 2026-09-17 删除普通目录菜单的前置归档查询

用户再次指出刷新后首次打开菜单仍有禁用阶段。上节修复只解决了异步启用后的 hover，没有消除菜单展示对网络的依赖。本轮用 review10 包执行浏览器 reload 后打开操作菜单，明确复现按钮未立即可用，见 `review-archive-demand-before-e2e.log`。

普通目录由 Record owner 过滤归档成员，因此这里的用户意图固定为「归档」，无需为了显示按钮读取自身/继承状态。已删除独立 `ArkmeArchiveAction` 状态读取组件，改为与相邻项相同的普通菜单按钮；打开、悬停、重开或刷新后重新挂载均不为该动作发出状态请求。原生 hover/focus 样式保留，仅已有归档操作执行中禁止重复提交。

目录结构没有自身标记 revision；正常可见的主题可能曾取消过归档，不能假设 revision=0，也不能移除既有 CAS 保护。因此只在明确点击后由稳定页面的 mutation owner 执行「读取一次版本 → 明确设置 selfArchived=true」。读和写共用账号作用域、AbortController 与在途锁；管理页已有状态及 revision 的取消/独立归档继续直接提交，不增加一次读取。读取失败、不可用实体或账号/环境变化不会继续写入；冲突不重新读取并自动重放。过期目录中的主题即使已经归档，也只提交幂等的归档意图，绝不反转成取消。选中归档主题的状态提示读取属于独立展示场景，保留原语义。

这次只调整 UI 现有查询/命令的调用时机，无新 Host/Tools/SDK 接口、目录字段、集合、索引或缓存。聚焦 31 项、Node 24.19.0 全量 7109 项通过（604 文件通过/8 跳过，11 项跳过），typecheck/build/pack 通过。测试覆盖冷挂载零前置查询、点击后读取、在途重复点击、通知早于读取回执、过期行仍保留归档意图、读取失败/不可用/错实体、CAS 不重放、账号与环境变化。日志为 `review-archive-demand-focused.log`、`review-archive-demand-full-tests.log`、`review-archive-demand-typecheck.log`、`review-archive-demand-build.log`、`review-archive-demand-pack.log`。

review11 不可变包 SHA-256 `af54429bd2f491f9c696506bd6c10bfd2ba4f0afc1023eed4deb4ff787e7f986`，官方 CLI 安装到全新临时 Profile 后，真实 Chrome reload → 菜单立即可用/零动作前置查询 → 点击后读取一次版本 → 提交一次归档 → 父子恢复完整链路 32 秒通过。直接内容读写、CAS、SDK 和 Session Tool 验证继续通过。日志为 `review-archive-demand-install11.log`、`review-archive-demand-cross-e2e-final.log`；`review-archive-demand-e2e.png.hover.png` 已核验。首次链路的业务断言通过但测试拦截器延迟了后续可取消的状态展示请求，出现重复响应处理错误；拦截范围收敛为首次写入前置读取后重跑通过，未屏蔽错误，业务包未改变，失败日志保留为 `review-archive-demand-cross-e2e.log`。

本轮只提交原插件任务分支。版本、根 README、锁文件、官方 DSH 源码与用户 3081/Profile 均未修改；没有新增 Flutter/后端改动或生产写入。新截图来自隔离官方 DSH 0.1.5-rc.2 和真实 Record 测试服务。
