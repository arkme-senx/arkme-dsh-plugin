import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { securePrivateDirectory, securePrivateFile } from './private-filesystem.js'
import { ArkmePluginError } from './services/service.js'
import type { ArkmeImageBytes, ArkmeImageMediaType } from './types.js'

export const MAX_SELF_ROLE_AVATAR_BYTES = 8 * 1024 * 1024
const PREFIX = 'arkme-self-role-image-v1.'
const REF_PATTERN = /^arkme-self-role-image-v1\.([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i

function assertUserId(userId: number): void {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new ArkmePluginError('self-role-account-invalid', '角色所属账号无效', false, 400)
  }
}

function imageType(data: Uint8Array): ArkmeImageMediaType | undefined {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
    && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) return 'image/png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 12 && Buffer.from(data.subarray(0, 4)).toString('ascii') === 'RIFF'
    && Buffer.from(data.subarray(8, 12)).toString('ascii') === 'WEBP') return 'image/webp'
  if (data.length >= 6 && ['GIF87a', 'GIF89a'].includes(Buffer.from(data.subarray(0, 6)).toString('ascii'))) return 'image/gif'
  return undefined
}

export class SelfRoleAvatarStore {
  constructor(private readonly rootDirectory: string) {}

  private accountDirectory(userId: number): string {
    assertUserId(userId)
    return join(this.rootDirectory, String(userId))
  }

  private avatarPath(userId: number, ref: string): string {
    const match = REF_PATTERN.exec(ref)
    if (match === null) throw new ArkmePluginError('self-role-avatar-invalid', '角色头像引用无效', false, 400)
    return join(this.accountDirectory(userId), `${match[1]!.toLowerCase()}.img`)
  }

  async save(userId: number, data: Uint8Array, mediaType: ArkmeImageMediaType): Promise<string> {
    const detected = imageType(data)
    if (!detected || detected !== mediaType || data.byteLength === 0 || data.byteLength > MAX_SELF_ROLE_AVATAR_BYTES) {
      throw new ArkmePluginError('self-role-avatar-invalid', '头像须为 8 MB 内的有效图片', false, 400)
    }
    const directory = this.accountDirectory(userId)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    if (!(await lstat(this.rootDirectory)).isDirectory() || !(await lstat(directory)).isDirectory()) {
      throw new ArkmePluginError('self-role-avatar-store-invalid', '角色头像目录不可用', false, 500)
    }
    await securePrivateDirectory(this.rootDirectory)
    await securePrivateDirectory(directory)
    const ref = `${PREFIX}${randomUUID()}`
    const path = this.avatarPath(userId, ref)
    const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
    try {
      await handle.writeFile(data)
      await handle.sync()
    } catch (error) {
      await handle.close()
      await unlink(path).catch(() => undefined)
      throw error
    }
    await handle.close()
    await securePrivateFile(path)
    return ref
  }

  async exists(userId: number, ref: string): Promise<boolean> {
    let path: string
    try { path = this.avatarPath(userId, ref) } catch { return false }
    try {
      const item = await lstat(path)
      return item.isFile() && item.size > 0 && item.size <= MAX_SELF_ROLE_AVATAR_BYTES
    } catch { return false }
  }

  uploadPath(userId: number, ref: string): string { return this.avatarPath(userId, ref) }

  async read(userId: number, ref: string, maxBytes = MAX_SELF_ROLE_AVATAR_BYTES): Promise<ArkmeImageBytes> {
    const path = this.avatarPath(userId, ref)
    const limit = Math.min(MAX_SELF_ROLE_AVATAR_BYTES, Math.max(1, Math.trunc(maxBytes)))
    let handle
    try {
      handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      const info = await handle.stat()
      if (!info.isFile() || info.size <= 0 || info.size > limit) {
        throw new ArkmePluginError('image-size-unsupported', '头像图片过大或无效', false, 413)
      }
      const data = await handle.readFile()
      const mediaType = imageType(data)
      if (!mediaType || data.length !== info.size) {
        throw new ArkmePluginError('self-role-avatar-invalid', '角色头像文件已损坏', false, 415)
      }
      return { mediaType, bytes: data.length, data }
    } catch (error) {
      if (error instanceof ArkmePluginError) throw error
      throw new ArkmePluginError('self-role-avatar-missing', '角色头像在此设备不可用', false, 404, { cause: error })
    } finally {
      await handle?.close()
    }
  }
}
