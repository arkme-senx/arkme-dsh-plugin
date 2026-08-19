import { createPublicKey, verify } from 'node:crypto'
import { ArkmePluginError } from '../arkme-service.js'
import { canonicalExtensionSignatureMessage } from './artifact.js'
import { ARKME_EXTENSION_FORMAT_VERSION } from './types.js'

function publicKey(value: string) {
  if (value.includes('BEGIN PUBLIC KEY')) return createPublicKey(value)
  const decoded = Buffer.from(value, 'base64')
  if (decoded.byteLength === 32) {
    return createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: decoded.toString('base64url') },
      format: 'jwk',
    })
  }
  return createPublicKey({ key: decoded, format: 'der', type: 'spki' })
}

export function verifyExtensionResolutionSignature(
  resolution: {
    extension_id: string
    version: string
    artifact_sha256: string
    manifest_sha256: string
    published_at: number
    signing_key_id: string
    signature: string
  },
  trustedKeys: ReadonlyMap<string, string>,
): void {
  if (!/^[a-f0-9]{64}$/.test(resolution.artifact_sha256)
    || !/^[a-f0-9]{64}$/.test(resolution.manifest_sha256)
    || !Number.isSafeInteger(resolution.published_at) || resolution.published_at <= 0
    || resolution.signature.trim() === '') {
    throw new ArkmePluginError('extension-signature-envelope-invalid', '扩展签名 envelope 字段无效', false, 502)
  }
  const key = trustedKeys.get(resolution.signing_key_id)
  if (key === undefined) {
    throw new ArkmePluginError('extension-signing-key-untrusted', `不信任扩展签名密钥 ${resolution.signing_key_id}`, false, 403)
  }
  let valid = false
  try {
    valid = verify(
      null,
      canonicalExtensionSignatureMessage({ format_version: ARKME_EXTENSION_FORMAT_VERSION, ...resolution }),
      publicKey(key),
      Buffer.from(resolution.signature, 'base64'),
    )
  } catch (error) {
    throw new ArkmePluginError('extension-signature-invalid', '扩展签名格式无效', false, 403, { cause: error })
  }
  if (!valid) throw new ArkmePluginError('extension-signature-invalid', '扩展平台签名验证失败', false, 403)
}
