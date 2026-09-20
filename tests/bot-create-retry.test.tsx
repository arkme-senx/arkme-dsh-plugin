import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', async importOriginal => ({...await importOriginal<object>(), callArkme: mocks.callArkme}))
import { ArkmeBotCreateDialog } from '../src/client/ArkmeBotCreateDialog.js'
import { ArkmeClientError } from '../src/client/api.js'

let renderer: ReactTestRenderer | undefined
async function selectProvider(provider: string) {
  if (provider === 'webhook') await act(async () => {
    renderer!.root.findAll(node => node.props.provider === provider && typeof node.props.onSelect === 'function')[0]!.props.onSelect()
  })
}
afterEach(async () => { await act(async () => renderer?.unmount()); vi.unstubAllGlobals(); mocks.callArkme.mockReset() })

it.each(['openclaw', 'webhook'])('%s allows editing after login rejection before any create was sent', async provider => {
  mocks.callArkme.mockRejectedValue(new ArkmeClientError({code:'login-required', message:'请先登录', retryable:false}))
  await act(async () => { renderer = create(<ArkmeBotCreateDialog onClose={vi.fn()} />) })
  await selectProvider(provider)
  const rename = async (value: string) => { await act(async () => { renderer!.root.findByProps({placeholder:'给 Bot 起个名字'}).props.onChange({currentTarget:{value}}) }) }
  const submit = async () => { await act(async () => { renderer!.root.findAllByType('button').find(b => b.children.includes('创建 Bot'))!.props.onClick() }) }
  await rename('First'); await submit()
  await rename('Corrected'); await submit()
  expect(mocks.callArkme).toHaveBeenCalledTimes(2)
  expect(mocks.callArkme.mock.calls[1][1].name).toBe('Corrected')
})

it.each(['openclaw', 'webhook'])('%s keeps an earlier unknown request when its retry is rejected before send', async provider => {
  mocks.callArkme.mockRejectedValueOnce(new Error('结果未知')).mockRejectedValue(new ArkmeClientError({code:'login-required', message:'请先登录', retryable:false}))
  await act(async () => { renderer = create(<ArkmeBotCreateDialog onClose={vi.fn()} />) })
  await selectProvider(provider)
  const rename = async (value: string) => { await act(async () => { renderer!.root.findByProps({placeholder:'给 Bot 起个名字'}).props.onChange({currentTarget:{value}}) }) }
  const submit = async () => { await act(async () => { renderer!.root.findAllByType('button').find(b => b.children.includes('创建 Bot'))!.props.onClick() }) }
  await rename('First'); await submit(); await submit()
  await rename('Different'); await submit()
  expect(mocks.callArkme).toHaveBeenCalledTimes(2)
  expect(mocks.callArkme.mock.calls[1]).toEqual(mocks.callArkme.mock.calls[0])
})

it.each(['openclaw', 'webhook'])('%s reuses the same uploaded avatar and request after an uncertain create result', async provider => {
  let uploads = 0
  vi.stubGlobal('XMLHttpRequest', class {
    responseText = ''; onload?: () => void
    open() {}; setRequestHeader() {}
    send() { uploads++; this.responseText = JSON.stringify({ok:true,value:{fileAssetUid:`avatar-${uploads}`}}); this.onload?.() }
  })
  vi.stubGlobal('URL', {createObjectURL: () => 'blob:avatar', revokeObjectURL: vi.fn()})
  mocks.callArkme.mockRejectedValue(new Error('创建结果未知'))
  await act(async () => { renderer = create(<ArkmeBotCreateDialog onClose={vi.fn()} />) })
  await selectProvider(provider)
  await act(async () => { renderer!.root.findByProps({placeholder:'给 Bot 起个名字'}).props.onChange({currentTarget:{value:'Bot'}}) })
  await act(async () => { renderer!.root.findByProps({type:'file'}).props.onChange({currentTarget:{files:[{name:'a.png',type:'image/png',size:10}],value:''}}) })
  const submit = () => renderer!.root.findAllByType('button').find(b => b.children.includes('创建 Bot'))!
  await act(async () => { submit().props.onClick() })
  await act(async () => { submit().props.onClick() })
  expect(uploads).toBe(1)
  expect(mocks.callArkme).toHaveBeenCalledTimes(2)
  expect(mocks.callArkme.mock.calls[1]).toEqual(mocks.callArkme.mock.calls[0])
  await act(async () => { renderer!.root.findByProps({placeholder:'给 Bot 起个名字'}).props.onChange({currentTarget:{value:'Changed'}}) })
  await act(async () => { submit().props.onClick() })
  expect(mocks.callArkme).toHaveBeenCalledTimes(2)
  expect(renderer!.root.findByProps({role:'alert'}).children.join('')).toContain('确认')
})

it.each(['openclaw', 'webhook'])('%s prevents same-tick double submission while creation is pending', async provider => {
  let resolveCreate!: (value: unknown) => void
  mocks.callArkme.mockReturnValue(new Promise(resolve => { resolveCreate = resolve }))
  const onClose = vi.fn()
  await act(async () => { renderer = create(<ArkmeBotCreateDialog onClose={onClose} />) })
  await selectProvider(provider)
  await act(async () => { renderer!.root.findByProps({placeholder:'给 Bot 起个名字'}).props.onChange({currentTarget:{value:'Bot'}}) })
  const submit = renderer!.root.findAllByType('button').find(b => b.children.includes('创建 Bot'))!
  await act(async () => { submit.props.onClick(); submit.props.onClick() })
  expect(mocks.callArkme).toHaveBeenCalledTimes(1)
  await act(async () => { resolveCreate({name:'Bot'}) })
  expect(onClose).toHaveBeenCalledTimes(1)
})
