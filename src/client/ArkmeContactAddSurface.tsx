import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import jsQRModule from 'jsqr'
import qrcode from 'qrcode-generator'
import type { ArkmeContactAddResult, ArkmeContactSearchResult, ArkmeSourceItem, ArkmeUserProfileSnapshot } from '../types.js'
import { ArkmeClientError, callArkme } from './api.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { arkmeTheme } from './arkme-theme.js'

const ARKME_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{4,31}$/
const decodeQr = ((jsQRModule as unknown as { default?: typeof import('jsqr').default }).default
  ?? jsQRModule) as unknown as typeof import('jsqr').default
const styles: Record<string, CSSProperties> = {
  shell: { width: 'min(720px, 100%)', minHeight: '100%', margin: '0 auto', padding: '28px 34px 38px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', color: arkmeTheme.text },
  compactShell: { width: '100%', height: '100%', minHeight: 450, margin: 0, padding: '20px 22px 22px' },
  form: { display: 'flex', alignItems: 'center', minHeight: 58, padding: '0 16px 0 20px', borderRadius: 16, background: arkmeTheme.subtle },
  compactForm: { minHeight: 48, padding: '0 10px 0 15px', borderRadius: 12 },
  input: { minWidth: 0, flex: 1, border: 0, outline: 0, background: 'transparent', color: arkmeTheme.text, font: 'inherit', fontSize: 17 },
  iconButton: { width: 42, height: 42, padding: 8, border: 0, borderRadius: 10, background: 'transparent', color: arkmeTheme.text, cursor: 'pointer' },
  scan: { width: '100%', minHeight: 66, marginTop: 18, padding: '0 20px', display: 'flex', alignItems: 'center', gap: 15, border: `1px solid ${arkmeTheme.border}`, borderRadius: 16, background: arkmeTheme.base, color: arkmeTheme.text, cursor: 'pointer', font: 'inherit', fontSize: 16, textAlign: 'left' },
  compactScan: { minHeight: 52, marginTop: 12, padding: '0 15px', borderRadius: 12, gap: 11, fontSize: 14 },
  arrow: { marginLeft: 'auto', color: arkmeTheme.tertiary, fontSize: 26 },
  resultArea: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  statusArea: { height: 53, minHeight: 53, overflow: 'hidden' },
  candidateArea: { flex: '1 1 auto', minHeight: 0, overflow: 'hidden' },
  notice: { marginTop: 14, padding: '11px 13px', borderRadius: 10, background: arkmeTheme.subtle, color: arkmeTheme.secondary, fontSize: 13 },
  error: { marginTop: 14, padding: '11px 13px', borderRadius: 10, background: arkmeTheme.dangerSoft, color: arkmeTheme.danger, fontSize: 13 },
  card: { marginTop: 20, padding: 20, border: `1px solid ${arkmeTheme.border}`, borderRadius: 16, background: arkmeTheme.base },
  identity: { display: 'flex', alignItems: 'center', gap: 14 },
  identityText: { minWidth: 0, flex: 1 },
  name: { margin: 0, fontSize: 17, fontWeight: 600 },
  meta: { margin: '5px 0 0', color: arkmeTheme.secondary, fontSize: 13 },
  remark: { width: '100%', height: 42, marginTop: 18, padding: '0 12px', boxSizing: 'border-box', border: `1px solid ${arkmeTheme.border}`, borderRadius: 10, background: arkmeTheme.base, color: arkmeTheme.text, font: 'inherit' },
  primary: { width: '100%', minHeight: 44, marginTop: 12, border: 0, borderRadius: 10, background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction, cursor: 'pointer', font: 'inherit', fontWeight: 600 },
  footer: { marginTop: 'auto', paddingTop: 30, borderTop: `1px solid ${arkmeTheme.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20 },
  compactFooter: { marginTop: 0, paddingTop: 18 },
  profileName: { margin: 0, fontSize: 18, fontWeight: 600 },
  profileId: { margin: '8px 0 0', display: 'flex', alignItems: 'center', gap: 6, color: arkmeTheme.secondary, fontSize: 14 },
  copy: { width: 28, height: 28, padding: 5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: 7, background: 'transparent', color: arkmeTheme.secondary, cursor: 'pointer' },
  qr: { width: 112, height: 112, padding: 12, boxSizing: 'border-box', borderRadius: 16, background: '#fff' },
  compactQr: { width: 92, height: 92, padding: 9, borderRadius: 12 },
  scannerBackdrop: { position: 'fixed', inset: 0, zIndex: 1000, padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, .72)' },
  scannerDialog: { width: 'min(460px, 100%)', padding: 18, boxSizing: 'border-box', borderRadius: 18, background: arkmeTheme.base, color: arkmeTheme.text, boxShadow: '0 18px 60px rgba(0,0,0,.35)' },
  scannerHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  scannerTitle: { margin: 0, fontSize: 18, fontWeight: 600 },
  scannerClose: { width: 36, height: 36, border: 0, borderRadius: 9, background: arkmeTheme.subtle, color: arkmeTheme.text, cursor: 'pointer', fontSize: 24, lineHeight: 1 },
  imageDropzone: { minHeight: 230, padding: 24, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: `1.5px dashed ${arkmeTheme.border}`, borderRadius: 14, background: arkmeTheme.subtle, textAlign: 'center' },
  imageDropTitle: { margin: '15px 0 0', fontSize: 16, fontWeight: 600 },
  imageDropHint: { margin: '8px 0 0', color: arkmeTheme.secondary, fontSize: 13, lineHeight: 1.6 },
  cameraFrame: { position: 'relative', overflow: 'hidden', aspectRatio: '1 / 1', borderRadius: 14, background: '#080808' },
  video: { width: '100%', height: '100%', objectFit: 'cover' },
  scanGuide: { position: 'absolute', inset: '17%', border: '2px solid rgba(255,255,255,.9)', borderRadius: 16, boxShadow: '0 0 0 999px rgba(0,0,0,.18)', pointerEvents: 'none' },
  scannerHint: { margin: '13px 0 0', textAlign: 'center', color: arkmeTheme.secondary, fontSize: 13 },
  chooseImage: { width: '100%', minHeight: 42, marginTop: 13, border: `1px solid ${arkmeTheme.border}`, borderRadius: 10, background: arkmeTheme.subtle, color: arkmeTheme.text, cursor: 'pointer', font: 'inherit' },
  secondaryAction: { width: '100%', minHeight: 40, marginTop: 10, border: 0, background: 'transparent', color: arkmeTheme.secondary, cursor: 'pointer', font: 'inherit', fontSize: 13 },
}

function errorMessage(error: unknown): string {
  return error instanceof ArkmeClientError ? error.body.message : error instanceof Error ? error.message : String(error)
}

export function buildArkmePersonalShareUrl(arkmeId: string, shareWebsite: string): string {
  const identifier = arkmeId.trim()
  if (!ARKME_ID_PATTERN.test(identifier)) return ''
  try {
    const site = new URL(shareWebsite)
    if (site.protocol !== 'https:' || site.username !== '' || site.password !== '') return ''
    return `${site.origin}/${encodeURIComponent(identifier)}`
  } catch { return '' }
}

export function extractArkmeContactIdentifierFromQr(raw: string, shareWebsite: string): string {
  const value = raw.trim()
  if (value === '') return ''
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return ''
    const configuredOrigin = new URL(shareWebsite).origin.toLowerCase()
    if (url.origin.toLowerCase() !== configuredOrigin) return ''
    const parts = url.pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part))
    const identifier = parts.length === 1 ? parts[0]
      : parts.length === 2 && parts[0] === 'shijie' ? parts[1]
        : parts.length === 3 && parts[0] === 'app' && parts[1] === 'shijie' ? parts[2] : undefined
    return identifier !== undefined && ARKME_ID_PATTERN.test(identifier) ? identifier : ''
  } catch { return '' }
}

function qrDataUrl(content: string): string | undefined {
  if (content === '') return undefined
  const qr = qrcode(0, 'M'); qr.addData(content); qr.make()
  return qr.createDataURL(5, 8)
}

export function ArkmeContactAddSurface({ shareWebsite, onSourceActivated, compact = false }: {
  shareWebsite: string
  onSourceActivated(source: ArkmeSourceItem): void
  compact?: boolean
}) {
  const [identifier, setIdentifier] = useState('')
  const [candidate, setCandidate] = useState<ArkmeContactSearchResult>()
  const [remark, setRemark] = useState('')
  const [profile, setProfile] = useState<ArkmeUserProfileSnapshot['profile']>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [cameraActive, setCameraActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cameraStreamRef = useRef<MediaStream>()
  const cameraFrameRef = useRef<number>()
  const scanResolvedRef = useRef(false)
  const requestRevision = useRef(0)

  useEffect(() => {
    let active = true
    void callArkme<ArkmeUserProfileSnapshot>('user.profile').then(value => { if (active) setProfile(value.profile) }).catch(() => undefined)
    return () => { active = false; requestRevision.current += 1 }
  }, [])

  const shareUrl = useMemo(() => buildArkmePersonalShareUrl(profile?.arkmeId ?? '', shareWebsite), [profile?.arkmeId, shareWebsite])
  const qr = useMemo(() => qrDataUrl(shareUrl), [shareUrl])

  const stopCamera = useCallback(() => {
    if (cameraFrameRef.current !== undefined) cancelAnimationFrame(cameraFrameRef.current)
    cameraFrameRef.current = undefined
    cameraStreamRef.current?.getTracks().forEach(track => { track.stop() })
    cameraStreamRef.current = undefined
    if (videoRef.current !== null) videoRef.current.srcObject = null
  }, [])

  const searchIdentifier = useCallback(async (value: string) => {
    const revision = ++requestRevision.current
    setBusy(true); setError(''); setNotice(''); setCandidate(undefined)
    try {
      const result = await callArkme<ArkmeContactSearchResult>('contacts.search', { identifier: value })
      if (revision === requestRevision.current) setCandidate(result)
    } catch (caught) { if (revision === requestRevision.current) setError(errorMessage(caught)) }
    finally { if (revision === requestRevision.current) setBusy(false) }
  }, [])

  const search = async (event?: FormEvent) => {
    event?.preventDefault()
    const value = identifier.trim()
    if (value === '') { setError('请输入手机号或即我号'); return }
    await searchIdentifier(value)
  }

  const applyScannedValue = useCallback(async (raw: string): Promise<boolean> => {
    const value = extractArkmeContactIdentifierFromQr(raw, shareWebsite)
    if (value === '') { setError('不是有效的好友二维码，请扫描客户端生成的个人二维码'); return false }
    stopCamera(); setScannerOpen(false); setIdentifier(value)
    await searchIdentifier(value)
    return true
  }, [searchIdentifier, shareWebsite, stopCamera])

  useEffect(() => {
    if (!scannerOpen || !cameraActive) { stopCamera(); return }
    scanResolvedRef.current = false
    let disposed = false
    let nextDecodeAt = 0
    const start = async () => {
      if (navigator.mediaDevices?.getUserMedia === undefined) {
        setError('当前浏览器无法调用摄像头，请从图片选择二维码')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } })
        if (disposed) { stream.getTracks().forEach(track => { track.stop() }); return }
        cameraStreamRef.current = stream
        const video = videoRef.current
        if (video === null) { stream.getTracks().forEach(track => { track.stop() }); return }
        video.srcObject = stream
        await video.play()
        const scanFrame = () => {
          if (disposed || scanResolvedRef.current) return
          const canvas = canvasRef.current
          const now = performance.now()
          if (now >= nextDecodeAt && canvas !== null && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
            nextDecodeAt = now + 120
            const scale = Math.min(1, 960 / video.videoWidth)
            canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
            canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
            const context = canvas.getContext('2d', { willReadFrequently: true })
            if (context !== null) {
              context.drawImage(video, 0, 0, canvas.width, canvas.height)
              const image = context.getImageData(0, 0, canvas.width, canvas.height)
              const decoded = decodeQr(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' })
              if (decoded !== null) {
                scanResolvedRef.current = true
                void applyScannedValue(decoded.data).then(applied => {
                  if (!applied && !disposed) {
                    scanResolvedRef.current = false
                    nextDecodeAt = performance.now() + 700
                    cameraFrameRef.current = requestAnimationFrame(scanFrame)
                  }
                })
                return
              }
            }
          }
          cameraFrameRef.current = requestAnimationFrame(scanFrame)
        }
        cameraFrameRef.current = requestAnimationFrame(scanFrame)
      } catch (caught) {
        if (disposed) return
        const name = caught instanceof DOMException ? caught.name : ''
        setError(name === 'NotAllowedError' ? '无法使用摄像头，请允许摄像头权限后重试'
          : name === 'NotFoundError' ? '未找到可用摄像头'
            : `摄像头启动失败：${errorMessage(caught)}`)
      }
    }
    void start()
    return () => { disposed = true; stopCamera() }
  }, [applyScannedValue, cameraActive, scannerOpen, stopCamera])

  const add = async () => {
    if (candidate === undefined || !candidate.canAdd) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await callArkme<ArkmeContactAddResult>('contacts.add', {
        contactRef: candidate.contactRef,
        ...(remark.trim() === '' ? {} : { remark: remark.trim() }),
        requestUid: crypto.randomUUID(),
      })
      setNotice(result.state === 'pending' ? '已添加待注册联系人并打开会话' : '联系人已添加')
      onSourceActivated(result.source)
    } catch (caught) { setError(errorMessage(caught)) }
    finally { setBusy(false) }
  }

  const scanFile = async (file: File | undefined) => {
    if (file === undefined) return
    setError(''); setNotice(''); setBusy(true)
    try {
      const bitmap = await createImageBitmap(file)
      try {
        const canvas = canvasRef.current ?? document.createElement('canvas')
        const scale = Math.min(1, 1600 / bitmap.width)
        canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (context === null) throw new Error('当前浏览器无法读取二维码图片')
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const image = context.getImageData(0, 0, canvas.width, canvas.height)
        const decoded = decodeQr(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' })
        if (decoded === null) throw new Error('未识别到二维码，请选择清晰完整的二维码图片')
        await applyScannedValue(decoded.data)
      } finally { bitmap.close() }
    } catch (caught) { setError(errorMessage(caught)) }
    finally { setBusy(false); if (fileInputRef.current !== null) fileInputRef.current.value = '' }
  }

  const copyArkmeId = async () => {
    if (profile?.arkmeId === undefined || profile.arkmeId === '') return
    try { await navigator.clipboard.writeText(profile.arkmeId); setError(''); setNotice('即我号已复制') }
    catch { setError('复制失败，请手动选择即我号复制') }
  }

  const closeScanner = () => { setScannerOpen(false); setCameraActive(false); stopCamera() }

  const scanDroppedFiles = (files: FileList | File[]) => {
    if (busy) return
    const file = Array.from(files).find(candidateFile => candidateFile.type.startsWith('image/'))
    if (file === undefined) { setError('请粘贴或选择二维码图片'); return }
    void scanFile(file)
  }

  return <div style={{ ...styles.shell, ...(compact ? styles.compactShell : {}) }}>
    <form style={{ ...styles.form, ...(compact ? styles.compactForm : {}) }} onSubmit={event => { void search(event) }}>
      <input style={styles.input} value={identifier} disabled={busy} placeholder="输入手机号或即我号" aria-label="手机号或即我号" onChange={event => { setIdentifier(event.target.value); setCandidate(undefined); setError(''); setNotice('') }} />
      <button type="submit" style={styles.iconButton} disabled={busy} aria-label="搜索联系人"><svg viewBox="0 0 24 24" width="26" height="26" aria-hidden><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m15.5 15.5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></button>
    </form>
    <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={event => { void scanFile(event.target.files?.[0]) }} />
    <button type="button" style={{ ...styles.scan, ...(compact ? styles.compactScan : {}) }} disabled={busy} onClick={() => { setError(''); setNotice(''); setCameraActive(false); setScannerOpen(true) }}>
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M8 8h3v3H8zm5 0h3v3h-3zm-5 5h3v3H8zm6 1h2v2h-2z" fill="currentColor" /></svg>
      <span>识别二维码图片添加好友</span><span style={styles.arrow}>›</span>
    </button>
    <div style={styles.resultArea} data-arkme-contact-state-area>
      <div style={styles.statusArea} data-arkme-contact-status-area>
        {busy && <div style={styles.notice} role="status">正在处理…</div>}
        {!busy && error !== '' && !scannerOpen && <div style={styles.error} role="alert">{error}</div>}
        {!busy && notice !== '' && <div style={styles.notice} role="status">{notice}</div>}
      </div>
      <div style={styles.candidateArea} data-arkme-contact-candidate-area>
        {candidate !== undefined && <section style={styles.card} aria-label="联系人搜索结果">
          <div style={styles.identity}><ArkmeUserAvatar {...(candidate.avatarRef === undefined ? {} : { avatarRef: candidate.avatarRef })} size={48} label={`${candidate.displayName}的头像`} /><div style={styles.identityText}>
            <p style={styles.name}>{candidate.displayName}</p><p style={styles.meta}>{candidate.arkmeId === undefined ? '' : `即我号：${candidate.arkmeId} · `}{candidate.registered ? '已注册' : candidate.inviteBySms ? '未注册，将创建待注册联系人' : '未注册'}</p>
          </div></div>
          {candidate.isSelf ? <div style={styles.notice}>这是你自己，不能添加为联系人</div> : !candidate.canAdd ? <div style={styles.notice}>该账号当前无法添加</div> : <><input style={styles.remark} maxLength={100} value={remark} placeholder="备注（可选）" onChange={event => { setRemark(event.target.value) }} /><button type="button" style={styles.primary} disabled={busy} onClick={() => { void add() }}>添加并打开会话</button></>}
        </section>}
      </div>
    </div>
    {profile !== null && <footer style={{ ...styles.footer, ...(compact ? styles.compactFooter : {}) }}><div><p style={styles.profileName}>{profile.displayName || profile.nickname || 'Arkme'}</p><p style={styles.profileId}>即我号：{profile.arkmeId || '尚未设置'}
      {profile.arkmeId !== '' && <button type="button" style={styles.copy} title="复制即我号" aria-label="复制即我号" onClick={() => { void copyArkmeId() }}><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><rect x="8" y="8" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button>}
    </p></div>{qr !== undefined && <img src={qr} alt="我的好友二维码" title={shareUrl} style={{ ...styles.qr, ...(compact ? styles.compactQr : {}) }} />}</footer>}
    {scannerOpen && <div style={styles.scannerBackdrop} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeScanner() }}><section style={styles.scannerDialog} role="dialog" aria-modal="true" aria-label="识别联系人二维码"
      onPaste={event => { scanDroppedFiles(Array.from(event.clipboardData.items).flatMap(item => { const file = item.kind === 'file' ? item.getAsFile() : null; return file === null ? [] : [file] })) }}
      onDragOver={event => { event.preventDefault() }} onDrop={event => { event.preventDefault(); scanDroppedFiles(event.dataTransfer.files) }}>
      <div style={styles.scannerHeader}><h2 style={styles.scannerTitle}>{cameraActive ? '摄像头扫描' : '识别联系人二维码'}</h2><button type="button" style={styles.scannerClose} aria-label="关闭二维码识别" onClick={closeScanner}>×</button></div>
      {cameraActive ? <><div style={styles.cameraFrame}><video ref={videoRef} style={styles.video} autoPlay muted playsInline /><div style={styles.scanGuide} /></div><p style={styles.scannerHint}>将好友的个人二维码置于框内</p></>
        : <div style={styles.imageDropzone}>
          <svg viewBox="0 0 48 48" width="52" height="52" aria-hidden><rect x="5" y="5" width="38" height="38" rx="8" fill="none" stroke="currentColor" strokeWidth="2" opacity=".7" /><path d="M14 31l8-8 6 6 4-4 7 7M32 16h.01" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <p style={styles.imageDropTitle}>粘贴或拖入二维码截图</p><p style={styles.imageDropHint}>支持 ⌘V / Ctrl+V，也可以直接选择电脑中的图片</p>
        </div>}
      {error !== '' && <div style={styles.error} role="alert">{error}</div>}
      <button type="button" style={styles.chooseImage} disabled={busy} onClick={() => { fileInputRef.current?.click() }}>选择二维码图片</button>
      <button type="button" style={styles.secondaryAction} disabled={busy} onClick={() => { setError(''); setCameraActive(value => !value) }}>{cameraActive ? '返回图片识别' : '使用摄像头扫描'}</button>
    </section></div>}
    <canvas ref={canvasRef} hidden />
  </div>
}
