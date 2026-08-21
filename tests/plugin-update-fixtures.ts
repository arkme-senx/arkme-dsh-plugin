import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { gzipSync } from 'node:zlib'

const TAR_BLOCK_BYTES = 512

function writeOctal(header: Buffer, offset: number, length: number, value: number): void {
  const octal = value.toString(8).padStart(length - 1, '0')
  header.write(octal.slice(-(length - 1)), offset, length - 1, 'ascii')
  header[offset + length - 1] = 0
}

function tarHeader(path: string, size: number, type = '0'): Buffer {
  const header = Buffer.alloc(TAR_BLOCK_BYTES)
  Buffer.from(path, 'utf8').copy(header, 0)
  writeOctal(header, 100, 8, 0o644)
  writeOctal(header, 108, 8, 0)
  writeOctal(header, 116, 8, 0)
  writeOctal(header, 124, 12, size)
  writeOctal(header, 136, 12, 0)
  header.fill(0x20, 148, 156)
  header[156] = type.charCodeAt(0)
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  writeOctal(header, 148, 8, [...header].reduce((sum, byte) => sum + byte, 0))
  return header
}

export function pluginPackageTgz(version: string, extraFiles: ReadonlyMap<string, Buffer> = new Map()): Buffer {
  const manifest = {
    name: '@senguoyun/dsh-arkme',
    version,
    type: 'module',
    main: 'lib/index.js',
    files: ['lib', 'cordis.patch.yml'],
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      client: { platform: 'web', inject: [] },
    },
  }
  const files = new Map<string, Buffer>([
    ['package/package.json', Buffer.from(`${JSON.stringify(manifest, undefined, 2)}\n`, 'utf8')],
    ['package/cordis.patch.yml', Buffer.from('- insert:\n    - id: arkme-self\n      name: "@senguoyun/dsh-arkme"\n', 'utf8')],
    ['package/lib/index.js', Buffer.from('export function apply() {}\n', 'utf8')],
    ['package/lib/client.js', Buffer.from('export default {}\n', 'utf8')],
  ])
  for (const [path, bytes] of extraFiles) files.set(path, bytes)
  const chunks: Buffer[] = []
  for (const [path, data] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    chunks.push(tarHeader(path, data.byteLength), data)
    const padding = (TAR_BLOCK_BYTES - data.byteLength % TAR_BLOCK_BYTES) % TAR_BLOCK_BYTES
    if (padding > 0) chunks.push(Buffer.alloc(padding))
  }
  chunks.push(Buffer.alloc(TAR_BLOCK_BYTES * 2))
  return gzipSync(Buffer.concat(chunks), { level: 9 })
}

export function pluginPackageTgzWithEntryType(path: string, type: string): Buffer {
  const chunks = [
    tarHeader(path, 0, type),
    Buffer.alloc(TAR_BLOCK_BYTES * 2),
  ]
  return gzipSync(Buffer.concat(chunks), { level: 9 })
}

export function sha512Hex(bytes: Uint8Array): string {
  return createHash('sha512').update(bytes).digest('hex')
}

export function pluginUpdateSigningMessage(input: {
  version: string
  artifactSize: number
  sha512: string
  appVersionRange: string
  dshVersionRange: string
}): Buffer {
  return Buffer.from(JSON.stringify({
    domain: 'arkme-plugin-manifest-v1',
    packageName: '@senguoyun/dsh-arkme',
    version: input.version,
    artifactSize: input.artifactSize,
    sha512: input.sha512.toLowerCase(),
    appVersionRange: input.appVersionRange,
    dshVersionRange: input.dshVersionRange,
  }), 'utf8')
}

export function signedPluginUpdateManifest(input: {
  version: string
  artifactUrl: string
  artifactBytes: Buffer
  appVersionRange?: string
  dshVersionRange?: string
}) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const appVersionRange = input.appVersionRange ?? '>=1.0.0'
  const dshVersionRange = input.dshVersionRange ?? '>=0.1.0-rc.8'
  const sha512 = sha512Hex(input.artifactBytes)
  const payload = {
    schemaVersion: 1,
    packageName: '@senguoyun/dsh-arkme',
    version: input.version,
    artifactUrl: input.artifactUrl,
    artifactSize: input.artifactBytes.byteLength,
    sha512,
    manifestSignature: sign(null, pluginUpdateSigningMessage({
      version: input.version,
      artifactSize: input.artifactBytes.byteLength,
      sha512,
      appVersionRange,
      dshVersionRange,
    }), privateKey).toString('base64'),
    appVersionRange,
    dshVersionRange,
    notice: {
      level: 'important',
      title: '插件更新',
      summary: '自有服务器分发的插件更新',
      releaseNotesUrl: 'https://arkme.ai/releases/plugin',
    },
  }
  return {
    payload,
    publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  }
}
