import type { ComponentProps, ReactNode } from 'react'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { messageTextSelectionActions } from './message-text-selection-actions.js'
import { tr } from './locale.js'

/** A selected range always takes precedence over whole-message commands. */
export function ArkmeMessageContextMenu({ selectedText, copyIcon, onCopySelection, onCopyMessage, ...props }:
  Omit<ComponentProps<typeof ArkmeActionMenu>, 'label'> & {
    selectedText: string | undefined; copyIcon: ReactNode
    onCopySelection(text: string): void; onCopyMessage(): void
  }) {
  return <ArkmeActionMenu {...props} label={tr(selectedText === undefined ? '消息操作' : '选中文字操作')}
    actions={selectedText === undefined ? props.actions : messageTextSelectionActions(selectedText, copyIcon, onCopySelection, onCopyMessage)} />
}
