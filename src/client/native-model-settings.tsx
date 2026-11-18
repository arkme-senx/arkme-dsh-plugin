import { useLayoutEffect, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { HARNESS_MODELS_SETTINGS_QUERY, HARNESS_MODELS_SETTINGS_CLOSE } from '../harness-embed-contract.js'

export function nativeModelSettingsRequested(): boolean {
  return new URLSearchParams(window.location.search).get(HARNESS_MODELS_SETTINGS_QUERY) === '1'
}

/** This document omits only the native settings shell. Its model feature,
 * stores, provider cards and credential operations remain native owners. */
export function installNativeModelSettings(ctx: Context): () => void {
  const onEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]')) return
    const accountScope = window.frameElement?.getAttribute('data-arkme-account-scope')
    if (!accountScope || window.parent === window) return
    event.preventDefault(); event.stopPropagation()
    window.parent.document.dispatchEvent(new CustomEvent(HARNESS_MODELS_SETTINGS_CLOSE, { detail: { accountScope } }))
  }
  document.addEventListener('keydown', onEscape)
  function NativeModels({ renderSlot }: PropsRenderSlots<'settings.section'>) {
    useLayoutEffect(() => {
      const root = document.getElementById('root')
      if (!root) return
      const wasInert = root.inert
      root.inert = true
      return () => { root.inert = wasInert }
    }, [])
    const version = useSyncExternalStore(fn => ctx.slots.subscribe('settings.section', fn), () => ctx.slots.getVersion('settings.section'))
    return createPortal(<section aria-label={ctx.locale.getSnapshot().active === 'en' ? 'Custom models' : '自提供模型'} data-arkme-native-model-settings="" data-version={version}
      style={{ position: 'fixed', inset: 0, zIndex: 100, overflow: 'auto', overscrollBehavior: 'contain', pointerEvents: 'auto', padding: '4px 0 16px', boxSizing: 'border-box', background: 'var(--dsw-alias-bg-layer-2, #fff)', color: 'var(--dsw-alias-label-primary, #17191c)' }}>
      {renderSlot('settings.section', { close: () => {} }, { only: 'models', fallback: <p role="status">{ctx.locale.getSnapshot().active === 'en' ? 'Loading model settings…' : '正在加载模型设置…'}</p> })}
    </section>, document.body)
  }
  const stop = ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'arkme-native-model-settings', order: 100,
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  }, NativeModels))
  return () => { document.removeEventListener('keydown', onEscape); stop() }
}
