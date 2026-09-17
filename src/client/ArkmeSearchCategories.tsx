import { tr, useArkmeLocale } from './locale.js'
import { useEffect, useState, type CSSProperties } from 'react'
import copyIcon from '../../assets/search_file_icons/copy.png'
import { arkmeTheme } from './arkme-theme.js'
import { arkmeFileIconKind } from './ArkmeFileIcon.js'
import { textLinkRuns } from './text-link-parser.js'
import { arkmeLinkMetadataResolver, arkmeShouldResolveLinkMetadata } from './link-metadata-client.js'
import type { ArkmeLinkMetadata } from '../link-metadata.js'
import type { ArkmeSearchAssetItem, ArkmeSearchRecordItem } from '../types.js'
import pdf from '../../assets/search_file_icons/file_icon_pdf.svg'
import word from '../../assets/search_file_icons/file_icon_word.svg'
import excel from '../../assets/search_file_icons/file_icon_excel.svg'
import ppt from '../../assets/search_file_icons/file_icon_ppt.svg'
import txt from '../../assets/search_file_icons/file_icon_txt.svg'
import md from '../../assets/search_file_icons/file_icon_md.svg'
import csv from '../../assets/search_file_icons/file_icon_csv.svg'
import audio from '../../assets/search_file_icons/file_icon_audio.svg'
import video from '../../assets/search_file_icons/file_icon_video.svg'
import zip from '../../assets/search_file_icons/file_icon_zip.svg'
import fallback from '../../assets/search_file_icons/file_icon_default.svg'
import location from '../../assets/search_file_icons/location.svg'
import play from '../../assets/search_file_icons/video_play.svg'

const icons = { pdf, word, excel, ppt, txt, md, csv, audio, video, zip, default: fallback, dmg: fallback }
const assetUrl = (value: string, type = 'svg+xml') => /^(data:|\/)/.test(value) ? value : `data:image/${type};base64,${value}`
const clamp = (lines: number): CSSProperties => ({ display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' })
const plain: CSSProperties = { font: 'inherit', border: 0, cursor: 'pointer', color: arkmeTheme.text, background: 'transparent' }
export function searchUploadDate(millis: number): string {
  const date = new Date(millis)
  if (!Number.isFinite(date.valueOf())) return ''
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const offset = (today - day) / 86_400_000
  if (offset === 0) return time
  if (offset === 1) return tr("昨天 {v0}", { v0: time })
  if (offset === 2) return tr("前天 {v0}", { v0: time })
  return `${date.getFullYear() === now.getFullYear() ? '' : `${date.getFullYear()}-`}${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`
}
export function searchDuration(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds))
  const units = [Math.floor(value / 60) % 60, value % 60]
  if (value >= 3600) units.unshift(Math.floor(value / 3600))
  return units.map(unit => String(unit).padStart(2, '0')).join(':')
}
export function SearchMediaTile({ url, video, durationSec, name, onOpen, unavailable = false }: {
  url?: string | undefined; video: boolean; durationSec?: number | undefined; name: string; onOpen(): void; unavailable?: boolean
}) {
  useArkmeLocale()
  const [failed, setFailed] = useState(false)
  const [measured, setMeasured] = useState(0)
  useEffect(() => { setFailed(false); setMeasured(0) }, [url])
  const duration = durationSec || measured
  return <button type="button" data-search-media-tile aria-label={`查看${video ? tr("视频") : tr("图片")} ${name}`} onClick={onOpen}
    style={{ ...plain, position: 'relative', padding: 0, borderRadius: 0, overflow: 'hidden', aspectRatio: '1', minWidth: 0, background: arkmeTheme.subtle }}>
    {url && !failed ? video
      ? <video src={url} muted playsInline preload="metadata" onError={() => setFailed(true)} onLoadedMetadata={event => { if (Number.isFinite(event.currentTarget.duration)) setMeasured(event.currentTarget.duration) }} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      : <img src={url} alt={name} loading="lazy" onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      : <span style={{ color: arkmeTheme.tertiary, fontSize: 11 }}>{unavailable || failed ? '点击查看原媒体' : tr("加载中…")}</span>}
    {video && duration > 0 && <span style={{ position: 'absolute', left: 6, bottom: 8, height: 20, display: 'flex', alignItems: 'center', gap: 2, padding: '0 5px', borderRadius: 4, background: 'rgba(0,0,0,.4)', color: '#fff', fontSize: 11, fontWeight: 600 }}>
      <img src={assetUrl(play)} alt="" aria-hidden width={6} height={8} />{duration > 0 ? searchDuration(duration) : tr("视频")}
    </span>}
  </button>
}
export function SearchFileRow({ file, item, onOpen }: { file: ArkmeSearchAssetItem; item: ArkmeSearchRecordItem; onOpen(): void }) {
  const kind = arkmeFileIconKind(file.fileName, file.mimeType)
  return <div style={{ borderBottom: `0.5px solid ${arkmeTheme.border}` }}><button type="button" className="arkme-search-file-row" aria-label={`打开文件 ${file.fileName || '未知文件'}`} onClick={onOpen}
    style={{ ...plain, width: '100%', display: 'flex', alignItems: 'center', padding: '8px 10px', gap: 12, textAlign: 'left', borderRadius: 10 }}>
    <span style={{ width: 40, height: 40, borderRadius: 8, background: arkmeTheme.subtle, display: 'grid', placeItems: 'center', flex: 'none' }}>
      <img src={assetUrl(icons[kind])} alt="" aria-hidden width={22} height={22} data-search-file-icon={kind === 'dmg' ? 'default' : kind} />
    </span>
    <span style={{ minWidth: 0 }}><span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, fontWeight: 500 }}>{file.fileName || '未知文件'}</span>
      <span style={{ display: 'block', marginTop: 4, color: arkmeTheme.tertiary, fontSize: 12, lineHeight: '16px' }}>{searchUploadDate(item.sendAtMillis)} {tr("上传")}</span></span>
  </button></div>
}
export function searchLinkUrls(item: ArkmeSearchRecordItem): string[] {
  return [...new Set(textLinkRuns([item.linkUrl, item.textContent].filter(Boolean).join('\n')).flatMap(run => run.kind === 'link' ? [run.href] : []))].slice(0, 5)
}
function SearchLinkCard({ url, onLocate }: { url: string; onLocate?: (() => void) | undefined }) {
  useArkmeLocale()
  const [metadata, setMetadata] = useState<ArkmeLinkMetadata | null>()
  const [notice, setNotice] = useState('')
  const [imageFailed, setImageFailed] = useState(false)
  useEffect(() => {
    let active = true
    setMetadata(undefined); setImageFailed(false); setNotice('')
    if (!arkmeShouldResolveLinkMetadata(url)) { setMetadata(null); return }
    void arkmeLinkMetadataResolver.resolve(url).then(value => { if (active) setMetadata(value) }).catch(() => { if (active) setMetadata(null) })
    return () => { active = false }
  }, [url])
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setNotice('已复制') }
    catch { setNotice('复制失败，请重试') }
  }
  return <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
    <div style={{ flex: 1, minWidth: 0, borderRadius: 12, background: arkmeTheme.subtle, border: `1px solid ${arkmeTheme.border}`, padding: '10px 10px 0' }}>
      <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}>
        {metadata === undefined ? <span role="status" aria-label={tr("加载链接信息")} style={{ display: 'block', marginBottom: 10 }}><span style={{ display: 'block', width: '70%', height: 16, borderRadius: 6, background: arkmeTheme.borderSoft }} /></span> : null}
        {metadata?.title && <span style={{ ...clamp(2), fontSize: 16, marginBottom: 10 }}>{metadata.title}</span>}
        <span style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 30 }}>
          {metadata?.imageUrl && !imageFailed && <img src={metadata.imageUrl} referrerPolicy="no-referrer" alt="" onError={() => setImageFailed(true)} style={{ width: 30, height: 30, objectFit: 'cover', borderRadius: 4 }} />}
          <span style={{ ...clamp(2), fontSize: 12, color: arkmeTheme.secondary }}>{metadata?.description || url}</span>
        </span>
      </a>
      <button type="button" onClick={() => { void copy() }} aria-label={`复制链接 ${url}`} style={{ ...plain, display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 0', marginTop: 10, borderTop: `1px solid ${arkmeTheme.border}`, color: arkmeTheme.tertiary, fontSize: 12 }}>
        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}>{new URL(url).hostname.replace(/^www\./, '')}</span><span aria-hidden style={{ width: 14, height: 14, flex: 'none', background: 'currentColor', mask: `url("${assetUrl(copyIcon, 'png')}") center / contain no-repeat` }} />
      </button>
      {notice && <span role="status" style={{ display: 'block', paddingBottom: 6, fontSize: 12, color: arkmeTheme.secondary }}>{notice}</span>}
    </div>
    <span style={{ width: 27, flex: 'none' }}>{onLocate && <button type="button" aria-label={tr("定位链接消息")} onClick={onLocate} style={{ ...plain, padding: 5, borderRadius: 30, background: arkmeTheme.subtle, display: 'flex' }}><img src={assetUrl(location)} alt="" aria-hidden width={17} height={17} /></button>}</span>
  </div>
}
export function SearchLinkRows({ item, onLocate }: { item: ArkmeSearchRecordItem; onLocate(): void }) {
  const urls = searchLinkUrls(item)
  return <div style={{ padding: '10px 0', borderBottom: `1px solid ${arkmeTheme.border}` }}>
    {urls.map((url, index) => <SearchLinkCard key={url} url={url} onLocate={index === 0 ? onLocate : undefined} />)}
    {urls.length === 0 && <button type="button" style={plain} onClick={onLocate}>{tr("查看链接消息")}</button>}
    <div style={{ fontSize: 12, color: arkmeTheme.tertiary, marginTop: 6 }}>{searchUploadDate(item.sendAtMillis)}{item.sourceTitle ? ` · ${item.sourceTitle}` : ''}</div>
  </div>
}
