# 主动团队接待

能力矩阵：UI TeamOutboundDialog、Tool arkme_team_outbound_open、SDK teamOutboundOpen 都调用 TeamAppService 的 outbound.open。引用限定当前账号/Profile；云端按当前成员和外部账号资格授权。选人来源由原 owner 解析，不共享私人历史。

打开按团队与客户自然键恢复，Host 的 requestUid 仅保留最多64个本地规范目标，非永久云端打开审计。实际发送复用 TeamSendQueue 的冻结发送 UID。首条发布前不通知客户；输入、附件和历史由原 owner 管理。

访客当前会员与历史 sender 分离；失败清为 unknown，ID 传入实际私聊/备注请求时保持 int64 精度。

验收证据在本任务 validation 中更新。
