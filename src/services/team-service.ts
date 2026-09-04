import { OpenApiCapabilityError, type OpenApiTeamCapabilityClient } from '../openapi-capability-gateway.js'
import type {
  ArkmeDirectoryPage,
  ArkmeGroupAvatarFallback,
  ArkmeTeam,
  ArkmeTeamCreateItem,
  ArkmeTeamCreateResult,
  ArkmeTeamJoinItem,
  ArkmeTeamJoinResult,
  ArkmeTeamMember,
  ArkmeTeamMemberPage,
  ArkmeTeamMembershipState,
  ArkmeTeamPage,
  ArkmeTeamResolution,
  ArkmeTeamResolveItem,
  ArkmeTeamRole,
} from '../types.js'
import { ArkmePluginError } from './service.js'

const TEAM_REF_PATTERN = /^team_v1_[A-Za-z0-9_-]{32}$/
const USER_REF_PATTERN = /^usr_v1_[A-Za-z0-9_-]{32}$/
const CURSOR_PATTERN = /^cur_v1_[A-Za-z0-9_-]+$/
const ITEM_ID_PATTERN = /^\S{1,64}$/u
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const TEAM_CREATE_JOTMO_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{5,31}$/
const TEAM_LOOKUP_JOTMO_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{5,31}$/
const USER_JOTMO_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{4,31}$/
const TEAM_MEMBER_AVATAR_BUDGET_MS = 1_500

export interface TeamServicePort {
  list(options?: { limit?: number; pageCursor?: string; signal?: AbortSignal }): Promise<ArkmeTeamPage>
  resolve(items: readonly ArkmeTeamResolveItem[], signal?: AbortSignal): Promise<ArkmeTeamResolution[]>
  listMembers(teamRef: string, options?: { limit?: number; pageCursor?: string; signal?: AbortSignal }): Promise<ArkmeTeamMemberPage>
  create(items: readonly ArkmeTeamCreateItem[], signal?: AbortSignal): Promise<ArkmeTeamCreateResult[]>
  joinByJotmoID(items: readonly ArkmeTeamJoinItem[], signal?: AbortSignal): Promise<ArkmeTeamJoinResult[]>
  listDirectory(options?: { limit?: number; cursor?: string; countOnly?: boolean; signal?: AbortSignal }): Promise<ArkmeDirectoryPage>
}

export interface TeamMemberAvatarPort {
  publicAvatarPresentationsByArkmeIds(
    arkmeIds: readonly string[],
    signal?: AbortSignal,
  ): Promise<ReadonlyMap<string, { avatarRef?: string; avatarFallback?: ArkmeGroupAvatarFallback }>>
}

export class TeamService implements TeamServicePort {
  constructor(
    private readonly client: OpenApiTeamCapabilityClient,
    private readonly avatars: TeamMemberAvatarPort,
  ) {}

  async list(options: { limit?: number; pageCursor?: string; signal?: AbortSignal } = {}): Promise<ArkmeTeamPage> {
    const limit = pageLimit(options.limit, 100, 50)
    const pageCursor = optionalCursor(options.pageCursor)
    const data = await this.execute(options.signal, signal => this.client.list({
      limit,
      ...(pageCursor === undefined ? {} : { page_cursor: pageCursor }),
    }, signal))
    const source = object(data, '团队列表响应无效')
    const items = array(source.items, '团队列表响应无效').map(team)
    const totalCount = nonNegativeInteger(source.total_count, '团队列表响应无效')
    const hasMore = boolean(source.has_more, '团队列表响应无效')
    const nextPageCursor = responseCursor(source.next_page_cursor, hasMore)
    if (items.length > limit || totalCount < items.length) throw invalidResponse()
    return { items, totalCount, hasMore, ...(nextPageCursor === undefined ? {} : { nextPageCursor }) }
  }

  async resolve(items: readonly ArkmeTeamResolveItem[], signal?: AbortSignal): Promise<ArkmeTeamResolution[]> {
    boundedBatch(items)
    const seen = new Set<string>()
    const requestItems = items.map(item => {
      const itemId = item.itemId.trim()
      const query = item.query.trim()
      if (!validItemId(itemId) || seen.has(itemId) || query === '' || [...query].length > 100) invalidInput()
      seen.add(itemId)
      const limit = pageLimit(item.limit, 10, 5)
      const pageCursor = optionalCursor(item.pageCursor)
      return { item_id: itemId, query, limit, ...(pageCursor === undefined ? {} : { page_cursor: pageCursor }) }
    })
    const data = await this.execute(signal, active => this.client.resolve({ items: requestItems }, active))
    const responseItems = array(object(data, '团队解析响应无效').items, '团队解析响应无效')
    if (responseItems.length !== requestItems.length) throw invalidResponse()
    return responseItems.map((value, index) => {
      const source = object(value, '团队解析响应无效')
      const itemId = requiredString(source.item_id, 64, '团队解析响应无效')
      if (itemId !== requestItems[index]!.item_id) throw invalidResponse()
      const candidates = array(source.candidates, '团队解析响应无效').map(team)
      if (candidates.length > requestItems[index]!.limit) throw invalidResponse()
      const hasMore = boolean(source.has_more, '团队解析响应无效')
      const nextPageCursor = responseCursor(source.next_page_cursor, hasMore)
      return { itemId, candidates, hasMore, ...(nextPageCursor === undefined ? {} : { nextPageCursor }) }
    })
  }

  async listMembers(teamRef: string, options: { limit?: number; pageCursor?: string; signal?: AbortSignal } = {}): Promise<ArkmeTeamMemberPage> {
    const normalizedTeamRef = teamRef.trim()
    if (!TEAM_REF_PATTERN.test(normalizedTeamRef)) invalidInput()
    const limit = pageLimit(options.limit, 50, 50)
    const pageCursor = optionalCursor(options.pageCursor)
    const data = await this.execute(options.signal, signal => this.client.listMembers({
      team_ref: normalizedTeamRef,
      limit,
      ...(pageCursor === undefined ? {} : { page_cursor: pageCursor }),
    }, signal))
    const source = object(data, '团队成员响应无效')
    const teamValue = team(source.team)
    if (teamValue.teamRef !== normalizedTeamRef) throw invalidResponse()
    const items = array(source.items, '团队成员响应无效').map(member)
    const totalCount = nonNegativeInteger(source.total_count, '团队成员响应无效')
    const hasMore = boolean(source.has_more, '团队成员响应无效')
    const nextPageCursor = responseCursor(source.next_page_cursor, hasMore)
    if (items.length > limit || totalCount < items.length) throw invalidResponse()
    let avatarPresentations: ReadonlyMap<string, { avatarRef?: string; avatarFallback?: ArkmeGroupAvatarFallback }> = new Map()
    try {
      const avatarSignal = options.signal === undefined
        ? AbortSignal.timeout(TEAM_MEMBER_AVATAR_BUDGET_MS)
        : AbortSignal.any([options.signal, AbortSignal.timeout(TEAM_MEMBER_AVATAR_BUDGET_MS)])
      avatarPresentations = await this.avatars.publicAvatarPresentationsByArkmeIds(
        // A public Jotmo ID is only a presentation lookup key here; userRef remains the member identity.
        items.flatMap(item => item.jotmoId === undefined ? [] : [item.jotmoId]),
        avatarSignal,
      )
    } catch (error) {
      if (options.signal?.aborted === true) throw options.signal.reason ?? error
      // Avatar presentation is optional decoration; Team membership remains authoritative.
    }
    const presentedItems = items.map(item => {
      const presentation = item.jotmoId === undefined ? undefined : avatarPresentations.get(item.jotmoId)
      return presentation === undefined ? item : { ...item, ...presentation }
    })
    return { team: teamValue, items: presentedItems, totalCount, hasMore, ...(nextPageCursor === undefined ? {} : { nextPageCursor }) }
  }

  async create(items: readonly ArkmeTeamCreateItem[], signal?: AbortSignal): Promise<ArkmeTeamCreateResult[]> {
    boundedBatch(items)
    const seen = new Set<string>()
    const seenIdempotencyKeys = new Set<string>()
    const requestItems = items.map(item => {
      const itemId = item.itemId.trim()
      const name = item.name.trim()
      const jotmoId = item.jotmoId.trim()
      if (!validItemId(itemId) || seen.has(itemId) || seenIdempotencyKeys.has(item.idempotencyKey)
        || !IDEMPOTENCY_PATTERN.test(item.idempotencyKey)
        || name === '' || [...name].length > 64 || !TEAM_CREATE_JOTMO_ID_PATTERN.test(jotmoId)) invalidInput()
      seen.add(itemId)
      seenIdempotencyKeys.add(item.idempotencyKey)
      return { item_id: itemId, idempotency_key: item.idempotencyKey, name, jotmo_id: jotmoId }
    })
    const data = await this.execute(signal, active => this.client.create({ items: requestItems }, active))
    return createResults(data, requestItems.map(item => item.item_id))
  }

  async joinByJotmoID(items: readonly ArkmeTeamJoinItem[], signal?: AbortSignal): Promise<ArkmeTeamJoinResult[]> {
    boundedBatch(items)
    const seen = new Set<string>()
    const requestItems = items.map(item => {
      const itemId = item.itemId.trim()
      const jotmoId = item.jotmoId.trim()
      if (!validItemId(itemId) || seen.has(itemId) || !TEAM_LOOKUP_JOTMO_ID_PATTERN.test(jotmoId)) invalidInput()
      seen.add(itemId)
      return { item_id: itemId, jotmo_id: jotmoId }
    })
    const data = await this.execute(signal, active => this.client.joinByJotmoID({ items: requestItems }, active))
    return joinResults(data, requestItems.map(item => item.item_id))
  }

  async listDirectory(options: { limit?: number; cursor?: string; countOnly?: boolean; signal?: AbortSignal } = {}): Promise<ArkmeDirectoryPage> {
    const page = await this.list({
      ...(options.countOnly === true ? { limit: 1 } : options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.cursor === undefined ? {} : { pageCursor: options.cursor }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    return {
      section: 'teams',
      items: options.countOnly === true ? [] : page.items.map(item => ({
        kind: 'team' as const,
        teamRef: item.teamRef,
        displayName: item.name,
        publicId: item.jotmoId,
        role: item.currentUserRole,
      })),
      total: page.totalCount,
      hasMore: options.countOnly === true ? false : page.hasMore,
      ...(options.countOnly === true || page.nextPageCursor === undefined ? {} : { nextCursor: page.nextPageCursor }),
    }
  }

  private async execute<T>(callerSignal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const signal = callerSignal ?? new AbortController().signal
    try {
      return await operation(signal)
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error
      if (error instanceof ArkmePluginError) throw error
      if (error instanceof OpenApiCapabilityError) {
        const status = error.code === 'invalid-input' ? 400 : error.code === 'account-changed' ? 409 : 503
        throw new ArkmePluginError(`team-openapi-${error.code}`, error.message, error.retryable, status, { cause: error })
      }
      throw new ArkmePluginError('team-openapi-unavailable', '团队能力暂时不可用', true, 503, { cause: error })
    }
  }
}

function team(value: unknown): ArkmeTeam {
  const source = object(value, '团队响应无效')
  const teamRef = requiredString(source.team_ref, 80, '团队响应无效')
  const name = requiredString(source.name, 256, '团队响应无效')
  const jotmoId = requiredString(source.jotmo_id, 32, '团队响应无效')
  const currentUserRole = role(source.current_user_role)
  const createdAtMillis = positiveInteger(source.created_at, '团队响应无效')
  const updatedAtMillis = positiveInteger(source.updated_at, '团队响应无效')
  if (!TEAM_REF_PATTERN.test(teamRef) || [...name].length > 64 || !TEAM_LOOKUP_JOTMO_ID_PATTERN.test(jotmoId) || updatedAtMillis < createdAtMillis) throw invalidResponse()
  return { teamRef, name, jotmoId, currentUserRole, createdAtMillis, updatedAtMillis }
}

function member(value: unknown): ArkmeTeamMember {
  const source = object(value, '团队成员响应无效')
  const userRef = requiredString(source.user_ref, 80, '团队成员响应无效')
  const displayName = requiredString(source.display_name, 512, '团队成员响应无效')
  const jotmoId = source.jotmo_id === undefined ? undefined : requiredString(source.jotmo_id, 32, '团队成员响应无效')
  const identityState = source.identity_state
  if (!USER_REF_PATTERN.test(userRef) || [...displayName].length > 200
    || (jotmoId !== undefined && !USER_JOTMO_ID_PATTERN.test(jotmoId))
    || !['ready', 'incomplete', 'unavailable'].includes(String(identityState))
    || (identityState === 'ready' && jotmoId === undefined)
    || (identityState === 'unavailable' && jotmoId !== undefined)) throw invalidResponse()
  return {
    userRef, displayName,
    ...(jotmoId === undefined ? {} : { jotmoId }),
    identityState: identityState as ArkmeTeamMember['identityState'],
    role: role(source.role),
    joinedAtMillis: positiveInteger(source.joined_at, '团队成员响应无效'),
  }
}

function writeResultSources(data: unknown, itemIds: readonly string[]): Record<string, unknown>[] {
  const values = array(object(data, '团队治理响应无效').items, '团队治理响应无效')
  if (values.length !== itemIds.length) throw invalidResponse()
  return values.map((value, index) => {
    const source = object(value, '团队治理响应无效')
    const itemId = requiredString(source.item_id, 64, '团队治理响应无效')
    if (itemId !== itemIds[index] || !['succeeded', 'rejected'].includes(String(source.status))) throw invalidResponse()
    return source
  })
}

function createResults(data: unknown, itemIds: readonly string[]): ArkmeTeamCreateResult[] {
  return writeResultSources(data, itemIds).map(source => {
    const itemId = source.item_id as string
    if (source.status === 'succeeded') {
      if (source.reason !== undefined || source.membership_state !== undefined) throw invalidResponse()
      const createdTeam = team(source.team)
      if (createdTeam.currentUserRole !== 'owner') throw invalidResponse()
      return { itemId, status: 'succeeded', team: createdTeam }
    }
    if (!['jotmo_id_unavailable', 'idempotency_conflict'].includes(String(source.reason))
      || source.team !== undefined || source.membership_state !== undefined) throw invalidResponse()
    return { itemId, status: 'rejected', reason: source.reason as 'jotmo_id_unavailable' | 'idempotency_conflict' }
  })
}

function joinResults(data: unknown, itemIds: readonly string[]): ArkmeTeamJoinResult[] {
  return writeResultSources(data, itemIds).map(source => {
    const itemId = source.item_id as string
    if (source.status === 'succeeded') {
      if (source.reason !== undefined || !['joined', 'already_member', 'owner'].includes(String(source.membership_state))) {
        throw invalidResponse()
      }
      return {
        itemId,
        status: 'succeeded',
        membershipState: source.membership_state as ArkmeTeamMembershipState,
        team: joinedTeam(source.team, source.membership_state as ArkmeTeamMembershipState),
      }
    }
    if (source.reason !== 'team_not_found' || source.team !== undefined || source.membership_state !== undefined) {
      throw invalidResponse()
    }
    return { itemId, status: 'rejected', reason: 'team_not_found' }
  })
}

function joinedTeam(value: unknown, state: ArkmeTeamMembershipState): ArkmeTeam {
  const result = team(value)
  const valid = state === 'owner'
    ? result.currentUserRole === 'owner'
    : state === 'joined'
      ? result.currentUserRole === 'member'
      : result.currentUserRole === 'admin' || result.currentUserRole === 'member'
  if (!valid) throw invalidResponse()
  return result
}

function role(value: unknown): ArkmeTeamRole {
  if (value === 'owner' || value === 'admin' || value === 'member') return value
  throw invalidResponse()
}

function boundedBatch(items: readonly unknown[]): void {
  if (items.length < 1 || items.length > 10) invalidInput()
}

function validItemId(value: string): boolean {
  return ITEM_ID_PATTERN.test(value) && new TextEncoder().encode(value).length <= 64
}

function pageLimit(value: number | undefined, maximum: number, fallback: number): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) invalidInput()
  return result
}

function optionalCursor(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined
  const result = value.trim()
  if (result !== value || result.length > 8192 || !CURSOR_PATTERN.test(result)) invalidInput()
  return result
}

function responseCursor(value: unknown, hasMore: boolean): string | undefined {
  if (!hasMore) {
    if (value !== undefined) throw invalidResponse()
    return undefined
  }
  const cursor = requiredString(value, 8192, '团队分页响应无效')
  if (!CURSOR_PATTERN.test(cursor)) throw invalidResponse()
  return cursor
}

function object(value: unknown, message: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ArkmePluginError('team-openapi-invalid-response', message, true, 503)
  return value as Record<string, unknown>
}

function array(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) throw new ArkmePluginError('team-openapi-invalid-response', message, true, 503)
  return value
}

function requiredString(value: unknown, maximum: number, message: string): string {
  if (typeof value !== 'string' || value === '' || value !== value.trim() || value.length > maximum) {
    throw new ArkmePluginError('team-openapi-invalid-response', message, true, 503)
  }
  return value
}

function boolean(value: unknown, message: string): boolean {
  if (typeof value !== 'boolean') throw new ArkmePluginError('team-openapi-invalid-response', message, true, 503)
  return value
}

function nonNegativeInteger(value: unknown, message: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new ArkmePluginError('team-openapi-invalid-response', message, true, 503)
  return value as number
}

function positiveInteger(value: unknown, message: string): number {
  const result = nonNegativeInteger(value, message)
  if (result <= 0) throw new ArkmePluginError('team-openapi-invalid-response', message, true, 503)
  return result
}

function invalidInput(): never {
  throw new ArkmePluginError('team-input-invalid', '团队请求参数无效', false, 400)
}

function invalidResponse(): ArkmePluginError {
  return new ArkmePluginError('team-openapi-invalid-response', '团队能力响应无效', true, 503)
}
