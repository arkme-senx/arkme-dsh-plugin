import type { ArkmeBackgroundSoundPreference, ArkmeBackgroundSoundEligibilityReason } from '../types.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import { BackgroundSoundMembershipService } from './background-sound-membership-service.js'
import { ArkmePluginError, ServiceRuntime } from './service.js'

function optionalInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return undefined
  return value
}

function preferenceFromOwnerResponse(
  raw: Record<string, unknown>,
  expectedUserId: number,
  eligibility: BackgroundSoundEligibility,
): ArkmeBackgroundSoundPreference {
  const userId = optionalInteger(raw.user_id)
  if (userId === undefined) {
    throw new ArkmePluginError(
      'background-sound-owner-contract-invalid',
      '背景音设置响应缺少账号归属',
      true,
      502,
    )
  }
  if (userId !== expectedUserId) {
    throw new ArkmePluginError(
      'background-sound-owner-mismatch',
      '背景音设置不属于当前账号，请刷新后重试',
      false,
      409,
    )
  }
  if (typeof raw.enabled !== 'boolean') {
    throw new ArkmePluginError(
      'background-sound-owner-contract-invalid',
      '背景音设置响应无效',
      true,
      502,
    )
  }
  const sourceVersion = optionalInteger(raw.source_version)
  const updatedAtMillis = optionalInteger(raw.update_at)
  return {
    userId,
    found: raw.found === undefined ? true : raw.found === true,
    enabled: eligibility.eligible && raw.enabled,
    eligible: eligibility.eligible,
    ...(eligibility.memberType === undefined ? {} : { memberType: eligibility.memberType }),
    eligibilityReason: eligibility.reason,
    ...(sourceVersion === undefined ? {} : { sourceVersion }),
    ...(updatedAtMillis === undefined ? {} : { updatedAtMillis }),
  }
}

interface BackgroundSoundEligibility {
  eligible: boolean
  memberType?: number
  reason: ArkmeBackgroundSoundEligibilityReason
}

const MEMBERSHIP_UNAVAILABLE: BackgroundSoundEligibility = {
  eligible: false,
  reason: 'membership-unavailable',
}

/** Account-scoped server owner. Client caches remain reversible projections, never the source of truth. */
export class BackgroundSoundPreferenceService {
  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly membership = new BackgroundSoundMembershipService(runtime),
  ) {}

  async preference(signal?: AbortSignal): Promise<ArkmeBackgroundSoundPreference> {
    const session = await this.runtime.requireSession()
    const [raw, eligibility] = await Promise.all([
      this.runtime.authenticatedPost<Record<string, unknown>>(
        '/api/v1/settings/background-voice/query', {}, session, signal,
      ),
      this.eligibility(session, signal),
    ])
    return preferenceFromOwnerResponse(raw, session.userId, eligibility)
  }

  async update(
    enabled: boolean,
    signal?: AbortSignal,
    expectedUserId?: number,
  ): Promise<ArkmeBackgroundSoundPreference> {
    if (typeof enabled !== 'boolean') {
      throw new ArkmePluginError('background-sound-preference-invalid', '背景音开关必须是布尔值', false, 400)
    }
    const session = await this.runtime.requireSession()
    if (expectedUserId !== undefined
      && (!Number.isSafeInteger(expectedUserId) || expectedUserId <= 0)) {
      throw new ArkmePluginError('background-sound-expected-user-invalid', '背景音设置的预期账号无效', false, 400)
    }
    if (expectedUserId !== undefined && expectedUserId !== session.userId) {
      throw new ArkmePluginError('background-sound-account-changed', '账号已切换，本次背景音设置未保存', false, 409)
    }
    let eligibility: BackgroundSoundEligibility | undefined
    if (enabled) {
      eligibility = await this.eligibility(session, signal)
      if (eligibility.reason === 'membership-unavailable') {
        throw new ArkmePluginError(
          'background-sound-membership-unavailable',
          '暂时无法确认背景音会员权益，本次未开启',
          true,
          503,
        )
      }
      if (!eligibility.eligible) {
        throw new ArkmePluginError(
          'background-sound-membership-required',
          '免费版暂不支持背景音',
          false,
          403,
        )
      }
    }
    const raw = await this.runtime.authenticatedPost<Record<string, unknown>>(
      '/api/v1/settings/background-voice/update',
      { enabled },
      session,
      signal,
    )
    eligibility ??= await this.eligibility(session, signal)
    await this.assertAccount(session.userId)
    return preferenceFromOwnerResponse(raw, session.userId, eligibility)
  }

  private async eligibility(
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<BackgroundSoundEligibility> {
    try {
      const membership = await this.membership.current({
        ...(signal === undefined ? {} : { signal }),
        expectedUserId: session.userId,
      })
      return membership.eligible
        ? { eligible: true, memberType: membership.memberType, reason: 'eligible' }
        : { eligible: false, memberType: membership.memberType, reason: 'membership-required' }
    } catch (error) {
      if (signal?.aborted === true) throw error
      if (error instanceof ArkmePluginError && error.code === 'background-sound-membership-account-changed') {
        throw new ArkmePluginError('background-sound-account-changed', '账号已切换，本次背景音设置结果已丢弃', false, 409)
      }
      await this.assertAccount(session.userId)
      return MEMBERSHIP_UNAVAILABLE
    }
  }

  private async assertAccount(expectedUserId: number): Promise<void> {
    if ((await this.runtime.requireSession()).userId !== expectedUserId) {
      throw new ArkmePluginError('background-sound-account-changed', '账号已切换，本次背景音设置结果已丢弃', false, 409)
    }
  }
}
