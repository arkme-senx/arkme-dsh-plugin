import { tr, useArkmeLocale } from '../../locale.js'
import { directorySearchLayout } from '../../directory-search-layout.js'
import { useRef, type ReactNode } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { X } from '@phosphor-icons/react/dist/icons/X'

export function ContactDirectoryToolbar({ value, onChange, children }: {
  value: string
  onChange(value: string): void
  children?: ReactNode
}) {
  useArkmeLocale()
  const inputRef = useRef<HTMLInputElement>(null)
  return <div className="arkme-contact-directory-toolbar arkme-directory-search-toolbar" style={directorySearchLayout.toolbar} role="search" aria-label={tr("搜索联系人目录")}>
    <div className="arkme-contact-directory-search-field" style={directorySearchLayout.field}>
      <MagnifyingGlass size={16} style={directorySearchLayout.icon} aria-hidden />
      <input
        ref={inputRef}
        style={directorySearchLayout.input}
        value={value}
        aria-label={tr("搜索联系人")}
        placeholder={tr("搜索联系人")}
        autoComplete="off"
        onChange={event => { onChange(event.currentTarget.value) }}
        onKeyDown={event => {
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            onChange('')
          }
        }}
      />
      {value !== '' && <button data-arkme-feedback="neutral" type="button" aria-label={tr("清空搜索")} onClick={() => {
        onChange('')
        inputRef.current?.focus()
      }}><X size={14} aria-hidden /></button>}
    </div>
    {children}
  </div>
}
