import type { ArkmeMyExtensionItem, ArkmeMyExtensionState, ArkmeMyExtensionWarning } from '../extensions/owned-types.js'

const STATE_LABELS: Record<ArkmeMyExtensionState, string> = {
  cordis: 'Cordis 临时',
  persisted: '已持久化',
  published: '已发布',
}

export function myExtensionBadges(states: readonly ArkmeMyExtensionState[]): string[] {
  return states.map(state => STATE_LABELS[state])
}

export function myExtensionPrimaryAction(item: ArkmeMyExtensionItem): { label: string; disabled: boolean } {
  if (item.publish.allowed) return { label: item.publish.mode === 'version' ? '发布新版本' : '发布', disabled: false }
  if (item.states.includes('published')) return { label: '已发布', disabled: true }
  return { label: '仅本地', disabled: true }
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
