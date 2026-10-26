import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { useArkoImageDraft, ArkoImageDraftStrip } from '../src/client/ArkoImageAttachments.js'
import { prepareComposerAttachments } from '../src/client/attachment-preparation.js'
import { arkmeComposerDraftStore, arkmeArkoComposerDraftKey, arkmeSourceComposerDraftKey } from '../src/client/composer-draft-store.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import '../src/client/composer-draft-auth-binding.js'
import type { ArkmeLocalFile } from '../src/file-transfer-contract.js'
const mocks = vi.hoisted(() => ({ stage: vi.fn(), remove: vi.fn(async () => {}) }))
vi.mock('../src/sdk/index.js', () => ({ createArkmeSdk: () => ({
  fileCapabilities: async () => ({version:1,maxAttachments:9,maxImageBytes:1024,maxFileBytes:1024}),
  stageFile: mocks.stage, removeLocalFile: mocks.remove,
}) }))
const image = () => new File(['image'], 'fixture.png', {type:'image/png'})
const local = (): ArkmeLocalFile => ({fileRef:`arkme-file-v1.${crypto.randomUUID()}`,fileName:'fixture.png',fileKind:1,mimeType:'image/png',size:5})
const userId = 91322, key = arkmeArkoComposerDraftKey(userId)!
function View() {
  const draft = useArkoImageDraft(userId,key,()=>{})
  return <><button onClick={()=>draft.add([image()])}>添加</button><span role="status">{draft.preparing}</span>
    <ArkoImageDraftStrip attachments={arkmeComposerDraftStore.get(key).attachments} draftKey={key} disabled={false}/></>
}
afterEach(()=>{arkmeAuthStore.setAuth({status:'logged-out',environment:'test'});arkmeComposerDraftStore.clearAccount(userId);mocks.stage.mockReset()})
it('Arko shows attachments before preparation, accepts another batch, and keeps the original draft across navigation', async()=>{
  arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId})
  let finish!: (file:ArkmeLocalFile)=>void
  mocks.stage.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve})).mockImplementation(async()=>local())
  let view!: ReactTestRenderer
  await act(async()=>{view=create(<View/>)})
  await act(async()=>view.root.findAllByType('button')[0]!.props.onClick())
  expect(view.root.findAllByProps({role:'listitem'})).toHaveLength(1)
  expect(view.root.findAllByProps({role:'status'}).map(node=>node.children.join('')).join('')).toContain('准备')
  expect(view.root.findAllByType('button')[0]!.props.disabled).not.toBe(true)
  await act(async()=>view.root.findAllByType('button')[0]!.props.onClick())
  expect(view.root.findAllByProps({role:'listitem'})).toHaveLength(2)
  await act(async()=>view.unmount())
  await act(async()=>finish(local()))
  await vi.waitFor(()=>expect(arkmeComposerDraftStore.get(key).attachments.every(i=>i.localFile)).toBe(true))
  await act(async()=>{view=create(<View/>)})
  expect(view.root.findAllByProps({role:'listitem'})).toHaveLength(2)
  expect(view.root.findAllByProps({role:'status'})[0]!.children.join('')).toBe('')
  await act(async()=>view.unmount())
})
it('ordinary conversation files remain with their captured conversation when another draft is active', async()=>{
  arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId})
  const a=arkmeSourceComposerDraftKey(userId,{kind:'private_chat',sourceRef:'a'})!
  const b=arkmeSourceComposerDraftKey(userId,{kind:'group_chat',sourceRef:'b'})!
  let finish!: (file:ArkmeLocalFile)=>void
  mocks.stage.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  prepareComposerAttachments(a,userId,[image()])
  expect(arkmeComposerDraftStore.get(a).attachments[0]!.preparation).toBeDefined()
  arkmeComposerDraftStore.setText(b,'新对话的输入')
  await vi.waitFor(()=>expect(mocks.stage).toHaveBeenCalledOnce())
  finish(local())
  await vi.waitFor(()=>expect(arkmeComposerDraftStore.get(a).attachments[0]!.localFile).toBeDefined())
  expect(arkmeComposerDraftStore.get(b)).toMatchObject({text:'新对话的输入',attachments:[]})
})
