// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { TeamConversationPane } from '../src/client/TeamMessagingPanel.js'
import type { TeamConversation } from '../src/team-app-contract.js'
const mocks = vi.hoisted(() => ({ call: vi.fn(), stage: vi.fn(), policy: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/sdk/index.js', () => ({ createArkmeSdk: () => ({fileCapabilities:mocks.policy,stageFile:mocks.stage,localFileUrl:(ref:string)=>`/local/${ref}`}) }))
const conversation: TeamConversation = {ref:'conv',key:'key',channel:{teamRef:'team',name:'团队',jotmoId:'fixture',publicRef:'a'.repeat(32),link:'',enabled:true,revision:1,canManage:false},side:'external',lastSeq:0,latestTeamReplySeq:0,myReadSeq:0,unread:0,needsReply:false,blocked:false,revision:1,updatedAt:1}
let host: HTMLDivElement, root: Root, finish: (value?: unknown) => void, fail: (e: Error) => void
const local = {fileRef:'local-image',fileName:'image.png',mimeType:'image/png',fileKind:1,size:10}
const editor = () => host.querySelector<HTMLElement>('[data-arkme-rich-composer]')!
const key = async (init: KeyboardEventInit) => act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,...init})) })
const file = new File(['image'],'image.png',{type:'image/png'})
async function paste(itemsOnly = false) {
  await act(async () => {
    editor().focus()
    const event = new Event('paste',{bubbles:true,cancelable:true})
    Object.defineProperty(event,'clipboardData',{value:{files:itemsOnly?[]:[file],items:itemsOnly?[{kind:'file',getAsFile:()=>file}]:[],getData:()=>''}})
    editor().dispatchEvent(event)
  })
  await act(async () => editor().blur()) // browsers blur disabled contenteditable
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  localStorage.clear(); mocks.call.mockReset(); mocks.stage.mockReset()
  mocks.policy.mockReset().mockResolvedValue({maxAttachments:9,maxImageBytes:1024,maxFileBytes:2048})
  mocks.stage.mockImplementation(()=>new Promise((resolve,reject)=>{finish=resolve;fail=reject}))
  mocks.call.mockImplementation(async (op:string, params:any)=>op==='team.app.timeline'?{conversation,messages:[],hasMore:false,beforeSeq:0}
    :op==='team.app.send.enqueue'?{...params,taskRef:'task',conversationKey:'key',createdAtMillis:Date.now(),state:'queued',files:[local],attempts:0,nextAttemptAt:0}:[])
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
  await act(async()=>root.render(<><button data-outside>其他位置</button><TeamConversationPane conversation={conversation} accountKey="test:7777" onChanged={()=>{}} /></>))
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
it.each([false,true])('pasted image restores focus then plain Enter sends once (itemsOnly=%s)',async itemsOnly=>{
  await paste(itemsOnly)
  expect(editor().getAttribute('contenteditable')).toBe('false')
  expect(host.querySelector('button[aria-label="添加内容"] [role=progressbar]')).not.toBeNull()
  expect(host.textContent).not.toContain('正在准备附件')
  await act(async()=>finish(local))
  expect(document.activeElement).toBe(editor())
  await key({key:'Enter',isComposing:true})
  await key({key:'Enter',shiftKey:true})
  expect(mocks.call.mock.calls.filter(([op])=>op==='team.app.send.enqueue')).toHaveLength(0)
  await key({key:'Enter'})
  expect(mocks.call.mock.calls.filter(([op])=>op==='team.app.send.enqueue')).toHaveLength(1)
  expect(mocks.call.mock.calls.find(([op])=>op==='team.app.send.enqueue')![1].fileRefs).toEqual(['local-image'])
  expect(editor().getAttribute('contenteditable')).toBe('true')
})
it('restores focus on staging failure and keeps the next paste usable',async()=>{
  await paste();await act(async()=>fail(new Error('图片准备失败')))
  expect(document.activeElement).toBe(editor())
  expect(host.textContent).toContain('图片准备失败')
  await paste();await act(async()=>finish(local))
  expect(host.textContent).not.toContain('图片准备失败')
  await key({key:'Enter'});expect(mocks.call.mock.calls.filter(([op])=>op==='team.app.send.enqueue')).toHaveLength(1)
})
it.each(['pointer','tab','unmount'])('does not steal focus after %s during preparation',async action=>{
  await paste()
  const outside=host.querySelector<HTMLButtonElement>('[data-outside]')!
  await act(async()=>{
    if(action==='pointer') outside.dispatchEvent(new Event('pointerdown',{bubbles:true}))
    if(action==='tab') document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}))
    outside.focus()
    if(action==='unmount') root.render(<button data-new>新会话</button>)
  })
  await act(async()=>finish(local))
  expect(document.activeElement).not.toBe(editor())
  expect(mocks.call.mock.calls.some(([op])=>op==='team.app.send.enqueue')).toBe(false)
})
it('file picker and drag/drop restore the editor for keyboard sending',async()=>{
  const input=host.querySelector<HTMLInputElement>('input[type=file]')!
  Object.defineProperty(input,'files',{configurable:true,value:[file]})
  await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})))
  await act(async()=>{editor().blur();finish(local)})
  expect(document.activeElement).toBe(editor())
  await key({key:'Enter'});
  const drop=new Event('drop',{bubbles:true,cancelable:true})
  Object.defineProperty(drop,'dataTransfer',{value:{files:[file],types:['Files']}})
  await act(async()=>host.querySelector('[data-team-composer]')!.dispatchEvent(drop))
  await act(async()=>{editor().blur();finish({...local,fileRef:'second-image'})})
  expect(document.activeElement).toBe(editor())
  expect(mocks.stage).toHaveBeenCalledTimes(2)
})
it('keeps valid files after a failed selection and applies the actual attachment limit',async()=>{
  mocks.policy.mockResolvedValue({maxAttachments:2,maxImageBytes:1024,maxFileBytes:2048})
  mocks.stage.mockImplementation(async (selected:File)=>{
    if(selected.name==='bad.png') throw new Error('图片无法读取')
    return {...local,fileRef:selected.name,fileName:selected.name}
  })
  const files=[new File([],'empty.png',{type:'image/png'}),new File([new Uint8Array(1025)],'large.png',{type:'image/png'}),
    ...['bad.png','one.png','two.png','three.png'].map(name=>new File(['image'],name,{type:'image/png'}))]
  const drop=new Event('drop',{bubbles:true,cancelable:true})
  Object.defineProperty(drop,'dataTransfer',{value:{files,types:['Files']}})
  await act(async()=>host.querySelector('[data-team-composer]')!.dispatchEvent(drop))
  expect(mocks.stage.mock.calls.map(([selected])=>selected.name)).toEqual(['bad.png','one.png','two.png'])
  expect(host.textContent).toContain('bad.png：图片无法读取')
  expect(host.textContent).toContain('最多添加 2 个附件：three.png')
  expect(document.activeElement).toBe(editor())
  await key({key:'Enter'})
  expect(mocks.call.mock.calls.find(([op])=>op==='team.app.send.enqueue')![1].fileRefs).toEqual(['one.png','two.png'])
})
it('does not stage a duplicated drop while the first preparation is pending',async()=>{
  const drop=()=>{
    const event=new Event('drop',{bubbles:true,cancelable:true})
    Object.defineProperty(event,'dataTransfer',{value:{files:[file],types:['Files']}})
    host.querySelector('[data-team-composer]')!.dispatchEvent(event)
  }
  await act(async()=>{drop();drop()})
  expect(mocks.stage).toHaveBeenCalledTimes(1)
  await act(async()=>finish(local))
  await key({key:'Enter'})
  expect(mocks.call.mock.calls.find(([op])=>op==='team.app.send.enqueue')![1].fileRefs).toEqual(['local-image'])
})
it('uses the shared attachment preview and sends the retained files in the chosen order',async()=>{
  mocks.stage.mockImplementation(async (selected:File)=>({...local,fileRef:selected.name,fileName:selected.name}))
  const input=host.querySelector<HTMLInputElement>('input[type=file]')!
  Object.defineProperty(input,'files',{configurable:true,value:['one.png','two.png','three.png'].map(name=>new File(['image'],name,{type:'image/png'}))})
  await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})))
  await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="预览 one.png"]')!.click())
  expect(document.querySelector<HTMLImageElement>('[data-arkme-image-preview-viewport] img')?.getAttribute('src')).toBe('/local/one.png')
  await act(async()=>document.querySelector<HTMLButtonElement>('button[aria-label="关闭预览"]')!.click())
  expect(document.querySelector('[data-arkme-image-preview-viewport]')).toBeNull()
  await act(async()=>host.querySelector('[role=listitem]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',altKey:true,bubbles:true,cancelable:true})))
  expect(Array.from(host.querySelectorAll('[role=listitem]')).map(node=>node.getAttribute('aria-label'))).toEqual(['two.png，第 1 个附件','one.png，第 2 个附件','three.png，第 3 个附件'])
  await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="移除three.png"]')!.click())
  await act(async()=>editor().focus())
  await key({key:'Enter'})
  expect(mocks.call.mock.calls.find(([op])=>op==='team.app.send.enqueue')![1].fileRefs).toEqual(['two.png','one.png'])
})

async function pasteEmojiText(text: string) {
  await act(async () => {
    editor().focus()
    const event = new Event('paste', {bubbles:true,cancelable:true})
    Object.defineProperty(event,'clipboardData',{value:{files:[],items:[],getData:(type:string)=>type==='text/plain'?text:''}})
    editor().dispatchEvent(event)
  })
}
it('selected and pasted emoji render as images and preserve semantic tokens',async()=>{
  Range.prototype.getBoundingClientRect = () => new DOMRect(20,100,1,21)
  Range.prototype.getClientRects = () => ({length:0,item:()=>null}) as unknown as DOMRectList
  await act(async()=>editor().focus())
  await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="选择表情"]')!.click())
  await act(async()=>document.querySelector<HTMLButtonElement>('[data-arkme-emoji-grid="default"] [data-arkme-emoji-id="smiling_face"]')!.click())
  expect(editor().querySelector('[data-arkme-editable-emoji="smiling_face"] img')?.getAttribute('src')).toBeTruthy()
  await act(async()=>{
    const range=document.createRange();range.selectNodeContents(editor());range.collapse(false)
    document.getSelection()!.removeAllRanges();document.getSelection()!.addRange(range)
  })
  await pasteEmojiText(' [im_emoji:yummy_face] [jm_emoji:thumb_up]👍🏽[jm_emoji:unknown]')
  expect(Array.from(editor().querySelectorAll('[data-arkme-editable-emoji]')).map(node=>node.getAttribute('data-arkme-editable-emoji'))).toEqual(['smiling_face','yummy_face','thumb_up'])
  expect(editor().querySelectorAll('[data-arkme-editable-emoji] img')).toHaveLength(3)
  expect(editor().textContent).toContain('👍🏽[jm_emoji:unknown]')
  await key({key:'Enter'})
  expect(mocks.call.mock.calls.find(([op])=>op==='team.app.send.enqueue')![1].content.text_content).toBe('[jm_emoji:smiling_face] [im_emoji:yummy_face] [jm_emoji:thumb_up]👍🏽[jm_emoji:unknown]')
})
it('native deletion of the first adjacent emoji preserves the second identity',async()=>{
  await pasteEmojiText('[jm_emoji:yummy_face][jm_emoji:thumb_up]')
  await act(async()=>{
    editor().querySelector('[data-arkme-editable-emoji="yummy_face"]')!.remove()
    const range=document.createRange();range.selectNodeContents(editor());range.collapse(true)
    document.getSelection()!.removeAllRanges();document.getSelection()!.addRange(range)
    editor().dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward'}))
  })
  expect(editor().querySelector('[data-arkme-editable-emoji]')?.getAttribute('data-arkme-editable-emoji')).toBe('thumb_up')
  await key({key:'Enter'})
  expect(mocks.call.mock.calls.find(([op])=>op==='team.app.send.enqueue')![1].content.text_content).toBe('[jm_emoji:thumb_up]')
})
