import { randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'

export interface MultipartUploadBody {
  body: Readable
  contentType: string
  contentLength: number
}

function dispositionName(value: string): string {
  if (!/^[A-Za-z0-9_.-]+$/u.test(value)) throw new TypeError('invalid multipart field name')
  return value
}

export function createMultipartUploadBody(
  fields: Readonly<Record<string, string>>,
  fileField: string,
  mediaType: string,
  data: Uint8Array,
): MultipartUploadBody {
  const boundary = `----arkme-${randomBytes(18).toString('hex')}`
  const chunks: Uint8Array[] = []
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${dispositionName(name)}"\r\n\r\n${value}\r\n`,
      'utf8',
    ))
  }
  chunks.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${dispositionName(fileField)}"; filename="asset"\r\nContent-Type: ${mediaType}\r\n\r\n`,
    'utf8',
  ))
  chunks.push(data)
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'))
  const contentLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  if (!Number.isSafeInteger(contentLength) || contentLength <= data.byteLength) {
    throw new TypeError('invalid multipart content length')
  }
  return {
    body: Readable.from(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
    contentLength,
  }
}
