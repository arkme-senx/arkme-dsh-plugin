import { createHash } from 'node:crypto'
import type { ServiceRuntime } from './service.js'
import { ArkmeUpstreamResponseError, ArkmePluginError } from './service.js'
import type { RecordingService } from './recording-service.js'
import type { CallHistoryService } from './call-history-service.js'
import {
  transcriptViewStableJSON,
  personalTranscriptEntry,
  type PersonalTranscriptEntry,
  type TranscriptViewAttempt,
  type TranscriptViewCommand,
  type TranscriptViewReadItem,
  type TranscriptViewReference,
  type TranscriptViewSnapshot,
  type TranscriptViewTarget,
  type TranscriptViewReceipt,
} from '../transcript-view-contract.js'

const digest = (v: unknown) =>
  createHash('sha256').update(transcriptViewStableJSON(v)).digest('hex')
function transcriptFailure(error: unknown): never {
  if (error instanceof ArkmeUpstreamResponseError) {
    const data = error.responseData as { error_code?: string } | undefined
    const code = data?.error_code
    const messages: Record<string, string> = {
      revision_conflict: '另一台设备已更新这段文字，请保留输入并重新选择',
      original_changed: '原文已更新，请恢复当前原文后重做',
      operation_conflict: '这次操作已提交过其他内容，请保留输入并重新选择',
      invalid_command: '选区或操作参数无效，请重新选择',
      source_unavailable: '转写来源已删除或无权访问',
    }
    if (code && messages[code])
      throw new ArkmePluginError(
        `transcript-${code.replaceAll('_', '-')}`,
        messages[code]!,
        false,
        code === 'source_unavailable' ? 403 : 409,
      )
  }
  throw error
}
export class TranscriptViewService {
  constructor(
    private runtime: ServiceRuntime,
    private recording: Pick<
      RecordingService,
      | 'privateTranscriptTarget'
      | 'privateTranscriptSource'
      | 'validatePrivateTranscriptImport'
    >,
    private calls: Pick<
      CallHistoryService,
      | 'privateTranscriptTarget'
      | 'privateTranscriptSource'
      | 'validatePrivateTranscriptImport'
    >,
  ) {}
  private async target(ref: string): Promise<TranscriptViewTarget> {
    if (typeof ref !== 'string' || ref.length > 32768)
      throw new Error('转写来源无效')
    let value: TranscriptViewReference
    try {
      value = JSON.parse(ref)
    } catch {
      throw new Error('转写来源无效')
    }
    if (value.kind === 'recording' && typeof value.itemRef === 'string')
      return this.recording.privateTranscriptTarget(value.itemRef)
    if (
      value.kind === 'call' &&
      typeof value.callRef === 'string' &&
      value.target
    )
      return this.calls.privateTranscriptTarget(value.callRef, value.target)
    throw new Error('转写来源无效')
  }
  private async source(
    ref: string,
  ): Promise<Pick<TranscriptViewTarget, 'kind' | 'source_uid'>> {
    if (typeof ref !== 'string' || ref.length > 32768)
      throw new Error('转写来源无效')
    let value: import('../transcript-view-contract.js').TranscriptViewSourceReference
    try {
      value = JSON.parse(ref)
    } catch {
      throw new Error('转写来源无效')
    }
    if (
      value.kind === 'recording' &&
      'sessionRef' in value &&
      typeof value.sessionRef === 'string'
    )
      return this.recording.privateTranscriptSource(value.sessionRef)
    if (
      value.kind === 'call' &&
      typeof value.callRef === 'string' &&
      !('target' in value)
    )
      return this.calls.privateTranscriptSource(value.callRef)
    return this.target(ref)
  }
  private async session(account: string) {
    const session = await this.runtime.requireSession()
    if (account !== `${this.runtime.config.environment}:${session.userId}`)
      throw new ArkmePluginError(
        'transcript-account-changed',
        '账号已变化，请重新打开转写',
        false,
        409,
      )
    return session
  }
  async capabilities(signal?: AbortSignal) {
    const session = await this.runtime.requireSession()
    const caps = await this.runtime.authenticatedAudioPost<{
      protocol_version: number
      supported: boolean
      max_batch: number
    }>('/api/v1/audio/transcript-views/capabilities', {}, session, signal)
    await this.session(`${this.runtime.config.environment}:${session.userId}`)
    return {
      ...caps,
      accountKey: `${this.runtime.config.environment}:${session.userId}`,
    }
  }
  async read(
    account: string,
    scope: string | undefined,
    items: TranscriptViewReadItem[],
    signal?: AbortSignal,
  ): Promise<Record<string, PersonalTranscriptEntry>> {
    const session = await this.session(account)
    if (
      (scope !== undefined && !/^(recording|call):.{1,2048}$/u.test(scope)) ||
      !Array.isArray(items) ||
      items.length > 40 ||
      items.some(
        (x) =>
          !x ||
          typeof x.id !== 'string' ||
          !x.id ||
          x.id.length > 2048 ||
          ['__proto__', 'constructor', 'prototype'].includes(x.id),
      ) ||
      new Set(items.map((x) => x.id)).size !== items.length
    )
      throw new Error('转写读取参数无效')
    const resolved = await Promise.all(
      items.map(async (item) => ({
        item,
        target: await this.target(item.ref),
      })),
    )
    const out: Record<string, PersonalTranscriptEntry> = Object.create(null)
    const pending = new Map<string, TranscriptViewAttempt>()
    for (const { target } of resolved) {
      const key = digest(target),
        attempt = await this.runtime.stateStore.transcriptViewAttempt?.(
          account,
          key,
        )
      if (attempt) {
        const { operation_id: _, ...intent } = attempt.command
        if (
          digest(attempt.target) !== key ||
          digest({ target: attempt.target, intent }) !== attempt.fingerprint ||
          attempt.command.action === 'retry_pending'
        )
          throw new Error('转写恢复记录损坏，原信息已保留')
        pending.set(key, attempt)
      }
    }

    for (const kind of ['recording', 'call'] as const) {
      const group = resolved.filter((x) => x.target.kind === kind)
      if (!group.length) continue
      const input = {
        targets: group.map((x) => x.target),
        known_revisions: group.flatMap(({ item, target }) =>
          item.knownRevision === undefined ||
          item.knownPendingOperationId ||
          pending.has(digest(target))
            ? []
            : [
                {
                  ...target,
                  revision: item.knownRevision,
                  original_version: item.knownOriginalVersion,
                },
              ],
        ),
      }
      const path =
        kind === 'recording'
          ? '/api/v1/audio/transcript-views/read'
          : '/api/v1/trtc/transcript-views/read'
      const result =
        kind === 'recording'
          ? await this.runtime
              .authenticatedAudioPost<{
                items: TranscriptViewSnapshot[]
                unchanged?: TranscriptViewTarget[]
              }>(path, input, session, signal)
              .catch(transcriptFailure)
          : await this.runtime
              .authenticatedWebrtcPost<{
                items: TranscriptViewSnapshot[]
                unchanged?: TranscriptViewTarget[]
              }>(path, input, session, signal)
              .catch(transcriptFailure)
      const unchanged = result.unchanged ?? []
      if (
        !Array.isArray(result.items) ||
        !Array.isArray(unchanged) ||
        result.items.length + unchanged.length !== group.length
      )
        throw new Error('转写更正响应不完整')
      const seen = new Set<string>()
      for (const snap of result.items) {
        const key = digest({
            kind: snap.kind,
            source_uid: snap.source_uid,
            segment_uid: snap.segment_uid,
          }),
          row = group.find((x) => digest(x.target) === key)
        if (!row || seen.has(key)) throw new Error('转写更正来源不匹配')
        seen.add(key)
        out[row.item.id] = personalTranscriptEntry(snap, session.userId)
        const attempt = pending.get(key)
        if (attempt) out[row.item.id]!.pendingCommand = attempt.command
      }
      for (const target of unchanged) {
        const key = digest(target),
          row = group.find((x) => digest(x.target) === key)
        if (!row || row.item.knownRevision === undefined || seen.has(key))
          throw new Error('转写更正水位不匹配')
        seen.add(key)
      }
    }
    const local =
      scope === undefined
        ? undefined
        : await this.runtime.stateStore.localTranscriptEntries?.(
            account,
            scope,
            items.map((x) => x.id),
          )
    for (const item of items) {
      const entry = out[item.id]
      if (entry && entry.revision === 0 && local?.[item.id])
        entry.legacy = local[item.id]!
    }
    await this.session(account)
    return out
  }
  async receipt(account: string, operationId: string, signal?: AbortSignal) {
    const session = await this.session(account)
    const result = await this.runtime.authenticatedAudioPost<{
      receipt: TranscriptViewReceipt | null
    }>(
      '/api/v1/audio/transcript-views/receipt',
      { operation_id: operationId },
      session,
      signal,
    )
    await this.session(account)
    return result
  }
  async change(
    account: string,
    ref: string,
    input: TranscriptViewCommand,
    signal?: AbortSignal,
  ): Promise<PersonalTranscriptEntry> {
    const session = await this.session(account),
      target = await this.target(ref),
      key = digest(target),
      store = this.runtime.stateStore.transcriptViewAttempt
    if (!store) throw new Error('转写保存恢复记录不可用，请重试')
    if (
      !input ||
      !input.operation_id ||
      !Number.isSafeInteger(input.expected_revision) ||
      typeof input.original_version !== 'string'
    )
      throw new Error('转写更正参数无效')
    if (input.action === 'retry_pending') {
      const prior = await store.call(this.runtime.stateStore, account, key)
      if (!prior) throw new Error('没有待确认的转写操作，请刷新')
      if (prior.command.action === 'retry_pending')
        throw new Error('转写恢复记录损坏，原信息已保留')
      return this.change(account, ref, prior.command, signal)
    }
    const { operation_id: _, ...intent } = input,
      fingerprint = digest({ target, intent })
    let command = input
    const prior = await store.call(this.runtime.stateStore, account, key)
    if (prior) {
      const { operation_id: __, ...priorIntent } = prior.command
      if (
        digest(prior.target) !== key ||
        digest({ target: prior.target, intent: priorIntent }) !==
          prior.fingerprint
      )
        throw new Error('转写恢复记录损坏，原信息已保留')
      const known = await this.receipt(
        account,
        prior.command.operation_id,
        signal,
      )
      if (known.receipt) {
        if (
          known.receipt.operation_id !== prior.command.operation_id ||
          digest(known.receipt.target) !== key ||
          !Number.isSafeInteger(known.receipt.accepted_revision)
        )
          throw new Error('转写回执无效，原恢复信息已保留')
        await store.call(this.runtime.stateStore, account, key, null)
        if (prior.fingerprint === fingerprint) {
          return (
            await this.read(
              account,
              undefined,
              [{ id: 'current', ref }],
              signal,
            )
          ).current!
        }
      } else if (prior.fingerprint !== fingerprint) {
        throw new Error('上次更正结果尚未确认，请先重试核对')
      } else command = prior.command
    }
    const attempt: TranscriptViewAttempt = { fingerprint, target, command }
    await store.call(this.runtime.stateStore, account, key, attempt)
    const path =
      target.kind === 'recording'
        ? '/api/v1/audio/transcript-views/change'
        : '/api/v1/trtc/transcript-views/change'
    try {
      const body = { target, command },
        result =
          target.kind === 'recording'
            ? await this.runtime.authenticatedAudioPost<
                TranscriptViewSnapshot & {
                  accepted: boolean
                  receipt: TranscriptViewReceipt
                }
              >(path, body, session, signal)
            : await this.runtime.authenticatedWebrtcPost<
                TranscriptViewSnapshot & {
                  accepted: boolean
                  receipt: TranscriptViewReceipt
                }
              >(path, body, session, signal)
      if (
        !result.accepted ||
        result.receipt?.operation_id !== command.operation_id
      )
        throw new Error('更正结果尚未确认，请重试核对')
      const entry = personalTranscriptEntry(result, session.userId)
      if (
        digest({
          kind: result.kind,
          source_uid: result.source_uid,
          segment_uid: result.segment_uid,
        }) !== key ||
        digest(result.receipt.target) !== key ||
        !Number.isSafeInteger(result.receipt.accepted_revision) ||
        result.receipt.accepted_revision < 1 ||
        result.receipt.accepted_revision > result.revision
      )
        throw new Error('更正回执来源无效，原恢复信息已保留')
      await this.session(account)
      await store.call(this.runtime.stateStore, account, key, null)
      await this.session(account)
      return entry
    } catch (error) {
      // Known rejection cannot have accepted this command. Transport/unknown
      // failures retain the frozen attempt for an explicit receipt check.
      const data =
        error instanceof ArkmeUpstreamResponseError
          ? error.responseData
          : undefined
      const code =
        data && typeof data === 'object'
          ? (data as { error_code?: string }).error_code
          : undefined
      if (
        [
          'revision_conflict',
          'original_changed',
          'invalid_command',
          'operation_conflict',
        ].includes(code ?? '')
      )
        await store.call(this.runtime.stateStore, account, key, null)
      transcriptFailure(error)
    }
  }
  async saved(account: string, ref: string, after = '', signal?: AbortSignal) {
    const session = await this.session(account),
      target = await this.source(ref)
    if (after.length > 80) throw new Error('更正列表游标无效')
    const path = `/api/v1/${target.kind === 'recording' ? 'audio' : 'trtc'}/transcript-views/saved`,
      body = { kind: target.kind, source_uid: target.source_uid, after }
    const result =
      target.kind === 'recording'
        ? await this.runtime.authenticatedAudioPost<
            import('../transcript-view-contract.js').TranscriptViewSavedPage
          >(path, body, session, signal).catch(transcriptFailure)
        : await this.runtime.authenticatedWebrtcPost<
            import('../transcript-view-contract.js').TranscriptViewSavedPage
          >(path, body, session, signal)
    await this.session(account)
    if (
      result.historical !== true ||
      !Array.isArray(result.items) ||
      result.items.length > 40 ||
      typeof result.next_cursor !== 'string'
    )
      throw new Error('已保存更正响应无效')
    return result
  }

  async importLocal(
    account: string,
    scope: string,
    item: TranscriptViewReadItem,
    operationId: string,
    signal?: AbortSignal,
  ) {
    await this.session(account)
    const reference = JSON.parse(item.ref) as TranscriptViewReference
    if (reference.kind === 'recording')
      await this.recording.validatePrivateTranscriptImport(
        reference.itemRef,
        scope,
        item.id,
      )
    else
      await this.calls.validatePrivateTranscriptImport(
        reference.callRef,
        reference.target,
        scope,
        item.id,
        signal,
      )
    const local = (
      await this.runtime.stateStore.localTranscriptEntries?.(account, scope, [
        item.id,
      ])
    )?.[item.id]
    if (!local) throw new Error('未找到本机更正，原数据未删除')
    const current = (await this.read(account, scope, [item], signal))[item.id]!
    if (current.revision !== 0 || current.original !== local.original)
      throw new Error('本机更正与当前云端原文不一致，请逐项复核；原数据已保留')
    return this.change(
      account,
      item.ref,
      {
        operation_id: operationId,
        expected_revision: 0,
        original_version: current.originalVersion,
        action: 'import',
        import_text: local.text,
        import_marks: local.marks.map((mark) => ({
          id: mark.id,
          anchor: mark.anchor!,
        })),
      },
      signal,
    )
  }
}
