import { ArkmePluginError, ServiceRuntime } from './service.js'

export interface ArkmeBackgroundSoundMembership {
  userId: number
  memberType: number
  eligible: boolean
}

export interface ArkmeBackgroundSoundMembershipOptions {
  signal?: AbortSignal
  expectedUserId?: number
}

function memberTypeFromResponse(raw: Record<string, unknown>): number {
  const value = raw.member_type
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ArkmePluginError(
      'background-sound-membership-contract-invalid',
      '会员资格响应无效',
      true,
      502,
    )
  }
  return value
}

/** Current-account membership owner. Unknown and failed reads are never projected as a free account. */
export class BackgroundSoundMembershipService {
  constructor(private readonly runtime: ServiceRuntime) {}

  async current(
    options: ArkmeBackgroundSoundMembershipOptions = {},
  ): Promise<ArkmeBackgroundSoundMembership> {
    const expectedUserId = options.expectedUserId
    if (expectedUserId !== undefined
      && (!Number.isSafeInteger(expectedUserId) || expectedUserId <= 0)) {
      throw new ArkmePluginError(
        'background-sound-membership-expected-user-invalid',
        '背景音会员资格的预期账号无效',
        false,
        400,
      )
    }

    const session = await this.runtime.requireSession()
    if (expectedUserId !== undefined && session.userId !== expectedUserId) {
      throw new ArkmePluginError(
        'background-sound-membership-account-changed',
        '账号已切换，本次会员资格查询未执行',
        false,
        409,
      )
    }

    const raw = await this.runtime.authenticatedAuthReadPost<Record<string, unknown>>(
      '/api/v1/premium/get/member',
      {},
      session,
      options.signal,
    )

    const currentSession = await this.runtime.requireSession()
    if (currentSession.userId !== session.userId
      || (expectedUserId !== undefined && currentSession.userId !== expectedUserId)) {
      throw new ArkmePluginError(
        'background-sound-membership-account-changed',
        '账号已切换，本次会员资格查询结果已丢弃',
        false,
        409,
      )
    }

    const memberType = memberTypeFromResponse(raw)
    return {
      userId: session.userId,
      memberType,
      eligible: memberType > 0,
    }
  }
}
