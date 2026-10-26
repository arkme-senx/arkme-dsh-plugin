export interface FormattingRect { left: number; right: number; top: number; bottom: number }
/** Anchor to the first visible line, never to the middle of a long multi-paragraph selection. */
export function articleFormattingSeat(rects: readonly FormattingRect[], clip: FormattingRect, viewportWidth: number, width: number, height: number): { left: number; top: number } | undefined {
  const visible = rects.find(rect => rect.bottom > clip.top && rect.top < clip.bottom && rect.right > clip.left && rect.left < clip.right)
  if (!visible) return undefined
  const fits = clip.right - clip.left >= width + 16
  const minLeft = fits ? Math.max(8, clip.left + 8) : 8
  const maxLeft = fits ? Math.min(viewportWidth - width - 8, clip.right - width - 8) : viewportWidth - width - 8
  const left = Math.max(minLeft, Math.min(maxLeft, (Math.max(clip.left, visible.left) + Math.min(clip.right, visible.right) - width) / 2))
  const above = visible.top - height - 8
  const top = above >= 8 ? above : Math.min(clip.bottom - height - 4, Math.max(clip.top + 4, visible.bottom + 8))
  return { left, top: Math.max(8, top) }
}

/** Same portable link schemes accepted by the editor; never serialize an executable URL. */
export function articleFormattingHref(input: string): string | undefined {
  const value = input.trim()
  if (!value || /[\u0000-\u0020\u007f]/u.test(value)) return undefined
  if (value.startsWith('#') && value.length > 1) return value
  const normalized = /^www\./iu.test(value) ? `https://${value}` : value
  try {
    const url = new URL(normalized)
    if (['http:', 'https:'].includes(url.protocol) && url.hostname) return url.href
    if (['mailto:', 'tel:'].includes(url.protocol) && url.pathname) return normalized
  } catch { /* An incomplete URL remains in the dialog for correction. */ }
  return undefined
}
