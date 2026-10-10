import { createContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'

export const AttachmentPreviewSurface = createContext<Document | undefined>(undefined)
type Bridge = { version: number; focus(): void; close(): void }
export function attachmentPreviewBridge(): Bridge | undefined {
  return typeof window === 'undefined' ? undefined : (window as Window & { arkmeAttachmentPreview?: Bridge }).arkmeAttachmentPreview
}

/** The child has no application bootstrap. Existing hooks run in the opener. */
export class AttachmentPreviewWindow {
  private child: Window | undefined
  private root: Root | undefined
  private identity: string | undefined
  private disconnect: (() => void) | undefined
  constructor(private readonly opener: Window, private readonly open = () => opener.open('about:blank', 'arkme-attachment-preview', 'width=800,height=600')) {}

  show(identity: string, render: (document: Document) => ReactNode): void {
    if (this.child?.closed) this.dispose()
    if (!this.child) {
      const child = this.open()
      if (!child) throw new Error('无法创建预览窗口，请重试')
      try {
        const doc = child.document
        doc.title = 'Arkme · 文件预览'
        const base = doc.createElement('base'); base.href = this.opener.location.href; doc.head.append(base)
        doc.body.style.margin = '0'
        this.child = child
        this.root = createRoot(this.opener.document.createElement('div'))
        const sync = () => {
          doc.head.querySelectorAll('[data-arkme-preview-style]').forEach(node => node.remove())
          for (const source of this.opener.document.querySelectorAll('style,link[rel="stylesheet"]')) {
            const copy = source.cloneNode(true) as HTMLElement
            copy.setAttribute('data-arkme-preview-style', ''); doc.head.append(copy)
          }
          doc.documentElement.className = this.opener.document.documentElement.className
          doc.documentElement.style.cssText = this.opener.document.documentElement.style.cssText
          doc.documentElement.lang = this.opener.document.documentElement.lang
          doc.body.className = this.opener.document.body.className
          for (const target of [doc.documentElement, doc.body]) {
            const source = target === doc.body ? this.opener.document.body : this.opener.document.documentElement
            for (const attr of Array.from(target.attributes)) if (attr.name.startsWith('data-')) target.removeAttribute(attr.name)
            for (const attr of Array.from(source.attributes)) if (attr.name.startsWith('data-')) target.setAttribute(attr.name, attr.value)
          }
          // Theme variables can be attached to the body by the host.
          for (const name of Array.from(this.opener.document.body.style)) {
            if (name.startsWith('--')) doc.body.style.setProperty(name, this.opener.document.body.style.getPropertyValue(name))
          }
        }
        sync()
        const observer = new MutationObserver(sync)
        observer.observe(this.opener.document.head, {subtree: true, childList: true, attributes: true, characterData: true})
        observer.observe(this.opener.document.documentElement, {attributes: true})
        observer.observe(this.opener.document.body, {attributes: true})
        const unloaded = () => { if (this.child === child) this.dispose() }
        child.addEventListener('beforeunload', unloaded)
        this.disconnect = () => { observer.disconnect(); child.removeEventListener('beforeunload', unloaded) }
      } catch (error) { this.dispose(); child.close(); throw error }
    }
    if (identity !== this.identity) {
      this.identity = identity
      const doc = this.child.document
      this.root!.render(createPortal(<AttachmentPreviewSurface.Provider value={doc}>{render(doc)}</AttachmentPreviewSurface.Provider>, doc.body))
    }
    this.child.focus()
    attachmentPreviewBridge()?.focus()
  }

  close = (): void => {
    const child = this.child
    this.dispose()
    if (child && !child.closed) child.close()
    attachmentPreviewBridge()?.close()
  }
  private dispose(): void {
    this.disconnect?.(); this.disconnect = undefined
    for (const media of this.child?.document.querySelectorAll('video,audio') ?? []) {
      const element = media as HTMLMediaElement
      element.pause(); element.removeAttribute('src'); element.load()
    }
    this.root?.unmount(); this.root = undefined
    this.child = undefined; this.identity = undefined
  }
}
let host: AttachmentPreviewWindow | undefined
export function showAttachmentPreview(identity: string, render: (document: Document) => ReactNode): void {
  host ??= new AttachmentPreviewWindow(window)
  try { host.show(identity, render) }
  catch { host.close(); host.show(identity, render) }
}
export function closeAttachmentPreview(): void { host?.close(); host = undefined }
