# 成员目录合并前逐场景审查（2026-09-08）

## 结论

本轮审核了当前任务分支的完整改动，而非仅检查上一轮修复。逐项核对下表场景的触发入口、Host/服务端事实、缓存写入、UI 消费与失败恢复，复现并修复 6 类遗漏。随后按用户要求改为有内容时静默刷新。未新增业务状态机、依赖、轮询或独立成员数据源。

本报告列出已知需求及此前问题的完整核对清单。实际执行、代码链路确认与未执行环境明确区分；不将“没有发现更多问题”写成“任何场景绝无缺陷”。

## 本轮发现与修复循环

| 编号 | 触发与原问题 | 根因位置与最终修复 | 复现/复验 |
| --- | --- | --- | --- |
| F1 / P1 | 已退群、被移出、群停用后仍保留成员缓存 | Chat 实际返回 2001/2002；原判断只覆盖 403/1004。`member-directory.ts::invalidatesMemberSnapshot` 在成员读合同内统一识别，Host 与 Store 同时清除缓存 | Go Handler 精确断言 2001/2002；`member-directory-final-review` 与真实 Host/SQLite contract 在修复前失败、修复后通过 |
| F2 / P1 | 成员变更后新读取复用变更前未结束请求，可把旧成员再次写回 | `ChatService.memberRead` 去重键加入已有 memberCacheEpoch；缓存写入继续检查同一代次。无需新队列、锁或删除标记 | contract 中旧请求挂起→变更→清缓存→新请求，修复前上游只启动一次，修复后新读取独立启动且最终为空 |
| F3 / P2 | 旧缓存群主角色影响撤回、移除和退群历史入口；等待自己排到后续页会延迟管理操作 | Handler 复用访问校验已经读取的当前成员，逐页返回 self_role；Store 的 selfRole 仅由这些远端访问事实更新，缓存不填充，失效时归 unknown。Sidebar 不再从缓存行找角色 | 首页面含无关行、自己的行在后页，仍及时得到真实角色；缓存显示为 owner 时权限角色为 member。写权限仍由后端再次校验 |
| F4 / P2 | 已读详情切后台再回来，若角标不在 visible 集合就不恢复刷新 | `MessageReadReceiptStore.reconcile` 先刷新详情观察者，再处理可见摘要；复用既有定时器去重 | 先补“隐藏期间零刷新、回来只刷新一次”的失败测试，再修复通过 |
| F5 / P2 | 第一页 50 人被显示成群总人数，覆盖已知 500 人 | Sidebar 仅用无错误的完整目录更新总人数；刷新期间使用原有群投影人数。Store 刷新开始置 complete=false | 实际 Surface 测试：后页挂起仍显示 500 人且输入框可用，完整结果到达才更新总数 |
| F6 / P1 | 其他设备拉人/重新入群，当前打开的目录不刷新 | 实际 Chat→IM 已有 t=24；插件只接 t=27。新增独立 t=24 解码与 members-invalidated 事件，复用公共 Store；t=27 继续单独失效退群历史 | 解码、真实 SSE 流去重、Host 投影、Browser 路由测试；打包实例从 499 人收到 t=24 后自动恢复 500 人，无需重开抽屉 |

用户追加要求：删除成员标题“更新中”、已读详情“正在更新”和行内“正在读取资料”。保留旧行静默更新；未知统计留空并保留行高，不伪造零值。首次无数据仍有加载反馈，明确失败仍可重试。相关 UI 测试覆盖刷新期间标题不变、旧行不清空、不出现状态行。

## 场景→代码→证据清单

代码路径以插件仓为根；Chat 路径明确注明。表中的测试均为仓内可直接运行的测试文件。

| 场景 | 实际链路/事实边界 | 对应证据 |
| --- | --- | --- |
| S01 首次冷开，无本地缓存 | `use-conversation-members`→Store.ensure→loadPages；缓存和第一页并行，未命中不延迟网络 | `conversation-members-paging.test.ts`、打包冷启动 |
| S02 200/500 人逐页读取 | Host page→Chat handler→repository limit+1/user_id cursor；每页最多50（接口最大100），非前端全量切片 | `conversation-members-loading.test.ts`；Chat `member_page_test.go` 500人10页与 explain |
| S03 会话、抽屉、@和已读详情同时消费 | 同账号/群复用 entry/pending；UI 仅订阅快照 | `conversation-members-store.test.ts` 同时订阅与重开抽屉仅一次遍历 |
| S04 慢资料、两个任务占满 | loadPages 的生产者继续分页；drain 只限制资料并发为2 | `member-directory-review.test.ts` 两个任务阻塞时150人3页已可见；500人真实协调器负载测试 |
| S05 基础名片、真实统计与头像失败 | mergeMemberFacts 保留展示；statsKnown=false 表示尚未读取；mergeMemberPresentation 按成员保留不可用头像，更新已取得姓名/统计 | `member-directory-review.test.ts`、`conversation-members-cache.test.ts` |
| S06 当前姓名与缓存姓名不同 | 已读当前姓名优先；displayNameIsCurrent=false 时才订阅目录补展示 | `member-directory-contract.test.ts`、`message-read-receipt-detail.test.tsx` |
| S07 私人备注与公开@名称 | projectChatMembers→resolveChatMemberMentionDisplayNames；@正文用 mentionDisplayName，私人备注不能填公开名称 | `conversation-send-directory.test.tsx`、`mention-metadata.test.ts`；Chat member list/by IDs 公开名片测试 |
| S08 Bot、真人、@所有人 | Bot 候选独立 owner；真人需合法 mentionRef；all 是群提及范围而非某个人 | `conversation-send-directory.test.tsx` 群/私聊候选与发送测试 |
| S09 同名成员、未知邀请人 | join events 按 memberRef/eventId 合并，未知邀请人不以名字合并身份 | `member-directory-review.test.ts` 同名保留两人 |
| S10 跨进程重开、换端口 | SQLite 环境目录+user_id+群；当前签名验证后恢复，正常远端请求照发 | `conversation-members-cache.test.ts` reopen/空格路径；打包进程重启验收 |
| S11 缓存晚于远端、晚于新一轮重试 | current/revision/remoteProgress 阻止晚到缓存覆盖远端 | `conversation-members-paging.test.ts`、Store stale-result 测试 |
| S12 缓存损坏、过期、超容量、磁盘不可用 | readConversationMembers 白名单/版本/时间/大小校验；读写失败按miss；容量淘汰不截断伪造完整名单 | `conversation-members-cache.test.ts`、`member-directory-review.test.ts`；容量上限代码核对 |
| S13 旧缓存表升级 | 既有表增加 payload_bytes，一次性迁移；旧内容不重写，未知版本不进入渲染 | `conversation-members-cache.test.ts` 连续重开两次，验证旧JSON及无关记录保持不变 |
| S14 缓存引用失效与并发修复 | cachedSourceMembers 验证引用；forgetCachedMembers 仅移除失败refs，不清除并发新快照 | `member-directory-contract.test.ts`、cache 精确移除测试 |
| S15 首次/后页失败、超时、重试 | 失败保留已有行；重试复用公共ensure；重复/缺失游标失败，单遍历最多200页 | paging/store 错误、游标、后台重试测试；普通读取协调器超时/取消测试 |
| S16 畸形数组、重复ID、跨群页、伪造游标 | Host 验证来源/顺序/状态/limit；Store 校验更新合同，畸形响应不能成为空列表删除 | `member-directory-contract.test.ts`、store/paging 校验测试 |
| S17 未出现于实时遍历的旧成员 | 末页后以 members/by-user-ids 明确核验；缺席自身不等于删除 | `conversation-members-paging.test.ts` missing cached member 场景 |
| S18 退群/被移除/解散/授权撤销 | 服务端每页重新验证；Host/Store 识别真实2001/2002并清除；迟到cache及读取不能恢复 | Chat page Handler；`member-directory-final-review.test.ts`、contract |
| S19 移除成功/失败、阻止再加入 | removeGroupMember 先验证服务端回执，再失效代次和应用removedRef；失败不乐观删除。离群/解散成功后清群缓存 | `ChatService.removeGroupMember`、`GroupService.leaveGroup/dissolveGroup`；既有群治理与新epoch测试 |
| S20 拉人、已在群、重新激活、仅发邀请 | GroupService 按 add outcome 区分 added/already_member/reactivated；invite_sent不创建成员事实；UI onAdded仅要求回查 | `GroupService.addGroupMembers`、`group-settings-menu.test.tsx`及既有 GroupService 测试 |
| S21 变更时有共享旧请求 | 新读取去重键使用新代次；旧结果只能完成原调用，不能回填新缓存 | contract 真实协调器先红后绿场景 F2 |
| S22 资料迟到、成员已被移除 | applyMemberUpdate 只有 membership可创建，presentation只能更新已有实体；无额外墓碑状态 | `conversation-members-cache.test.ts` no resurrection |
| S23 角色缓存过期/自己位于后页 | self_role来自每页访问上下文，展示role不授予管理权限；GroupSettings仍读自身policy合同 | final-review 首页面角色测试、group-settings UI测试 |
| S24 快速切群、sourceRef轮换 | key按账号与sourceKey；不同群不复用旧行；能力引用变化取消旧工作并重新读取 | store/hook、`conversation-send-directory.test.tsx`跨群晚到/人数测试 |
| S25 切账号/环境、旧组件订阅 | activateAccount为生命周期owner；subscribe不切账号，未激活订阅不发请求 | `member-directory-review.test.ts`、read-receipt scope测试 |
| S26 运行实例变更、前后台、最后订阅者卸载 | reset/cancel/foreground和AbortSignal贯通；一个订阅者退出不杀其他订阅者 | store、cache reopen、avatar visibility与receipt store测试 |
| S27 重复SSE、其他设备加入 | t=24解码→ChatRealtime notice→members-invalidated→公共Store.invalidate；重复事件去重，历史窗口不受此类型影响 | `chat-realtime.test.ts`、`services/chat-realtime-service.test.ts`、`realtime-client-events.test.ts`；打包SSE回查 |
| S28 退群历史通知 | t=27保留eventId/occurredAt给member-event owner；成员目录只回查，不把事件直接拼成成员或已读数据 | 同上+t=27既有member-events/cache/hook测试 |
| S29 已读参与范围与当前成员名单不同 | messageReadReceiptDetail先验证当前用户消息与服务端参与集合；目录只提供展示，不计算谁读了或总参与人数 | `member-directory-contract.test.ts`、message-read-receipt系列与既有服务测试 |
| S30 详情/摘要并发、后到旧摘要 | detail更新summary后，旧摘要以loading entry身份校验跳过；详情single-flight不因TTL过期重复发起 | `message-read-receipt-store.test.ts` |
| S31 开着详情切后台/回前台 | 停掉观察者定时器；reconcile独立恢复详情，即使无可见角标 | 同上F4补充回归 |
| S32 消息输入、连续发送、失败恢复 | canSend只依赖草稿/admission/preparing；成员refreshing不进入发送门禁，partial rows不替换总人数 | `conversation-send-directory.test.tsx`连续发送与分页输入场景、打包输入并清空草稿 |
| S33 500行头像与组件卸载 | IntersectionObserver只订阅可见avatarRef，隐藏/卸载释放；不增加图片owner | `member-avatar-visibility.test.tsx`：0可见0加载，8可见8加载，500 observer释放 |
| S34 无感刷新 | 既有行保留，无“更新中”状态行；未知统计空白占位，真实失败仍可重试 | `group-settings-menu.test.tsx`、`message-read-receipt-detail.test.tsx`、打包延迟场景 |
| S35 Tools/SDK/UI一致与旧接口 | 新能力共用ChatService；正式Tools注册调用；仓外SDK只用公开导出；旧完整接口继续服务旧调用方，新UI无全量fallback | 正式DSH contract、仓外tgz consumer、打包UI、完整测试 |

## 不同概念的边界

成员身份不等于显示名称；成员加入失效通知不等于退群历史记录；当前群成员不等于消息已读参与集合；缓存展示角色不等于已验证访问角色；已加载页数不等于群总人数；头像失败不等于整批资料失败；邀请已发送不等于已经入群；通用业务2002冲突不等于任何业务都应删除数据——新增判断仅用于两个已核对的成员读取接口。

公共成员源没有双加载实现或自动全量降级；没有新服务、依赖或持久化状态机。必要的scope/revision、bounded queue及schema迁移继续由原owner持有。

## 验证记录与边界

最终测试数量、集成快照和打包结果见本节末尾补充。真实 Mongo 场景包括500人10页、已有索引、无COLLSCAN/SORT、inactive rows、50+1边界、翻页新增、空尾页、取消。官方DSH 0.1.1-rc.2三个成员Tools实际注册/执行/卸载，仓外SDK从tgz编译并调用，首个分页即可返回selfRole。

打包隔离实例的500人冷启动：10次基础分页、10次资料补齐；正常输入不受阻。进程重启并改变端口：成员请求560ms发出，缓存580ms返回，644ms时500行可见（相对于导航；相对于成员请求84ms），当时2秒延迟的远端尚未返回；随后改名/退群收敛499人。向同一SSE连接投递真实形状t=24后，无需重开抽屉自动恢复500人。

合成远端未实现部分Arko/内测群/目录偏好能力，其预期502不算成员场景成功证据，也不算全产品E2E。正式服务器MQ→IM开关、生产流量、Windows/Linux实机未执行，不能据本机模拟保证生产时延或跨平台结果。

Docker不可用；后端全量Docker E2E未通过执行。Mongo全包有前轮已在干净基线复现的既有失败；本轮实际原生Mongo新场景全部通过，未宣称后端全量全绿。没有推送、PR、生产发布或用户业务数据操作。


本轮静默展示打包复验：在实际成员分页仍有1个请求在途时，页面已显示500行，标题严格为“协作者（500）”，无“更新中／正在更新／正在读取资料”。预览沿用本任务隔离Profile和合成账号，保留在本机49773供用户继续查看，未替换正式客户端。

当前分支源码全量4681项通过、5项跳过；类型检查与构建通过。Chat `go test ./gin/api ./internal/chat` 两个受影响包全量通过，原生Mongo新分页专项及go vet另行通过。OpenSpec strict通过。

集成记录：先以6429e25为目标完成4733项测试；最终快照采用随后更新的5581c826。该目标新增Sentry依赖，原复用依赖目录不能代表目标依赖，已切换为临时目录独立安装后复验；没有修改任务分支依赖或锁文件。最终结果在下方记录。


最终集成门禁补充：5581c826合并快照的4790项测试通过（5项跳过），但独立依赖安装后确认该目标自身存在3处Sentry transport回调隐式any；该文件与目标基线完全相同，属于目标已有类型问题。当前任务分支已无冲突合入此精确基线，并仅给transport回调补入从makeNodeTransport推导的参数与返回类型，消除3处诊断，不改运行行为。版本、依赖和锁文件随官方基线同步，任务没有另行变更其值。


### 最终收口结果

- 当前任务分支已包含官方dev 5581c826，完整测试 **4790通过 / 5跳过**；typecheck、build、可执行入口校验通过。Sentry类型补齐后的相关85项测试及完整回归均通过。
- Chat受影响两个包全量测试、真实Mongo分页专项、go vet通过；OpenSpec strict通过。没有遗留已确认而未处理的本任务finding。
- 最终官方DSH安装产物沿用目标基线的0.1.47版本；正式Tools合同和仓外SDK编译/调用通过。SDK实际返回500缓存成员、50人第一页、selfRole=owner及有效游标。
- 最终预览实测标题为“协作者（500）”，500行可见，后台分页在途时无更新提示；预览继续保留，便于用户操作。
- 相对5581c826，package.json、锁文件、根README均无任务差异。没有远端push、PR或合并/部署操作；同步开发基线只发生于本任务本地分支。

在以上验证范围内，当前成员目录改动具备合并条件。发布顺序仍为Chat分页及self_role合同先到位，再接入插件；正式MQ/IM开关、生产负载及Windows/Linux实机验收不在本机模拟结果内。
