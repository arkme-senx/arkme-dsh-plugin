// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { TeamMessageContent } from '../src/client/TeamMessageContent.js'
import { TeamAvatar } from '../src/client/TeamMessagingPanel.js'
import type { TeamMessage } from '../src/team-app-contract.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/ArkmeRichContent.js', () => ({ ArkmeMessageContent: ({ item }: { item: { textContent: string; contentBlocks: Array<{mediaRef:string}> } }) => <div data-content>{item.textContent}{item.contentBlocks.map(m => <img key={m.mediaRef} src={m.mediaRef} />)}</div> }))
let renderer: ReactTestRenderer | undefined
afterEach(async () => { await act(async () => { renderer?.unmount() }); mocks.call.mockReset() })
const message: TeamMessage = {key:'m', ref:'message',seq:1,revision:1,side:'team',sender:{nickname:'成员'},own:false,state:'published',createdAt:1,canEdit:false,canDelete:false,version:1,contentStatus:'available',content:{text_content:'图片说明',template_kind:2},media:[{ref:'encrypted-1',key:'asset-v1',url:'/authorized-image',name:'photo.png',mimeType:'image/png',size:10,kind:1}]}
it('preserves mounted content when timeline grants rotate; replaces it only for changed content', async () => {
  mocks.call.mockResolvedValue({ url: '/authorized-image' })
  await act(async () => { renderer = create(<TeamMessageContent message={message} />) })
  const image = renderer!.root.findByType('img')
  for (let i=0;i<3;i++) {
    await act(async () => { renderer!.update(<TeamMessageContent message={{...message,ref:`message-${i}`,revision:i+2,media:[{...message.media[0]!,ref:`rotated-${i}`} ]}} />) })
    expect(renderer!.root.findByType('img')).toBe(image)
    expect(renderer!.root.findAllByProps({role:'status'})).toHaveLength(0)
  }
  expect(mocks.call).not.toHaveBeenCalled()
  await act(async () => { renderer!.update(<TeamMessageContent message={{...message,version:2,media:[{...message.media[0]!,key:'asset-v2',ref:'updated',url:'/updated-image'}]}} />) })
  expect(renderer!.root.findByType('img').props.src).toBe('updated')
  expect(mocks.call).not.toHaveBeenCalled()
})
it('keeps avatars during receipt refresh but reloads an actual avatar change', async () => {
  mocks.call.mockResolvedValue({base64:'cGljdHVyZQ==',mimeType:'image/png'})
  await act(async () => { renderer=create(<TeamAvatar identity={{nickname:'成员',imageKey:'avatar1',imageRef:'ref1'}} />) })
  const image=renderer!.root.findByType('img')
  await act(async () => { renderer!.update(<TeamAvatar identity={{nickname:'成员',imageKey:'avatar1',imageRef:'ref2'}} />) })
  expect(renderer!.root.findByType('img')).toBe(image)
  expect(mocks.call).toHaveBeenCalledTimes(1)
  await act(async () => { renderer!.update(<TeamAvatar identity={{nickname:'成员',imageKey:'avatar2',imageRef:'ref3'}} />) })
  expect(mocks.call).toHaveBeenCalledTimes(2)
  await act(async () => { renderer!.update(<TeamAvatar identity={{nickname:'成员'}} />) })
  expect(renderer!.root.findAllByType('img')).toHaveLength(0)
})
