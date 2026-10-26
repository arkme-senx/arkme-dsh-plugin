import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'
import type { NativeAnnotationRequest } from '../../../native-annotations.js'
function parse(raw: string, write: boolean): NativeAnnotationRequest {
  const request = JSON.parse(raw) as NativeAnnotationRequest
  if (!request || !(write ? ['add', 'remove'] : ['capabilities', 'contexts', 'list', 'changes']).includes(request.action)) throw new TypeError('Invalid native annotation action')
  if (request.action === 'contexts' && request.targets.length !== 1) throw new TypeError('Resolve one source message at a time')
  return request
}
export const nativeAnnotationTools = [false, true].map(write => defineArkmeCoreToolModule({
  meta: { id: `business.conversation.native-annotations-${write ? 'write' : 'read'}.v1`, toolName: `arkme_dsh_annotations_${write ? 'write' : 'read'}`, kind: 'business', phase: 'core', effect: write ? 'write' : 'read', ...(write ? { grant: 'explicit-user-write' as const } : {}), profiles: ['business', 'hybrid'] },
  create(ports) { return defineTool({ name: `arkme_dsh_annotations_${write ? 'write' : 'read'}`, description: write
    ? 'Only after an explicit user request, mark an exact selected range or remove an own private DSH annotation. Use verified messageRef/sourceDigest and UTF-16 range from context. Reuse the same operationId after uncertain failure. This never edits or sends a message.'
    : 'Read private same-account DSH annotation capabilities, resolve one exact source message, list marks or read changes. Use runtimeRef/sessionRef/eventSeq from authorized DSH account history, never guess references. Context text preview is bounded to 2000 UTF-16 units.',
    parameters: { request_json: { type: 'string', required: true, description: 'NativeAnnotationRequest JSON. capabilities; contexts targets:[{runtimeRef?,sessionRef,eventSeq,role:user|assistant}]; list messageRefs; changes watches:[{messageRef,revision}]; add messageRef,operationId,anchor:{version:1,projection:arkme-text-v1,sourceDigest,start,end,text,prefix,suffix}; remove messageRef,operationId,annotationId.' } }, output: TEXT_OUTPUT,
    async execute(args, exec) {
      const request = parse(args.request_json, write)
      const value = await ports.nativeAnnotations(request, exec.signal)
      const safe = request.action === 'contexts' && Array.isArray(value) ? value.map(row => ({ ...row, canonicalText: String(row.canonicalText).slice(0,2000), textTruncated: String(row.canonicalText).length > 2000 })) : value
      return taggedJSON('DSH 个人标记', safe)
    } }) },
}))
