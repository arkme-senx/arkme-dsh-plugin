/** Only named social writes belong here. Reading/marking read, cancelling,
 * deleting and personal recording/AI operations retain their existing rules. */
export function socialWriteAction(operation: string, params?: Record<string, unknown>): string | undefined {
  switch (operation) {
    case 'world.publish-text': case 'world.publish-file-assets': return '发布到世界'
    case 'world.interactions.create-text': return '发表评论或回复'
    case 'related-recordings.share': return '共享录音'
    case 'contacts.team-join': return '加入团队'
    case 'contacts.add': return '添加联系人'
    case 'group.create': return '创建群聊'
    case 'group.members.add': return '邀请群成员'
    case 'team.create': case 'team.app.create': return '创建团队'
    case 'team.join-by-jotmo-id': case 'team.app.join': case 'dsh-beta-community.join': return '加入团队或社群'
    case 'team.app.send': case 'team.app.send.enqueue': case 'team.app.send.retry-task': case 'team.app.edit': return '发送消息'
    case 'calls.outgoing.prepare': case 'calls.invite.create': return '发起通话'
    case 'voiceprint.invite': case 'voiceprint.person.invite': case 'world.voiceprint.invite': return '发送声纹邀请'
    case 'reactions': case 'world.reactions':
      if (params?.action === 'set' && params.active === true && typeof (params.target as { worldRecordRef?: unknown } | undefined)?.worldRecordRef === 'string') return '参与互动'
      return undefined
    default: return undefined
  }
}
