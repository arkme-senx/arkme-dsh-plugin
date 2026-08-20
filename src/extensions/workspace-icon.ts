import type { Agent } from '@deepseek-ai/dsh-agent'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path'
import sharp from 'sharp'
import type { ArkmeImageBytes } from '../types.js'

const MAX_ICON_BYTES = 2 * 1024 * 1024
const MAX_ICON_PIXELS = 16 * 1024 * 1024
const MAX_ICON_EDGE = 1024
const MAX_PREVIEW_BYTES = 5 * 1024 * 1024
const MAX_PREVIEW_PIXELS = 40 * 1024 * 1024
const MAX_PREVIEW_EDGE = 4096

type SupportedIconMediaType = 'image/png' | 'image/jpeg' | 'image/webp'

interface WorkspaceImagePolicy {
  maxBytes: number
  maxPixels: number
  maxEdge: number
  minEdge: number
  outputLabel: string
  sizeLabel: string
}

const ICON_POLICY: WorkspaceImagePolicy = {
  maxBytes: MAX_ICON_BYTES,
  maxPixels: MAX_ICON_PIXELS,
  maxEdge: MAX_ICON_EDGE,
  minEdge: 1,
  outputLabel: 'icon',
  sizeLabel: '2 MiB',
}

const PREVIEW_POLICY: WorkspaceImagePolicy = {
  maxBytes: MAX_PREVIEW_BYTES,
  maxPixels: MAX_PREVIEW_PIXELS,
  maxEdge: MAX_PREVIEW_EDGE,
  minEdge: 320,
  outputLabel: 'preview image',
  sizeLabel: '5 MiB',
}

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

async function normalizeImage(
  data: Uint8Array,
  inputType: ReturnType<typeof sniffMediaType>,
  policy: WorkspaceImagePolicy,
  signal?: AbortSignal,
): Promise<ArkmeImageBytes> {
  signal?.throwIfAborted()
  if (inputType === 'image/svg+xml') assertSafeSvg(data)
  const pipeline = sharp(data, {
    failOn: 'warning',
    limitInputPixels: policy.maxPixels,
    sequentialRead: true,
    ...(inputType === 'image/svg+xml' ? { density: 144 } : {}),
  }).rotate().resize({
    width: policy.maxEdge,
    height: policy.maxEdge,
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
  if (output.byteLength <= 0 || output.byteLength > policy.maxBytes) {
    throw invalidWorkspaceImage(`the normalized ${policy.outputLabel} must be smaller than ${policy.sizeLabel}`)
  }
  const metadata = await sharp(output, { failOn: 'warning', limitInputPixels: policy.maxPixels }).metadata()
  if (metadata.width === undefined || metadata.height === undefined
    || metadata.width < policy.minEdge || metadata.height < policy.minEdge
    || metadata.width > policy.maxEdge || metadata.height > policy.maxEdge) {
    throw invalidWorkspaceImage(
      `the normalized ${policy.outputLabel} must be ${String(policy.minEdge)}-${String(policy.maxEdge)} pixels on both axes`,
    )
  }
  return { mediaType, bytes: output.byteLength, data: new Uint8Array(output) }
}

async function readWorkspaceExtensionImage(
  agent: Agent,
  workspacePathValue: string,
  policy: WorkspaceImagePolicy,
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
  if (info.size <= 0 || info.size > policy.maxBytes) {
    throw invalidWorkspaceImage(`the source image must be smaller than ${policy.sizeLabel}`)
  }
  const data = new Uint8Array(await readFile(candidate))
  signal?.throwIfAborted()
  if (data.byteLength !== info.size || data.byteLength > policy.maxBytes) {
    throw invalidWorkspaceImage('the source image changed while it was being read')
  }
  return await normalizeImage(data, sniffMediaType(data), policy, signal)
}

/** Read one Agent-workspace icon without allowing paths or symlinks to escape the session workspace. */
export async function readWorkspaceExtensionIcon(
  agent: Agent,
  workspacePathValue: string,
  signal?: AbortSignal,
): Promise<ArkmeImageBytes> {
  return await readWorkspaceExtensionImage(agent, workspacePathValue, ICON_POLICY, signal)
}

/** Read one Agent-generated preview without exposing arbitrary host paths to the model. */
export async function readWorkspaceExtensionPreview(
  agent: Agent,
  workspacePathValue: string,
  signal?: AbortSignal,
): Promise<ArkmeImageBytes> {
  return await readWorkspaceExtensionImage(agent, workspacePathValue, PREVIEW_POLICY, signal)
}

/** Validate an already-authorized raster against the same preview contract before any remote write. */
export async function validateExtensionPreviewImage(
  image: ArkmeImageBytes,
  signal?: AbortSignal,
): Promise<ArkmeImageBytes> {
  signal?.throwIfAborted()
  if (image.bytes !== image.data.byteLength || image.bytes <= 0 || image.bytes > MAX_PREVIEW_BYTES
    || !['image/png', 'image/jpeg', 'image/webp'].includes(image.mediaType)
    || sniffMediaType(image.data) !== image.mediaType) {
    throw invalidWorkspaceImage('the preview must be a matching PNG, JPEG, or WebP smaller than 5 MiB')
  }
  const metadata = await sharp(image.data, { failOn: 'warning', limitInputPixels: MAX_PREVIEW_PIXELS }).metadata()
  signal?.throwIfAborted()
  if (metadata.width === undefined || metadata.height === undefined
    || metadata.width < 320 || metadata.height < 320
    || metadata.width > MAX_PREVIEW_EDGE || metadata.height > MAX_PREVIEW_EDGE) {
    throw invalidWorkspaceImage('the preview must be 320-4096 pixels on both axes')
  }
  return image
}
