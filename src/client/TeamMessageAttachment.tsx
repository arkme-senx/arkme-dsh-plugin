import { useState } from 'react'
import type { TeamMedia } from '../team-app-contract.js'
import { callArkme } from './api.js'

export function TeamMessageAttachment({ media, signal, onError }: { media: TeamMedia; signal: AbortSignal; onError(message: string): void }) {
  const [url, setUrl] = useState(''), [loading, setLoading] = useState(false)
  const kind = /^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|ogg|wav|x-wav|flac))$/.test(media.mimeType) ? media.mimeType.split('/')[0] : ''
  const open = async () => {
    setLoading(true)
    try {
      const result = await callArkme<{ url: string }>('team.app.media', { mediaRef: media.ref }, signal)
      if (signal.aborted) return
      if (kind) setUrl(result.url)
      else { const anchor = document.createElement('a'); anchor.href = result.url; anchor.download = media.name; anchor.click() }
    } catch (error) { if (!signal.aborted) onError(error instanceof Error ? error.message : '附件暂不可用') }
    finally { if (!signal.aborted) setLoading(false) }
  }
  return <div className="team-attachment">
    {url && (kind === 'image' ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={media.name} onError={() => { setUrl(''); onError('图片不可用，请刷新消息后重试') }} /></a>
      : kind === 'video' ? <video src={url} controls preload="metadata" onError={() => { setUrl(''); onError('视频不可用，请刷新消息后重试') }} />
        : <audio src={url} controls preload="metadata" onError={() => { setUrl(''); onError('音频不可用，请刷新消息后重试') }} />)}
    <button disabled={loading} onClick={() => { void open() }}>{loading ? '正在读取…' : kind ? '预览' : '下载'} {media.name} · {Math.ceil(media.size / 1024)} KB</button>
    {url && <a href={url} download={media.name}>保存附件</a>}
  </div>
}
