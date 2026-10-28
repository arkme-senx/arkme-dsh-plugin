import { createHash } from 'node:crypto'
import { recordingOwnerResponse, type OwnerTestRecording } from './recording-owner.js'

export function correctionOwnerResponse(path: string, body: Record<string, unknown>, data: { session_ls: Array<Record<string, any>>; child_ls: Array<Record<string, any>> }) {
  const recordings: OwnerTestRecording[] = data.session_ls.map(session => {
    const children = data.child_ls.filter(c => c.session_id === session.id)
    const items = (field: string) => children.flatMap(child => (child[field] ?? []).map((row: Record<string, any>, ordinal: number) => {
      const formal = row.effective_spk_id ?? row.q ?? session.spk_ls?.find((s: Record<string, any>) => s.num === row.n)?.spk_id ?? ''
      const partition = row.speaker_partition_id ?? ''
      const identity = partition || formal || `anonymous:${session.id}:${row.n}`
      return { text: row.t, start: child.start_at + row.s, end: child.start_at + row.e, childId: child.id, ordinal,
        soundSource: row.sound_source, containsPlayback: row.contains_playback,
        speaker: { reference: 'speaker:' + createHash('sha256').update(identity).digest('hex').slice(0, 16), kind: formal ? 'named' : 'anonymous', user_id: 0,
          label: formal ? (row.label ?? session.labels?.[formal] ?? '周鹏') : `说话人 ${row.speaker_display_number ?? row.n}` },
        edit: { s: row.s, e: row.e, source_number: row.n, assignment_number: row.n,
          revision: createHash('sha256').update(JSON.stringify(row)).digest('hex'), ...(formal ? { formal_speaker_uid: formal } : {}), ...(partition ? { partition_id: partition } : {}) },
      }
    }))
    return { id: session.id, startAt: session.start_at, duration: session.end_at - session.start_at,
      items: items('asr'), enhanced: items('doubao_asr'), revision: createHash('sha256').update(JSON.stringify(children)).digest('hex') }
  })
  return recordingOwnerResponse(path, body, recordings)
}
