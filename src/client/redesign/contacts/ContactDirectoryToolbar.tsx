import { useRef, type ReactNode } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { X } from '@phosphor-icons/react/dist/icons/X'

export function ContactDirectoryToolbar({ value, onChange, children }: {
  value: string
  onChange(value: string): void
  children?: ReactNode
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return <div className="arkme-contact-directory-toolbar" role="search" aria-label="搜索联系人目录">
    <div className="arkme-contact-directory-search-field">
      <MagnifyingGlass size={16} aria-hidden />
      <input
        ref={inputRef}
        value={value}
        aria-label="搜索联系人"
        placeholder="搜索联系人"
        autoComplete="off"
        onChange={event => { onChange(event.currentTarget.value) }}
        onKeyDown={event => {
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            onChange('')
          }
        }}
      />
      {value !== '' && <button type="button" aria-label="清空搜索" onClick={() => {
        onChange('')
        inputRef.current?.focus()
      }}><X size={14} aria-hidden /></button>}
    </div>
    {children}
  </div>
}
