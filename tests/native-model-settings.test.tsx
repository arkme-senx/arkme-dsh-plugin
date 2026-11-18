// @vitest-environment jsdom
import { act, type ComponentType, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { installNativeModelSettings } from '../src/client/native-model-settings.js'
let root: Root, host: HTMLDivElement, stop: (()=>void) | undefined
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host=document.createElement('div'); host.id='root'; document.body.append(host); root=createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); stop?.(); stop=undefined; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('renders the existing models slot with its owner intact, keeping background UI inert and restoring it on unmount', async () => {
  let Component!: ComponentType<PropsRenderSlots<'settings.section'>>
  const dispose=vi.fn(), renderSlot=vi.fn((_key: string, _owner: unknown, _opts: unknown): ReactNode=><button>原生提供商配置</button>)
  const ctx={locale:{getSnapshot:()=>({active:'zh'})},slots:{
    inject:(_key:string,register:()=>()=>void)=>register(),
    register:vi.fn((_options:unknown,component:typeof Component)=>{Component=component;return dispose}),
    subscribe:()=>()=>{},getVersion:()=>1,
  }}
  stop=installNativeModelSettings(ctx as unknown as Context)
  await act(async () => root.render(<Component renderSlot={renderSlot}/>))
  expect(renderSlot).toHaveBeenCalledWith('settings.section',expect.objectContaining({close:expect.any(Function)}),expect.objectContaining({only:'models'}))
  expect(ctx.slots.register.mock.calls[0]?.[0]).toMatchObject({children:{'settings.section':{kind:'list',scope:'root'}}})
  const content=document.querySelector('[data-arkme-native-model-settings]')!
  expect(host.contains(content)).toBe(false)
  expect(host.inert).toBe(true)
  await act(async () => root.render(null))
  expect(host.inert).toBeUndefined()
  stop(); stop=undefined; expect(dispose).toHaveBeenCalledOnce()
})
it('delegates Escape to the parent account-bound settings, while native confirmation dialogs retain Escape ownership', () => {
  const frame=document.createElement('iframe'); frame.setAttribute('data-arkme-account-scope','prod:11')
  vi.spyOn(window,'frameElement','get').mockReturnValue(frame)
  vi.spyOn(window,'parent','get').mockReturnValue({document} as unknown as Window)
  const close=vi.fn(); document.addEventListener('arkme:models-settings-close',close)
  stop=installNativeModelSettings({slots:{inject:()=>()=>{}}} as unknown as Context)
  const dialog=document.createElement('div'); dialog.setAttribute('role','dialog'); dialog.setAttribute('aria-modal','true'); document.body.append(dialog)
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))
  expect(close).not.toHaveBeenCalled()
  dialog.remove()
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))
  expect((close.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({accountScope:'prod:11'})
  stop(); stop=undefined
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))
  expect(close).toHaveBeenCalledOnce()
  document.removeEventListener('arkme:models-settings-close',close)
})
