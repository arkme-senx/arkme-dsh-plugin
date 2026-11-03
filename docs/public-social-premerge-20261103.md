# 公开社交合并前审查

本轮补齐公开群审批闭环，并统一公开设置的精确查询。界面沿用已有群“公开与展示”弹窗，群主在同一处查看、同意或拒绝待处理申请；审批通过仍只更新原审批事实，申请人再次进入时由原成员写链完成加入。

## 能力矩阵

| 能力面 | 入口与合同 | 共同 owner 与验收 |
| --- | --- | --- |
| UI | PublicGroupSettingsDialog / PublicGroupJoinRequests；PublicSocialDirectory | PublicSocialService；真实组件→SDK→Host→Go→Mongo 验证申请、拒绝、重新申请、同意、加入与移除后重新申请 |
| SDK | publicSocialRead / publicSocialWrite；公开导出请求/结果判别联合类型；publicSocialV1 能力探测 | 同一 PublicSocialService，账号 scope、分页/人物/申请引用采用加密引用，错误保留原权限语义，SDK dispose 生命周期不变 |
| Tools | arkme_social_read / arkme_social_write | 同一 PublicSocialPort；write 注册 explicit-user-write grant，由原 registrar 执行确认，读入口无写入路径；不向模型返回 user ID、group UID、request UID、Token 或头像签名 URL |
| 后端 | discovery 原接口；governance/join/list 与原 join/resolve | 原 chat_member、chat_group_join_approval、治理角色与成员加入 owner；无独立审批状态机或成员副本 |

首轮交接中只核验了通用 SDK call / Host operation，未确认公开社交 Tool 注册。本轮明确补齐正式注册、写入确认和命名 SDK 能力，不继续沿用“已有完整三面覆盖”的结论。

新增唯一索引以外的一条通用审批分页索引 `(chat_session_uid, status, request_at desc, request_uid desc)`：原审批集合只有 request_uid 唯一索引，无法有效支持管理员待办分页。该索引服务所有原生群审批，复用原集合；没有新增集合或临时工作队列。个人查看最近申请所用的 `(session, requester, request_at, request_uid)` 索引仍承担不同查询。

本地测试使用隔离 Mongo 副本集和固定测试账号；跨服务投递、真实账号资料及平台运行证据单独列出，不用本地替身结果代替。

## 最终验证与合并判断

- 定向：公开社交 UI/Host、Tools、registrar/catalog、facade 共 6 文件 107 项通过；typecheck、build、正式 tgz 打包通过。
- 真实链路：可复现桌面 runner 的十组检查通过，覆盖组件→SDK→Host HTTP→JWT/Go→Mongo；群主通过界面拒绝、同意，申请人重新申请和完成加入。资料、登录及旧端投递仍使用隔离替身。
- 正式安装包：SHA256 `8d2a18e3cb6d2be8ff36a3a45d576e62bc0e9f9e53d0f9c6949a1377a8a880a4`，未修改官方 DSH 0.2.1-rc.2；独立 Profile 中真实 Agent 发现两项 Tool，完成读取、等待确认、确认后写入、读回和测试登录清理。仓外 Consumer 在带空格目录完成编译和执行，包括 AbortSignal 与不支持能力错误。
- 完整扫描：1358 文件通过、3 失败、20 跳过；15357 项通过、3 失败、27 跳过。三项失败在干净目标 dev 独立复现：`message-preparing-integration` 的静态 focus 数量、`related-quick-notes-drawer` 的 mention 展示、`retained-call-production` 的通话保留挂载。随后新增草稿保留分支只重跑上述 107 项定向与构建/安装验收，不声称又跑过全量扫描。
- 后端目标 master 另有原始两项审核 Mongo 回归及根包事务边界登记失败，已在后端完整审查报告列明；不修改无关业务去掩盖红灯。

功能修复可提交开发分支继续集成；生产发布暂缓。真实资料、跨服务 MQ/Subject/Record/IM 与旧端投递、Redis 路由限频、真实规模容量及跨平台运行尚无完整验收证据。没有合入 dev/master、部署或操作真实业务数据。

## 最终上线前追加核验

任务分支已纳入最新目标 dev `364c2d46a28261122c50cfcea0da4a182a14454d`，未向 dev 合入任务改动。新增基线的模型功能只按目标分支原样集成，不计为本任务的 UI 设计变更。

与同事原始公开社交提交 `22422bf9b6fa163f70819932b43d317d5f3b2618` 的八项文件/组件 AST 对照全部一致：样式、世界页面、群设置入口完整文件相同；创建页、个人上架编辑器、个人世界群列表组件相同；目录主体 JSX 相同；群设置 JSX 只增加已获准的审批区。没有改创建页默认公开、导航、目录卡片、详情或个人展示表单。

最终发现并修复一处新增审批区的读取/处理竞态：刷新未完成时禁用审批按钮，避免迟到列表重显已处理项；沿用已有 loading/busy，不加状态机。回归测试先失败后通过。最新集成定向 11 文件 198 项通过；完整扫描再次执行，1359 文件/15392 项通过，3 文件/3 项失败，20 文件/27 项跳过，仍是前述已知基线失败。

最终安装包 SHA256 `526695ded101415b318c45a9d0fdd07ac69148e28be71552abc91ffbca181d14`，替代上一轮验收包。typecheck、构建、仓外 Consumer 已复验通过；该包在全新官方 DSH Profile 的真实 Agent 中完成读、确认后写、读回与登出，最终组件→Go/Mongo 十组检查通过。三项全量失败再次在最新 dev 的干净导出快照独立复现。服务端先发的详细合同、数据隔离和索引成本复核见后端 `docs/public-social-premerge-scenarios-20261103.md` 的最终复核章节；真实环境门禁没有因此被取消。
