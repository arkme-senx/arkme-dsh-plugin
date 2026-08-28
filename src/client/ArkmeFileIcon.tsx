import audio from '../../assets/file_icons/file_icon_audio.svg'
import csv from '../../assets/file_icons/file_icon_csv.svg'
import fallback from '../../assets/file_icons/file_icon_default.svg'
import dmg from '../../assets/file_icons/file_icon_dmg.svg'
import excel from '../../assets/file_icons/file_icon_excel.svg'
import md from '../../assets/file_icons/file_icon_md.svg'
import pdf from '../../assets/file_icons/file_icon_pdf.svg'
import ppt from '../../assets/file_icons/file_icon_ppt.svg'
import txt from '../../assets/file_icons/file_icon_txt.svg'
import video from '../../assets/file_icons/file_icon_video.svg'
import word from '../../assets/file_icons/file_icon_word.svg'
import zip from '../../assets/file_icons/file_icon_zip.svg'

// User-selected Untitled UI Solid SVGs; provenance in docs/file-icon-licenses.md.
const assets = { audio, csv, default: fallback, dmg, excel, md, pdf, ppt, txt, video, word, zip }
export type ArkmeFileIconKind = keyof typeof assets
const extensions: Record<string, ArkmeFileIconKind> = {
  pdf: 'pdf', doc: 'word', docx: 'word', odt: 'word',
  xls: 'excel', xlsx: 'excel', ods: 'excel', ppt: 'ppt', pptx: 'ppt', odp: 'ppt',
  txt: 'txt', log: 'txt', md: 'md', markdown: 'md', csv: 'csv',
  mp3: 'audio', wav: 'audio', flac: 'audio', aac: 'audio', m4a: 'audio', ogg: 'audio', wma: 'audio',
  mp4: 'video', avi: 'video', mkv: 'video', mov: 'video', wmv: 'video', flv: 'video', webm: 'video', m4v: 'video',
  zip: 'zip', rar: 'zip', '7z': 'zip', tar: 'zip', gz: 'zip', bz2: 'zip', xz: 'zip',
  dmg: 'dmg',
}

/** Preserve the client's MIME-first classification, with a dedicated DMG icon. */
export function arkmeFileIconKind(fileName?: string, mimeType?: string): ArkmeFileIconKind {
  const mime = mimeType?.toLowerCase() ?? ''
  if (mime.includes('pdf')) return 'pdf'
  if (/msword|wordprocessingml|opendocument\.text/.test(mime)) return 'word'
  if (/excel|spreadsheetml|opendocument\.spreadsheet/.test(mime)) return 'excel'
  if (/powerpoint|presentationml|opendocument\.presentation/.test(mime)) return 'ppt'
  if (mime === 'text/plain') return 'txt'
  if (mime.includes('markdown')) return 'md'
  if (mime.includes('csv')) return 'csv'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  if (/zip|rar|7z|tar|gzip|compressed|archive/.test(mime)) return 'zip'
  if (mime === 'application/x-apple-diskimage') return 'dmg'
  const extension = fileName?.includes('.') ? fileName.split('.').pop()?.toLowerCase() ?? '' : ''
  return Object.hasOwn(extensions, extension) ? extensions[extension]! : 'default'
}

export function ArkmeFileIcon({ fileName, mimeType, size = 40 }: { fileName?: string; mimeType?: string; size?: number }) {
  const kind = arkmeFileIconKind(fileName, mimeType)
  const asset = assets[kind]
  // The production loader embeds base64; Vite's test/dev asset loader returns a URL.
  const src = /^(data:|\/)/.test(asset) ? asset : `data:image/svg+xml;base64,${asset}`
  return <img src={src} alt="" aria-hidden draggable={false} width={size} height={size}
    data-arkme-file-icon={kind} data-arkme-file-type={kind.toUpperCase()} data-arkme-file-icon-set="untitled-solid"
    style={{ display: 'block', width: size, height: size, flex: 'none', objectFit: 'contain' }} />
}
