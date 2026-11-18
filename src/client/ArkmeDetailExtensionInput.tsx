import type { ReactNode } from 'react'
import { FileTextIcon } from '@phosphor-icons/react/dist/csr/FileText'
import { arkmeDetailExtensionComposerStyles as styles } from './detail-extension-composer-style.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'

const attachmentStyle = {
  width: 18, height: 28, flex: 'none', alignSelf: 'flex-start', display: 'grid', placeItems: 'center',
  padding: 0, border: 0, borderRadius: 6, background: 'transparent', color: arkmeTheme.tertiary, cursor: 'pointer',
}

export function ArkmeDetailExtensionInput({ before, children, onAttach, attachmentDisabled }: {
  before?: ReactNode
  children: ReactNode
  onAttach?: (() => void) | undefined
  attachmentDisabled: boolean
}) {
  const disabled = attachmentDisabled || !onAttach
  return <div className="arkme-detail-extension-input-bar" style={styles.bar}>
    <style>{'.arkme-detail-extension-input-shell .ProseMirror > :last-child { margin-bottom:0; }'}</style>
    {before}
    <div className="arkme-detail-extension-input-shell" style={styles.shell}>
      <button data-arkme-feedback="neutral" type="button" aria-label={tr('添加延展附件')} disabled={disabled}
        style={{ ...attachmentStyle, opacity: disabled ? .4 : 1 }} onClick={onAttach}><FileTextIcon size={18} /></button>
      {children}
    </div>
  </div>
}
