import type { ArkmeRecordThought } from './record-thought-contract.js'
export const arkoReplyScenes = ['arko_chat', 'record_auto', 'record_mention', 'direct_receive', 'direct_sent', 'direct_mention', 'group_mention', 'group_auto', 'group_private_followup'] as const
export type ArkoReplyScene = typeof arkoReplyScenes[number]
export const arkoReplySceneInfo: Record<ArkoReplyScene, { title: string; description: string; trigger: 'automatic' | 'manual'; availability: 'existing' | 'pending' }> = {
  arko_chat: { title: 'Arko 对话', description: '你与 Arko 的直接对话。', trigger: 'manual', availability: 'existing' },
  record_auto: { title: '快记想法', description: '在发给自己的消息旁，给出有帮助的想法。', trigger: 'automatic', availability: 'existing' },
  record_mention: { title: '快记主动 @回应', description: '在发给自己中主动提问，结合可用的个人记录回应。', trigger: 'manual', availability: 'existing' },
  direct_receive: { title: '私聊回复建议', description: '收到消息后，帮助理解对话并准备回复，仅你可见。', trigger: 'automatic', availability: 'existing' },
  direct_sent: { title: '私聊后续建议', description: '发出消息后，在合适时给出后续沟通建议，仅你可见。', trigger: 'automatic', availability: 'existing' },
  direct_mention: { title: '私聊主动 @回应', description: '回应你在私聊中向 Arko 提出的明确问题，仅你可见。', trigger: 'manual', availability: 'existing' },
  group_mention: { title: '群聊公开回应', description: '回应群内的主动提问，内容对群成员可见。', trigger: 'manual', availability: 'existing' },
  group_auto: { title: '群聊私密提醒', description: '发完群消息后，在有价值时给你一条私密提醒。', trigger: 'automatic', availability: 'existing' },
  group_private_followup: { title: '群聊提问后的私密补充', description: '在公开回答之外，为提问者提供私人补充。当前生成链路待接通。', trigger: 'manual', availability: 'pending' },
}
export function arkoReplyScene(thought: ArkmeRecordThought, group: boolean, own: boolean): ArkoReplyScene {
  switch (thought.scene) {
    case 1: return 'direct_mention'
    case 2: return 'group_mention'
    case 3: return 'group_private_followup'
    case 4: return 'group_auto'
    case 5: return own ? 'direct_sent' : 'direct_receive'
    default: return thought.biz === 2 ? 'record_mention' : 'record_auto'
  }
}
