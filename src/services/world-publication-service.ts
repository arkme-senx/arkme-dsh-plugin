import { createHmac } from 'node:crypto'
import { recordOwnerId } from '../record-owner-id.js'
import { EncryptedReferenceCodec } from '../encrypted-reference.js'
import type { WorldPublication, WorldPublicationRequest } from '../world-publication-contract.js'
import type { RecordService } from './record-service.js'
import type { ChatService } from './chat-service.js'
import type { WorldService } from './world-service.js'
import type { TeamWorldService } from './team-world-service.js'
import { ArkmePluginError, type ServiceRuntime } from './service.js'
const invalid = () => new ArkmePluginError('world-publication-invalid', '发布状态请求无效，请重新打开', false, 409)
export class WorldPublicationService {
  private codec: EncryptedReferenceCodec
  constructor(
    private runtime: ServiceRuntime,
    private record: RecordService,
    private chat: ChatService,
    private world: WorldService,
    private teams: TeamWorldService,
  ) {
    this.codec = new EncryptedReferenceCodec(() => runtime.stateStore.uniqueCode(), invalid)
  }
  async execute(input: WorldPublicationRequest, signal?: AbortSignal): Promise<unknown> {
    const session = await this.runtime.requireSession(),
      actor = session.userId,
      account = `${this.runtime.config.environment}:${actor}`
    if (!input || typeof input !== 'object' || input.accountKey !== account) throw invalid()
    const key = async (kind: string, uid: string) => createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(JSON.stringify([account, kind, uid])).digest('hex')
    const seal = (value: Record<string, unknown>) => this.codec.seal('world-publication', { ...value, account })
    const person = async (uid: string, requested: boolean): Promise<WorldPublication> => ({
      key: await key('person', uid),
      ref: await seal({ kind: 'person', uid }),
      kind: 'person',
      label: '个人世界',
      requested,
      pending: false,
      canUnpublish: requested,
    })
    const team = async (v: Record<string, unknown>): Promise<WorldPublication> => {
      if (!recordOwnerId(v.team_id) || typeof v.publication_uid !== 'string' || !/^team-world-[0-9a-f]{64}$/.test(v.publication_uid) || typeof v.can_manage !== 'boolean') throw invalid()
      if (v.can_manage === false) {
        if (v.public_requested !== true || v.pending === true || v.deleted === true) throw invalid()
        return { key: await key('team', v.publication_uid), ref: await seal({ kind: 'team-public', uid: v.publication_uid }), kind: 'team', label: typeof v.team_name === 'string' && v.team_name ? v.team_name : '团队世界', requested: true, pending: false, canUnpublish: false }
      }
      if (
        !recordOwnerId(v.team_id) ||
        typeof v.content_uid !== 'string' ||
        !v.content_uid ||
        !Number.isSafeInteger(v.revision) ||
        Number(v.revision) <= 0 ||
        ['public_requested', 'deleted', 'pending', 'can_manage'].some((k) => typeof v[k] !== 'boolean')
      )
        throw invalid()
      return {
        key: await key('team', String(v.publication_uid)),
        ref: await seal({
          kind: 'team',
          link: { team_id: recordOwnerId(v.team_id), content_uid: v.content_uid, revision: v.revision },
        }),
        kind: 'team',
        label: typeof v.team_name === 'string' && v.team_name ? v.team_name : '团队世界',
        requested: v.public_requested === true && !v.deleted,
        pending: v.pending === true,
        canUnpublish: v.can_manage === true && v.public_requested === true && !v.deleted,
      }
    }
    let result: unknown
    if (input.action === 'sources') {
      if (!Array.isArray(input.targets) || input.targets.length < 1 || input.targets.length > 50) throw invalid()
      const seen = new Set<string>()
      const targets = []
      for (const t of input.targets) {
        if (
          !t ||
          typeof t !== 'object' ||
          typeof t.itemUid !== 'string' ||
          !t.itemUid ||
          seen.has(t.itemUid) ||
          typeof t.sourceRef !== 'string' ||
          typeof t.messageActionRef !== 'string'
        )
          throw invalid()
        seen.add(t.itemUid)
        const resolved = await this.chat.recordEditHistoryTarget(t.sourceRef, t.messageActionRef)
        if (
          resolved.viewerUserId !== actor ||
          (resolved.kind === 'chat' && Number(resolved.recordOwnerUserId) !== actor)
        )
          throw invalid()
        targets.push({ itemUid: t.itemUid, uid: resolved.recordUid })
      }
      const uids = [...new Set(targets.map((t) => t.uid))]
      const [statuses, links] = await Promise.all([
        this.world.publicationStatuses(uids, signal),
        this.teams.sourcePublicationLinks(uids, signal),
      ])
      if (links.some((v) => typeof v.source_uid !== 'string' || !uids.includes(v.source_uid))) throw invalid()
      result = {
        items: await Promise.all(
          targets.map(async (t) => ({
            itemUid: t.itemUid,
            publications: [
              ...(statuses.get(t.uid) ? [await person(t.uid, true)] : []),
              ...(await Promise.all(links.filter((v) => v.source_uid === t.uid).map(team))),
            ],
          })),
        ),
      }
    } else if (input.action === 'management') {
      const p = await this.world.publicationPrincipal(input.recordRef, signal)
      const publications: WorldPublication[] = []
      if (p.team) {
        const link = await this.teams.publicationLink(p.team, p.uid, signal)
        if (link) publications.push(await team(link))
      } else if (String(p.owner) === String(actor)) publications.push(await person(p.uid, true))
      result = { publications }
    } else if (input.action === 'publish-source') {
      if (
        !input.origin ||
        (input.origin.kind && input.origin.kind !== 'record') ||
        !Number.isSafeInteger(input.version) ||
        input.version <= 0
      )
        throw invalid()
      const source = await this.record.worldPublishSource(input.origin.sourceRef, input.origin.itemUid, signal)
      if (source.version !== input.version)
        throw new ArkmePluginError('world-source-changed', '原内容已变化，请重新打开发布窗口', false, 409)
      result = await this.world.publishExistingSource(source, actor, signal)
    } else if (input.action === 'unpublish') {
      if (typeof input.requestUid !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestUid)) throw invalid()
      const ref = await this.codec.open('world-publication', input.publicationRef)
      if (ref.account !== account) throw invalid()
      if (ref.kind === 'person' && typeof ref.uid === 'string') {
        await this.world.unpublishExisting(ref.uid, actor, signal)
        result = { completed: true, pending: false }
      } else if (ref.kind === 'team' && ref.link && typeof ref.link === 'object') {
        const receipt = await this.teams.unpublishLink(
          ref.link as Record<string, unknown>,
          input.requestUid,
          actor,
          signal,
        )
        result = {
          completed: !receipt.pending && receipt.result?.visibility === 'unpublished',
          pending: receipt.pending || !receipt.result,
        }
      } else throw invalid()
    } else throw invalid()
    signal?.throwIfAborted()
    const current = await this.runtime.requireSession()
    if (current.userId !== actor || current.refreshToken !== session.refreshToken) throw invalid()
    return result
  }
}
