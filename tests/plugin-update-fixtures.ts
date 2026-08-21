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
