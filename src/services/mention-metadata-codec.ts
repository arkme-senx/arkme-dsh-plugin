import { createHash } from 'node:crypto'

export interface HumanMentionMetadata {
  user_id: number
  display_name_snapshot?: string
  start_index: number
  length: number
}

export interface BotMentionMetadata {
  bot_uid: string
  display_name_snapshot?: string
  start_index: number
  length: number
}

export interface MentionMetadataEntries {
  humans: HumanMentionMetadata[]
  bots: BotMentionMetadata[]
}

// New identities must carry a current snapshot; historical Record entries may lack it.
export interface ResolvedMentions {
  humans: Array<HumanMentionMetadata & { display_name_snapshot: string }>
  bots: Array<BotMentionMetadata & { display_name_snapshot: string }>
}

// The Record wire checksum excludes display snapshots and preserves mention order.
export function encodeMentionMetadata(text: string, mentions: MentionMetadataEntries): Record<string, unknown> {
  const checksum = {
    text_content: text,
    human_mentions: mentions.humans.map(m => ({ user_id: m.user_id, start_index: m.start_index, length: m.length })),
    bot_mentions: mentions.bots.map(m => ({ bot_uid: m.bot_uid, start_index: m.start_index, length: m.length })),
  }
  return {
    schema_version: 1,
    source_checksum: createHash('sha256').update(JSON.stringify(checksum)).digest('hex'),
    ...(mentions.humans.length ? { human_mentions: mentions.humans } : {}),
    ...(mentions.bots.length ? { bot_mentions: mentions.bots } : {}),
  }
}
