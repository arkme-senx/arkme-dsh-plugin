/** Reasons describe verified gaps in the current Team protocol, not user membership. */
export const teamMessageActionUnavailable = {
  reaction: '团队表态尚未接通，需要支持成员和外部用户的同步',
  link: '团队消息链接尚未接通，不能用团队入口链接代替原消息',
  forward: '团队消息转发尚未接通，需要确认目标对话和附件访问权限',
  report: '团队消息举报尚未接通',
  withdraw: '团队消息撤回尚未接通；删除不等同于撤回',
} as const
