import { beforeEach, afterEach, vi } from 'vitest'
import { SocialAccessService } from '../../src/services/social-access-service.js'

/** Existing domain scenarios use an account eligible for social business. */
export function qualifiedSocialAccountFixture(): void {
  beforeEach(() => { vi.spyOn(SocialAccessService.prototype, 'status').mockResolvedValue({ userId: 42, allowed: true }) })
  afterEach(() => { vi.restoreAllMocks() })
}
