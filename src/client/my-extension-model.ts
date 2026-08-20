import type { ArkmeMyExtensionItem, ArkmeMyExtensionState, ArkmeMyExtensionWarning } from '../extensions/owned-types.js'

const STATE_LABELS: Record<ArkmeMyExtensionState, string> = {
  cordis: 'Cordis 临时',
  persisted: '已持久化',
  published: '已发布',
}

export function myExtensionBadges(states: readonly ArkmeMyExtensionState[]): string[] {
  return states.map(state => STATE_LABELS[state])
}

export function myExtensionPrimaryAction(item: ArkmeMyExtensionItem):
  | { kind: 'publish'; label: '发布' }
  | { kind: 'edit'; label: '编辑' }
  | undefined {
  if (item.states.includes('published')) return { kind: 'edit', label: '编辑' }
  if (!item.publish.allowed) return undefined
  return { kind: 'publish', label: '发布' }
}

export function myExtensionWarningText(warnings: readonly ArkmeMyExtensionWarning[]): string {
  return warnings.length === 0 ? '' : '部分扩展状态暂不可用，本地可确认的扩展仍已显示。'
}

export interface ExtensionPublishMutation {
  key: string
  id: string
}

export function nextExtensionPublishMutation(
  current: ExtensionPublishMutation | undefined,
  ownedRef: string,
  version: string,
  mint: () => string,
): ExtensionPublishMutation {
  const key = `${ownedRef}\0${version.trim()}`
  return current?.key === key ? current : { key, id: mint() }
}
