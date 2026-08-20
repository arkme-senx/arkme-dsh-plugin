import type { Agent } from '@deepseek-ai/dsh-agent'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path'
import sharp from 'sharp'
import type { ArkmeImageBytes } from '../types.js'

const MAX_ICON_BYTES = 2 * 1024 * 1024
const MAX_ICON_PIXELS = 16 * 1024 * 1024
const MAX_ICON_EDGE = 1024

type SupportedIconMediaType = 'image/png' | 'image/jpeg' | 'image/webp'

function invalidWorkspaceImage(message: string): Error {
  return new Error(`cannot use the workspace image: ${message}`)
}

function workspaceRoot(agent: Agent): string {
  const cwd = agent.session.header.cwd
  if (typeof cwd !== 'string' || cwd.trim() === '' || !isAbsolute(cwd)) {
    throw invalidWorkspaceImage('the current Agent session has no absolute workspace')
  }
  return cwd
}

function assertRelativeWorkspacePath(value: string): string {
  if (value === '' || value !== value.trim() || /[\u0000-\u001F\u007F]/.test(value)) {
    throw invalidWorkspaceImage('workspace_path must be a non-empty relative file path')
  }
  if (isAbsolute(value) || win32.isAbsolute(value)) {
    throw invalidWorkspaceImage('absolute paths are not allowed')
  }
  const segments = value.split(/[\\/]+/)
  if (segments.some(segment => segment === '..')) {
    throw invalidWorkspaceImage('path traversal is not allowed')
  }
  return value
}

function pathIsInside(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

function sniffMediaType(data: Uint8Array): SupportedIconMediaType | 'image/svg+xml' {
  if (data.byteLength >= 8 && Buffer.from(data.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'image/png'
  }
  if (data.byteLength >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.byteLength >= 12
    && Buffer.from(data.subarray(0, 4)).toString('ascii') === 'RIFF'
    && Buffer.from(data.subarray(8, 12)).toString('ascii') === 'WEBP') return 'image/webp'
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    throw invalidWorkspaceImage('only PNG, JPEG, WebP, or safe SVG files are accepted')
  }
  const withoutDeclaration = text.replace(/^\uFEFF?\s*<\?xml\s[^?]*\?>\s*/i, '')
  if (/^<svg(?:\s|>)/i.test(withoutDeclaration)) return 'image/svg+xml'
  throw invalidWorkspaceImage('only PNG, JPEG, WebP, or safe SVG files are accepted')
}

function assertSafeSvg(data: Uint8Array): void {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(data)
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(source)) throw invalidWorkspaceImage('SVG document types and entities are not allowed')
  if (/<\s*(?:[\w.-]+:)?(?:script|style|foreignObject|image|use|a|iframe|object|embed|audio|video)\b/i.test(source)) {
    throw invalidWorkspaceImage('SVG executable, embedded, linked, or external-resource elements are not allowed')
  }
  if (/<\?(?!xml\s)/i.test(source) || /\s(?:on[a-z][\w:.-]*|style|(?:xlink:)?href|xml:base)\s*=/i.test(source)) {
    throw invalidWorkspaceImage('SVG links, styles, event handlers, and processing instructions are not allowed')
  }
  for (const match of source.matchAll(/url\s*\(\s*([^)]*)\)/gi)) {
    const target = (match[1] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim()
    if (!/^#[A-Za-z_][\w:.-]*$/.test(target)) throw invalidWorkspaceImage('SVG may reference only local fragment resources')
  }
}

async function normalizeIcon(
  data: Uint8Array,
  inputType: ReturnType<typeof sniffMediaType>,
  signal?: AbortSignal,
): Promise<ArkmeImageBytes> {
  signal?.throwIfAborted()
  if (inputType === 'image/svg+xml') assertSafeSvg(data)
  const pipeline = sharp(data, {
    failOn: 'warning',
    limitInputPixels: MAX_ICON_PIXELS,
    sequentialRead: true,
    ...(inputType === 'image/svg+xml' ? { density: 144 } : {}),
  }).rotate().resize({
    width: MAX_ICON_EDGE,
    height: MAX_ICON_EDGE,
    fit: 'inside',
    withoutEnlargement: true,
  }).timeout({ seconds: 10 })
  let output: Buffer
  let mediaType: SupportedIconMediaType
  if (inputType === 'image/svg+xml' || inputType === 'image/png') {
    output = await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
    mediaType = 'image/png'
  } else if (inputType === 'image/jpeg') {
    output = await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer()
    mediaType = 'image/jpeg'
  } else {
    output = await pipeline.webp({ quality: 90 }).toBuffer()
    mediaType = 'image/webp'
  }
  signal?.throwIfAborted()
  if (output.byteLength <= 0 || output.byteLength > MAX_ICON_BYTES) {
    throw invalidWorkspaceImage('the normalized icon must be smaller than 2 MiB')
  }
  return { mediaType, bytes: output.byteLength, data: new Uint8Array(output) }
}

/** Read one Agent-workspace image without allowing paths or symlinks to escape the session workspace. */
export async function readWorkspaceExtensionIcon(
  agent: Agent,
  workspacePathValue: string,
  signal?: AbortSignal,
): Promise<ArkmeImageBytes> {
  signal?.throwIfAborted()
  const workspacePath = assertRelativeWorkspacePath(workspacePathValue)
  const root = await realpath(workspaceRoot(agent))
  signal?.throwIfAborted()
  const candidate = await realpath(resolve(root, workspacePath))
  if (!pathIsInside(root, candidate)) throw invalidWorkspaceImage('the resolved file is outside the current Agent workspace')
  const info = await stat(candidate)
  if (!info.isFile()) throw invalidWorkspaceImage('workspace_path must identify a regular file')
  if (info.size <= 0 || info.size > MAX_ICON_BYTES) throw invalidWorkspaceImage('the source image must be smaller than 2 MiB')
  const data = new Uint8Array(await readFile(candidate))
  signal?.throwIfAborted()
  if (data.byteLength !== info.size || data.byteLength > MAX_ICON_BYTES) {
    throw invalidWorkspaceImage('the source image changed while it was being read')
  }
  return await normalizeIcon(data, sniffMediaType(data), signal)
}
