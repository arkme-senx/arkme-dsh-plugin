import { afterEach, describe, expect, it, vi } from 'vitest'
import { avatarReferenceDiagnostic, avatarScopeDiagnostic, logArkmeAvatarDiagnostic } from '../src/avatar-diagnostics.js'
import { arkmeAvatarImages } from '../src/client/avatar-image-runtime.js'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme }))

function profileRef(payload: unknown): string {
  return `arkme-profile-image-v1.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.SECRET_SIGNATURE`
}

afterEach(() => {
  arkmeAvatarImages.activateScope(undefined)
  vi.restoreAllMocks()
})

describe('avatar diagnostics', () => {
  it('extracts only numeric identity hints from opaque references and a valid scope', () => {
    expect(avatarReferenceDiagnostic(profileRef({ version: 1, viewerUserId: 42, targetUserId: 88, secret: 'NEVER_LOG' })))
      .toEqual({ referenceKind: 'profile', referenceViewerUserId: 42, referenceTargetUserId: 88 })
    expect(avatarScopeDiagnostic('prod:42')).toEqual({ environment: 'prod', viewerUserId: 42 })
    expect(avatarScopeDiagnostic('prod:9007199254740992')).toEqual({})
    expect(avatarScopeDiagnostic('prod:42:NEVER_LOG')).toEqual({})
  })

  it('tolerates malformed references and does not emit arbitrary payload values', () => {
    expect(avatarReferenceDiagnostic('arkme-profile-image-v1.invalid.signature')).toEqual({ referenceKind: 'profile' })
    expect(avatarReferenceDiagnostic(profileRef({ version: 1, viewerUserId: 'NEVER_LOG', targetUserId: -1 })))
      .toEqual({ referenceKind: 'profile' })
    expect(avatarReferenceDiagnostic(profileRef({ version: 2, viewerUserId: 42, targetUserId: 88 })))
      .toEqual({ referenceKind: 'profile' })
    expect(avatarReferenceDiagnostic('https://example.test/private?token=NEVER_LOG')).toEqual({ referenceKind: 'other' })
  })

  it('writes one JSON string with safe error codes and status, without messages, URLs, tokens or stacks', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logArkmeAvatarDiagnostic('image_read_failed', { viewerUserId: 42, targetUserId: 88 }, {
      name: 'ArkmePluginError', code: 'image-http-403', httpStatus: 502, upstreamStatus: 403, retryable: true,
      message: 'https://example.test/avatar?x-oss-signature=SECRET Bearer ACCESS_TOKEN',
      stack: 'SECRET_STACK', accessToken: 'ACCESS_TOKEN', cause: { code: 'ECONNRESET', message: 'SECRET_CAUSE' },
    })
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]).toHaveLength(1)
    const line = String(warn.mock.calls[0]![0])
    expect(line).not.toMatch(/SECRET|ACCESS_TOKEN|https:|Bearer|\[object Object\]/)
    expect(JSON.parse(line.slice('[ArkmeAvatarDiag] '.length))).toMatchObject({
      event: 'image_read_failed', viewerUserId: 42, targetUserId: 88,
      error: { name: 'ArkmePluginError', code: 'image-http-403', httpStatus: 502, upstreamStatus: 403, retryable: true, causeCode: 'ECONNRESET' },
    })
  })

  it('connects the real Browser runtime failure sink to the diagnostic writer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ref = profileRef({ version: 1, viewerUserId: 42, targetUserId: 88 })
    const error = Object.assign(new Error('SECRET_MESSAGE'), {
      name: 'ArkmeClientError', body: { code: 'arkme-timeout', retryable: true, message: 'SECRET_BODY' },
    })
    mocks.callArkme.mockRejectedValueOnce(error)
    arkmeAvatarImages.activateScope('prod:42')
    await expect(arkmeAvatarImages.load(ref)).rejects.toBe(error)
    expect(warn).toHaveBeenCalledOnce()
    const line = String(warn.mock.calls[0]![0])
    expect(JSON.parse(line.slice('[ArkmeAvatarDiag] '.length))).toMatchObject({
      event: 'image_load_failed', environment: 'prod', viewerUserId: 42,
      referenceKind: 'profile', referenceTargetUserId: 88, trigger: 'load', hasCachedImage: false,
      error: { name: 'ArkmeClientError', code: 'arkme-timeout', retryable: true },
    })
    expect(line).not.toMatch(/SECRET|arkme-profile-image-v1/)
  })

  it('does not throw if the diagnostic sink throws', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => { throw new Error('sink failed') })
    expect(() => logArkmeAvatarDiagnostic('profile_missing', { targetUserIds: [88] })).not.toThrow()
  })

  it('drops unsafe error fields and extracts only the fixed downloader HTTP status', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logArkmeAvatarDiagnostic('image_read_failed', {}, {
      name: 'ArkmePluginError', code: 'image-download-failed', message: 'Arkme 图片读取返回 HTTP 403', httpStatus: 502,
    })
    expect(JSON.parse(String(warn.mock.calls[0]![0]).slice('[ArkmeAvatarDiag] '.length)).error)
      .toMatchObject({ code: 'image-download-failed', httpStatus: 502, upstreamStatus: 403 })
    logArkmeAvatarDiagnostic('image_load_failed', {}, {
      name: 'SECRET_NAME', code: 'https://example.test/SECRET', message: 'SECRET_MESSAGE', httpStatus: 999,
      cause: { code: 'SECRET_TOKEN' },
    })
    expect(JSON.parse(String(warn.mock.calls[1]![0]).slice('[ArkmeAvatarDiag] '.length)).error).toEqual({ name: 'unknown' })
  })
})
