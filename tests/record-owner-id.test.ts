import { expect, it } from 'vitest'
import { parseOwnerJson, stringifyOwnerJson, recordOwnerId } from '../src/record-owner-id.js'

it('preserves synthetic Bot owner IDs across JSON and signed-reference payloads', () => {
  const raw = '{"record_owner_user_id":6690025278483443577,"sender_user_id":6690025278483443577,"seq":23,"text_content":"6690025278483443577"}'
  const data = parseOwnerJson(raw) as Record<string, unknown>
  expect(data.record_owner_user_id).toBe('6690025278483443577')
  const ref = JSON.parse(JSON.stringify({ recordOwnerUserId: recordOwnerId(data.record_owner_user_id) }))
  expect(stringifyOwnerJson({ parent_record_owner_user_id: recordOwnerId(ref.recordOwnerUserId) }))
    .toBe('{"parent_record_owner_user_id":6690025278483443577}')
  expect(stringifyOwnerJson(data)).toBe(raw)
})
it('retains safe human IDs and rejects already rounded or invalid identities', () => {
  expect(recordOwnerId(42)).toBe(42)
  expect(recordOwnerId('42')).toBe(42)
  for (const value of [6690025278483443577, -1, 0, '01', '1e3', '9223372036854775808', '1.2']) expect(recordOwnerId(value)).toBe(0)
  expect(parseOwnerJson('{"owner_user_id":42,"version":5}')).toEqual({ owner_user_id: 42, version: 5 })
})

it('keeps int64 boundary owners exact without rewriting unrelated strings or counters', () => {
  const raw = '{"child_record_owner_user_id":9223372036854775807,"root_record_owner_user_id":9007199254740992,"seq":9007199254740992,"title":"9223372036854775807"}'
  const parsed = parseOwnerJson(raw) as Record<string, unknown>
  expect(parsed.child_record_owner_user_id).toBe('9223372036854775807')
  expect(parsed.root_record_owner_user_id).toBe('9007199254740992')
  expect(typeof parsed.seq).toBe('number')
  expect(stringifyOwnerJson(parsed)).toBe(raw)
  expect(stringifyOwnerJson({ owner_user_id: '1,"admin":true' })).toBe(JSON.stringify({ owner_user_id: '1,"admin":true' }))
})

it('keeps publication Team IDs as decimal strings while ordinary owner IDs keep numeric wire tokens',()=>{const representation={team_id:'9223372036854775806',membership_kind:'member',membership_revision:3,group_join_at:9};const raw=stringifyOwnerJson({representation,origin_representation:representation,team_id:'9223372036854775806'});expect(raw).toContain('\"representation\":{\"team_id\":\"9223372036854775806\"');expect(raw).toContain('\"origin_representation\":{\"team_id\":\"9223372036854775806\"');expect(raw).toContain(',\"team_id\":9223372036854775806}');})

it('keeps decimal visitor strings and numeric int64 ID batches distinct on the wire',()=>{
 const encoded=stringifyOwnerJson({external_user_id:'9007199254740993',user_ids:['9007199254740993']})
 expect(encoded).toBe('{"external_user_id":"9007199254740993","user_ids":[9007199254740993]}')
})
