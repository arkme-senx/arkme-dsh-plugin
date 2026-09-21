// @vitest-environment jsdom
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {ArkmeScreenshotShortcutSetting} from '../src/client/ArkmeScreenshotShortcutSetting.js'
let root:Root,host:HTMLDivElement
const bridge={get:vi.fn(),record:vi.fn(),set:vi.fn(),onChanged:vi.fn(()=>()=>{}),onTrigger:vi.fn(()=>()=>{})}
beforeEach(async()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('arkmeScreenshotShortcut',bridge);HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};bridge.get.mockResolvedValue({accelerator:'Command+Shift+A',available:true});bridge.record.mockResolvedValue(true);bridge.set.mockResolvedValue({accelerator:'Control+Alt+B',available:true});host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(<ArkmeScreenshotShortcutSetting/>))})
afterEach(()=>{act(()=>root.unmount());host.remove();vi.clearAllMocks();vi.unstubAllGlobals()})
async function open(){await act(async()=>host.querySelector('button')!.click())}
async function key(){await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'b',code:'KeyB',ctrlKey:true,altKey:true,bubbles:true,cancelable:true})))}
it('displays existing combination, previews recording and saves only on confirm',async()=>{await open();expect(document.querySelector('dialog')!.textContent).toContain('⌘');await key();expect(document.querySelector('dialog')!.textContent).toContain('Ctrl');expect(bridge.set).not.toHaveBeenCalled();await act(async()=>document.querySelectorAll<HTMLButtonElement>('dialog button')[1]!.click());expect(bridge.set).toHaveBeenCalledWith('Control+Alt+B');expect(document.querySelector('dialog')).toBeNull();expect(bridge.record).toHaveBeenLastCalledWith(false)})
it('cancel discards draft and restores shortcut registration',async()=>{await open();await key();await act(async()=>document.querySelector<HTMLButtonElement>('dialog button')!.click());expect(bridge.set).not.toHaveBeenCalled();expect(bridge.record).toHaveBeenLastCalledWith(false)})
it('keeps dialog and draft on conflict',async()=>{bridge.set.mockRejectedValueOnce(Error('该快捷键已被占用'));await open();await key();await act(async()=>document.querySelectorAll<HTMLButtonElement>('dialog button')[1]!.click());expect(document.querySelector('[role=alert]')!.textContent).toContain('占用');expect(document.querySelector('dialog')).not.toBeNull()})
