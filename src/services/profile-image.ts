import sharp from 'sharp';
import { createReadStream } from 'node:fs';
import { ArkmePluginError } from './service.js';
export const PROFILE_IMAGE_SOURCE_LIMIT = 10 * 1024 * 1024;
export const PROFILE_IMAGE_OUTPUT_LIMIT = 2 * 1024 * 1024;
/** Decode/rotate/crop/re-encode once at the infrastructure boundary. */
export async function squareProfileImage(base64: string): Promise<Buffer> {
    if (!base64 || base64.length > Math.ceil(PROFILE_IMAGE_SOURCE_LIMIT / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64))
        throw new ArkmePluginError('team-avatar-invalid', '图片无效或超过 10MB', false, 400);
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length === 0 || bytes.length > PROFILE_IMAGE_SOURCE_LIMIT || bytes.toString('base64') !== base64)
        throw new ArkmePluginError('team-avatar-invalid', '图片编码无效', false, 400);
    try {
        const image = sharp(bytes, { limitInputPixels: 40000000, animated: false, failOn: 'error' });
        const meta = await image.metadata();
        if (!['png', 'jpeg', 'webp', 'heif'].includes(meta.format ?? ''))
            throw new Error('format');
        const side = Math.min(1024, meta.width ?? 0, meta.height ?? 0);
        if (side <= 0)
            throw new Error('dimensions');
        const output = await image.rotate().resize(side, side, { fit: 'cover', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
        if (output.info.width !== output.info.height || output.data.length > PROFILE_IMAGE_OUTPUT_LIMIT)
            throw new Error('size');
        return output.data;
    }
    catch (error) {
        throw new ArkmePluginError('team-avatar-invalid', '图片无法处理，请选择 PNG、JPEG 或 WebP 图片', false, 400, { cause: error });
    }
}
/** The URL comes only from an authenticated resource owner, never from upload callers. */
export function authorizedStorageURL(raw: string): URL {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) || url.hostname.startsWith('['))
        throw new ArkmePluginError('team-storage-target-invalid', '图片存储地址无效', false, 502);
    return url;
}
/** The path is an already authorized staged-file reference. Bound bytes even if the file changes. */
export async function readProfileImage(path: string, signal?: AbortSignal): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of createReadStream(path, { signal, highWaterMark: 64 * 1024 })) {
        const bytes = chunk as Buffer;
        size += bytes.length;
        if (size > PROFILE_IMAGE_SOURCE_LIMIT)
            throw new ArkmePluginError('team-avatar-too-large', '请选择小于 10MB 的图片', false, 400);
        chunks.push(bytes);
    }
    return Buffer.concat(chunks, size);
}
