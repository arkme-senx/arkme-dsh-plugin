# Codex 真实团队授权

2026-10-27 起，团队云端同步不再限制为固定团队即我号。UI、Tools、SDK 继续使用现有 Host owner、数据格式和明确上传确认，不新增交互、白名单、灰度或配置。

插件通过已有 team.resolve/selectedTeam 获取所选团队的准确公开即我号，并与当前登录账号的正式 team/list-mine 结果唯一匹配真实 team_id。缺失、重复、非法 ID 和切号均拒绝。团队昵称不是身份或权限来源。

Team 后端用既有 GetActiveByTeamID 查询有效团队，所有者取 team.owner_user_id，其余账号必须有有效成员关系。来源和任务的 source_id/owner/team_id 绑定不会因改名、即我号复用或团队切换而转移；现有授权也不会跨账号或团队继承。

离队/解散后的本人历史沿现有 self 视图保留；团队视图按当前权限拒绝。本人图片和队列继续仅本人可读；标记、分享和私图使用各自原有授权边界。无 schema、索引或数据回填。

修改范围为 Host 团队解析与后端权限事实查询；公开 API、Tools、SDK 类型不变。普通团队的 onboarding、跨团队同意隔离、切号、来源重绑和真实 Mongo/HTTP 历史保护均有测试。原云端试用文档中限制 arkme_cn 的段落属于历史方案，以本文与 Team 当前接口合同为准。
