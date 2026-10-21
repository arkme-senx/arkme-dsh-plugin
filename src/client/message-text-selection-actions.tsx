import type { ReactNode } from 'react'
import type { ArkmeMenuAction } from './ArkmeDshMenu.js'
import { tr } from './locale.js'

export function messageTextSelectionActions(
  text: string,
  icon: ReactNode,
  copySelection: (text: string) => void,
  copyMessage: () => void,
): ArkmeMenuAction[] {
  return [
    { id: 'copy-selection', label: tr('复制选中文字'), icon, onSelect: () => copySelection(text) },
    { type: 'separator', id: 'copy-whole-divider' },
    { id: 'copy-whole', label: tr('复制整条消息'), icon, onSelect: copyMessage },
  ]
}
