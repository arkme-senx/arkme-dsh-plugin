// Record records/create and topics/records/create share these strict input DTOs.
// Keep read-side/Chat snapshot fields out of the Record write contract.
const payloadFields = ['payload_kind', 'schema_version', 'text_state', 'forward_records']
const forwardFields = ['render_kind', 'source_type', 'forward_id', 'title', 'source_record_uids', 'summary_lines', 'comment_text', 'created_at', 'items']
const itemFields = [
  'record_uid', 'owner_id', 'owner_name', 'owner_avatar_ref', 'send_at', 'template_kind', 'title',
  'source_display_name', 'source_avatar_kind', 'text', 'text_format', 'file_count', 'image_count',
  'voice_count', 'file_names', 'availability', 'unavailable_reason', 'source_chat_session_uid',
  'source_rel_uid', 'source_seq', 'source_sender_user_id', 'source_sender_avatar_ref',
  'files', 'forward_records', 'call_record_snapshot',
]

function assertFields(value: Record<string, unknown>, fields: readonly string[]): void {
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) throw new Error(`json: unknown field "${key}"`)
  }
}

export function assertRecordForwardInput(body: Record<string, unknown>): void {
  const payload = body.content_payload as Record<string, unknown> | undefined
  if (payload === undefined) return // A separate forwarding comment is an ordinary text record.
  assertFields(payload, payloadFields)
  const forward = payload.forward_records as Record<string, unknown>
  assertFields(forward, forwardFields)
  for (const item of forward.items as Record<string, unknown>[]) assertFields(item, itemFields)
}
