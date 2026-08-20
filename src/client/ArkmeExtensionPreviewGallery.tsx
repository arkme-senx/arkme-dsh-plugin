import { useState, type CSSProperties } from 'react'
import type { ArkmeExtensionPreviewItem } from '../extensions/types.js'

const PREVIEW_REF = /^preview_v1_[a-f0-9]{64}$/

const styles: Record<string, CSSProperties> = {
  section: { padding: '14px 0', borderTop: '1px solid var(--dsw-alias-border-l1, #e6e8eb)' },
  label: { color: 'var(--dsw-alias-label-tertiary, #969ca5)', fontSize: 10, lineHeight: '16px' },
  viewport: {
    width: '100%', aspectRatio: '16 / 9', display: 'grid', placeItems: 'center', overflow: 'hidden',
    marginTop: 8, borderRadius: 14, background: 'var(--dsw-alias-fill-secondary, #f4f5f6)',
  },
  image: { width: '100%', height: '100%', display: 'block', objectFit: 'contain' },
  failure: { color: 'var(--dsw-alias-label-tertiary, #969ca5)', fontSize: 12 },
  thumbnails: { display: 'flex', gap: 8, overflowX: 'auto', marginTop: 9, paddingBottom: 2 },
  thumbnail: {
    width: 72, height: 50, flex: '0 0 auto', overflow: 'hidden', padding: 2,
    border: '1px solid var(--dsw-alias-border-l1, #e6e8eb)', borderRadius: 9,
    background: 'var(--dsw-alias-bg-base, #fff)', cursor: 'pointer', boxSizing: 'border-box',
  },
  thumbnailImage: { width: '100%', height: '100%', display: 'block', objectFit: 'cover', borderRadius: 6 },
  thumbnailFailure: {
    width: '100%', height: '100%', display: 'grid', placeItems: 'center', borderRadius: 6,
    background: 'var(--dsw-alias-fill-secondary, #f4f5f6)',
    color: 'var(--dsw-alias-label-tertiary, #969ca5)', fontSize: 11,
  },
}

function validPreviewItems(previews: readonly ArkmeExtensionPreviewItem[]): ArkmeExtensionPreviewItem[] {
  const seen = new Set<string>()
  return previews.filter(item => {
    if (!PREVIEW_REF.test(item.preview_ref) || seen.has(item.preview_ref)) return false
    seen.add(item.preview_ref)
    return true
  })
}

export function arkmeExtensionPreviewUrl(extensionId: string, previewRef: string): string {
  return `/arkme-self/api/extension-preview?extension_id=${encodeURIComponent(extensionId)}&preview_ref=${encodeURIComponent(previewRef)}`
}

export function extensionPreviewSelection(
  currentRef: string | undefined,
  previews: readonly ArkmeExtensionPreviewItem[],
): string | undefined {
  const valid = validPreviewItems(previews)
  if (currentRef !== undefined && valid.some(item => item.preview_ref === currentRef)) return currentRef
  return valid[0]?.preview_ref
}

export function ArkmeExtensionPreviewGallery({ extensionId, extensionName, previews }: {
  extensionId: string
  extensionName: string
  previews: readonly ArkmeExtensionPreviewItem[]
}) {
  const valid = validPreviewItems(previews)
  const [selectedRef, setSelectedRef] = useState<string>()
  const [failedRefs, setFailedRefs] = useState<Set<string>>(() => new Set())
  const activeRef = extensionPreviewSelection(selectedRef, valid)
  if (activeRef === undefined) return null
  const activeIndex = valid.findIndex(item => item.preview_ref === activeRef)
  const activeFailed = failedRefs.has(activeRef)
  const markFailed = (previewRef: string) => {
    setFailedRefs(current => current.has(previewRef) ? current : new Set([...current, previewRef]))
  }

  return <section style={styles.section} aria-label="扩展预览图">
    <div style={styles.label}>预览</div>
    <div style={styles.viewport}>
      {activeFailed
        ? <div style={styles.failure} role="status">这张预览图暂时无法加载</div>
        : <img
            src={arkmeExtensionPreviewUrl(extensionId, activeRef)}
            alt={`${extensionName}的第 ${activeIndex + 1} 张预览图`}
            draggable={false}
            loading="lazy"
            decoding="async"
            style={styles.image}
            onError={() => { markFailed(activeRef) }}
          />}
    </div>
    {valid.length > 1 && <div style={styles.thumbnails} role="group" aria-label="切换扩展预览图">
      {valid.map((item, index) => {
        const selected = item.preview_ref === activeRef
        const failed = failedRefs.has(item.preview_ref)
        return <button
          key={item.preview_ref}
          type="button"
          aria-label={`查看第 ${index + 1} 张预览图`}
          aria-pressed={selected}
          style={{
            ...styles.thumbnail,
            ...(selected ? { borderColor: 'var(--dsw-alias-state-success-primary, #09B83E)', boxShadow: '0 0 0 1px var(--dsw-alias-state-success-primary, #09B83E)' } : {}),
          }}
          onClick={() => { setSelectedRef(item.preview_ref) }}
        >
          {failed
            ? <span style={styles.thumbnailFailure} aria-hidden>{index + 1}</span>
            : <img
                src={arkmeExtensionPreviewUrl(extensionId, item.preview_ref)}
                alt=""
                draggable={false}
                loading="lazy"
                decoding="async"
                style={styles.thumbnailImage}
                onError={() => { markFailed(item.preview_ref) }}
              />}
        </button>
      })}
    </div>}
  </section>
}
