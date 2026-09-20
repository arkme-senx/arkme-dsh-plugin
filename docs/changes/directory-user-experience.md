# 目录读取：用户体验收口

本轮继续 `codex/c20260909-dsh-read-recovery` 原任务树；不改服务端、Flutter 运行代码、版本号或生产环境。

## 根因与处理

1. `origin/dev` 已有“暂无联系人”文案。本次保留真正完整为空的空态；不完整、生成中、失败或仍有后页时不得显示空态。请求未完成时数字显示省略号，不把初始零值伪装成事实。
2. 联系人身份来自 Chat contacts/direct union，姓名与头像来自 Auth `get-public-users-by-ids`。该纯读此前未登记 Host 恢复，本轮加入原 Coordinator，最多三次技术尝试、保持总请求预算；不登记任何资料写接口。只有 Host 已耗尽恢复，目录才允许展示资料降级；已有姓名与头像保留。契约错误不被当成用户不存在，也不进入负缓存。
3. 页面追加成功原来会清掉前页资料缺失警告。本轮把显示集合的 `projectionState` 与请求状态分开，联系人追加保留未解决的逐页资料问题，完整刷新成功才清除；搜索不会将不完整资料宣称为完整无匹配。Audio 的整体投影状态仍以 owner 最新响应为准，不套用联系人逐页资料规则；未恢复到可信完整状态前，不据空页清除当前选择。
4. 联系人 `coverage=complete` 说明来源扫描完整，不说明当前返回页包含所有联系人。选中项仅在分页完成且可确认不存在后清除；搜索或核实后页选中项仍可继续后台分页。
5. 普通目录浏览由滚动边界自动加载下一页，五栏目共用原页面 loader；不再显示“加载更多”。Observer 绑定目录滚动容器，隐藏/加载中/失败时停止，重复通知不重复请求；无 Observer 的宿主使用滚动位置后备机制。搜索保持原完整检索要求，不改为只搜已加载内容。
6. 新首页缓存新鲜度仍为30秒；分页直接定位其签名快照，最多保留30分钟、最多四份，不因普通缓存过期重扫并把用户打回首页。显式刷新、账号/业务 revision、到期或容量淘汰仍受控失效，不跨快照拼页。
7. 去掉“已显示部分联系人，稍后重试可补全”和技术重试按钮。正常短暂故障在 Host 内恢复；耗尽后保留可用内容，只显示业务不可用文案与“刷新”操作。网络恢复/前台恢复可隐式重新读取，不叠加定时无限重试；生成中仍由 Audio owner 表达，不混同于传输失败。

## 边界

- 联系人部分身份只用于展示，不作为录音候选全集；权限、认证、契约错误不能吞掉。
- 服务端的限频、并发、未读和成员规则均未在本轮修改。存量 Flutter 没有新升级前置条件。
- 恢复次数由 Host 负责；UI 的网络/前台事件是新读取意图，不重放发送、创建、加入等写操作。
- Host/SDK/Tool 继续使用同一目录 owner；本轮无新增公开 API，新的分页保留规则对三个消费面一致。

## 验证

新增回归先出现六项红灯，覆盖不完整空态、跨页资料健康、后页选择、两种目录的30秒后分页、资料隐式恢复，随后修复通过。

复跑入口：`pnpm test`、`pnpm typecheck`、`pnpm build`；交互测试 `tests/contact-directory-scroll.test.tsx`，用户状态合同 `tests/directory-experience.test.tsx`，真实 Chat 联调沿用 `tests/read-recovery-live.test.ts`。浏览器模式提供61个 Bot 验证多页滚动，不把单页样本当多页验收。

最终插件全量：474 个测试文件通过、5 个跳过；5477 项通过、7 项跳过。`pnpm typecheck`、`pnpm build`、打包和 `git diff --check` 通过。日志：`/tmp/dsh-directory-ux-full-final3.log`、`/tmp/dsh-directory-ux-build-final.log`、`/tmp/dsh-directory-ux-pack-final.log`。

真实本地 Chat/Mongo/Redis 联调通过；官方 DSH 0.1.1-rc.2 隔离安装包浏览器验收通过：61 个 Bot 首次只读50个，停留超过30秒后滚动续至61个，没有“加载更多”按钮或分页重置；注入 direct 源持续失败后保留已有两位联系人，数字不冒充完整总数，不显示“暂无联系人”；恢复源并点击“刷新”后恢复两位联系人及正常计数，提示消失。记录：`/tmp/dsh-directory-ux-live.log`、`/tmp/dsh-directory-ux-browser.log`。网络恢复自动读取和不重复请求通过浏览器组件测试验证，不把组件测试称为真实断网验收。

最后一轮复审追加了 Audio owner 状态与联系人逐页资料的分离测试，重新运行完整测试、构建和打包，并重新安装最终包验证首屏50个 Bot 滚动续到61个。最终包 `../dsh-arkme-directory-ux.tgz` SHA-256：`3e94cb250f4889c99f448e323e41f79ba79dc1ef6f753cf7edc3f32ed4bea9d2`。最终包联调日志：`/tmp/dsh-directory-ux-browser-final.log`。

既有跨仓宽范围失败、生产用户4 trace 及 Auth/Bot/Audio/OpenAPI 真实远端验收缺口不因本轮 UI 修复而视为关闭；本轮未发布生产，也未修改 Flutter 运行代码。
