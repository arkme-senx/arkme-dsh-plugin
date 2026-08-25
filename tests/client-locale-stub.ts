import { vi } from 'vitest'
import { defaultArkmeLoginTranslate } from '../src/client/arkme-login-locales.js'

export function createClientLocaleStub() {
  return {
    register: vi.fn(() => () => undefined),
    bind: vi.fn(() => defaultArkmeLoginTranslate),
  }
}
