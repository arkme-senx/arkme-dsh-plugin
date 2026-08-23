import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { TEXT_OUTPUT } from '../../shared/output.js'

type RecognizedOperation = 'list' | 'detail' | 'voiceprints'

export const voiceprintRecognizedPeopleToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.voiceprint.recognized-people.v1', toolName: 'arkme_voiceprint_recognized_people', kind: 'business', phase: 'core',
    effect: 'read', profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_voiceprint_recognized_people',
      description: 'List recognized people, read one person detail, or list a speaker projection\'s voiceprint records. A voiceprint item kind of authorized describes an asset source and does not change the person identityKind. The voiceprints operation is unavailable for authorized_user projections. Use each person_ref unchanged and never substitute grant_ref.',
      parameters: {
        operation: { type: 'string', required: true, enum: ['list', 'detail', 'voiceprints'], description: 'list or detail for any projection; voiceprints only when list/detail returns identityKind speaker.' },
        person_ref: { type: 'string', description: 'Unchanged person_ref from list. Required for detail; required for voiceprints and that projection must be identityKind speaker.' },
        cursor: { type: 'string', description: 'Unchanged nextCursor from list; omit for the first page.' },
        limit: { type: 'integer', description: 'List page size from 1 to 50; defaults to 20.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const operation = String(args.operation ?? '') as RecognizedOperation
        if (!['list', 'detail', 'voiceprints'].includes(operation)) throw new Error('operation 必须是 list、detail 或 voiceprints')
        if (operation === 'list') {
          return JSON.stringify(await ports.recognizedVoiceprintPeople({
            cursor: String(args.cursor ?? '').trim(), limit: args.limit === undefined ? 20 : Number(args.limit),
          }, { signal: exec.signal }), undefined, 2)
        }
        const personRef = String(args.person_ref ?? '').trim()
        if (!personRef.startsWith('arkme-voiceprint-person-v1.')) {
          throw new Error('person_ref 必须使用此 Tool 返回的原样引用，不能使用 grant_ref')
        }
        const result = operation === 'detail'
          ? await ports.recognizedVoiceprintPerson(personRef, { signal: exec.signal })
          : await ports.recognizedPersonVoiceprints(personRef, { signal: exec.signal })
        return JSON.stringify(result, undefined, 2)
      },
    })
  },
})
