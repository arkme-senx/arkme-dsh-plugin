import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'
import type { TeamWorldRequest } from '../../../team-world-contract.js'

export const teamWorldReadTool = defineArkmeCoreToolModule({
  meta: { id: 'business.world.team-read.v1', toolName: 'arkme_team_world_read', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
  create(ports) { return defineTool({ name: 'arkme_team_world_read', description: 'Read a team public feed, current publishing capabilities, manager-only originals, shared feedback, or your exact command receipt/activity. Feedback includes the public actor name, exact historical add/remove expression and current authorized original preview. Activity returns current public previews when readable; private original previews are omitted after management permission loss. Current previews are not historical body snapshots. Use current server capabilities: active members may publish; management and shared feedback have separate permissions. Use opaque returned references unchanged; leaving a team removes original access, not command facts.', parameters: {
    request_json: { type: 'string', required: true, description: 'JSON accountKey (environment:userId). action: context(jotmoId), feed(jotmoId,cursor?,limit?), originals(teamRef,deleted?,cursor?,limit?), original(contentRef), feedback(teamRef,afterSequence?,includeRead?,limit?), feedback-target(eventRef) to recheck current management and read the original plus exact-version read-only reaction target, status(requestUid), activity(teamRef?,cursor?,limit?) filters the authenticated actor by one team; preserve its scope-bound cursor, source(origin,version). source validates a Record/Arko/Bot selection or labels a local snapshot; never turns local input into cloud provenance.' },
  }, output: TEXT_OUTPUT, isConcurrencySafe: () => true, async execute(args, exec) {
    const input = JSON.parse(args.request_json) as TeamWorldRequest
    if (!input || typeof input.accountKey !== 'string' || !['context','feed','originals','original','feedback','feedback-target','status','activity','source'].includes(input.action)) throw new TypeError('Invalid team World read action')
    return taggedJSON('团队世界', await ports.teamWorld(input, exec.signal))
  } }) },
})
export const teamWorldWriteTool = defineArkmeCoreToolModule({
  meta: { id: 'business.world.team-write.v1', toolName: 'arkme_team_world_write', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
  create(ports) { return defineTool({ name: 'arkme_team_world_write', description: 'Only on explicit user request, publish/edit/withdraw/delete/restore a team-owned copy, upload its independent image, or acknowledge viewed feedback. Active members may publish; editing, withdrawal, deletion, restoration and shared feedback require their respective current server capabilities. Reuse the complete immutable command and requestUid after uncertain results. Restore stays private. Team images remain charged to uploader storage after leaving; personal source is unchanged.', parameters: {
    request_json: { type: 'string', required: true, description: 'JSON accountKey. submit: teamRef,contentRef? (required except new publish),requestUid,expectedRevision,change publish|edit|unpublish|delete|restore,draft? {title,text,format plain|markdown,sourceRef from source prepare,imageRefs,sourceAssetUids?,parentRef?}. image-upload: teamRef,contentRef?,contentUid (new publish requestUid),uploadUid,contentBase64,mimeType. feedback-read: teamRef,throughSequence exactly offered by a feedback read. Never invent references or silently retry with a new ID.' },
  }, output: TEXT_OUTPUT, async execute(args, exec) {
    const input = JSON.parse(args.request_json) as TeamWorldRequest
    if (!input || typeof input.accountKey !== 'string' || !['submit','image-upload','feedback-read'].includes(input.action)) throw new TypeError('Invalid team World write action')
    return taggedJSON('团队世界操作结果', await ports.teamWorld(input, exec.signal))
  } }) },
})
