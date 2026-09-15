import { act,create,type ReactTestRenderer } from 'react-test-renderer'
import {afterEach,describe,it,expect,vi} from 'vitest'
import {ArkmeRecordDeletionDialog} from '../src/client/ArkmeRecordDeletionDialog.js'
import {ArkmeConfirmDialog} from '../src/client/ArkmeConfirmDialog.js'
let view:ReactTestRenderer|undefined
afterEach(async()=>{await act(async()=>view?.unmount());view=undefined})
const result={items:[{recordUid:'a',version:2,result:'deleted' as const}]}
const props=()=>({sourceRef:'source',deletionRefs:['ref'],port:{delete:vi.fn(async(_sourceRef: string, _deletionRefs: readonly string[], _signal: AbortSignal)=>result)},onCancel:vi.fn(),onResult:vi.fn(),onRefresh:vi.fn()})
describe('record deletion confirmation',()=>{
 it('does not write until confirmed and leaves cancel harmless',async()=>{const p=props();await act(async()=>{view=create(<ArkmeRecordDeletionDialog {...p}/>)});expect(p.port.delete).not.toHaveBeenCalled();act(()=>view!.root.findByType(ArkmeConfirmDialog).props.onClose());expect(p.onCancel).toHaveBeenCalledOnce();expect(p.port.delete).not.toHaveBeenCalled()})
 it('prevents same-frame duplicate clicks',async()=>{const p=props();await act(async()=>{view=create(<ArkmeRecordDeletionDialog {...p}/>)});await act(async()=>{const confirm=view!.root.findByType(ArkmeConfirmDialog).props.onConfirm;confirm();confirm()});expect(p.port.delete).toHaveBeenCalledOnce();expect(p.onResult).toHaveBeenCalledWith(result)})
 it('blocks blind retry after unknown failure',async()=>{const p=props();p.port.delete.mockRejectedValue(new Error('网络中断'));await act(async()=>{view=create(<ArkmeRecordDeletionDialog {...p}/>)});await act(async()=>view!.root.findByType(ArkmeConfirmDialog).props.onConfirm());expect(p.onResult).not.toHaveBeenCalled();expect(view!.root.findByType(ArkmeConfirmDialog).props.confirmLabel).toBe('刷新核对');await act(async()=>view!.root.findByType(ArkmeConfirmDialog).props.onConfirm());expect(p.onRefresh).toHaveBeenCalledOnce();expect(p.port.delete).toHaveBeenCalledOnce()})
 it('ignores completion after unmount',async()=>{const p=props();let finish!:(r:typeof result)=>void;p.port.delete.mockImplementation(()=>new Promise(r=>{finish=r}));await act(async()=>{view=create(<ArkmeRecordDeletionDialog {...p}/>)});act(()=>view!.root.findByType(ArkmeConfirmDialog).props.onConfirm());await act(async()=>{view!.unmount();finish(result)});expect(p.onResult).not.toHaveBeenCalled()})
})


it('allows stopping a pending deletion and ignores its late completion', async () => {
 const p = props()
 let finish!: (value: typeof result) => void
 p.port.delete.mockImplementation(() => new Promise(resolve => { finish = resolve }))
 await act(async () => { view = create(<ArkmeRecordDeletionDialog {...p} />) })
 act(() => view!.root.findByType(ArkmeConfirmDialog).props.onConfirm())
 const dialog = view!.root.findByType(ArkmeConfirmDialog)
 const cancel = view!.root.findAllByType('button').find(button => button.children.includes('停止并退出'))
 expect(cancel).toBeDefined()
 expect(cancel!.props.disabled).toBe(false)
 act(() => dialog.props.onClose())
 expect(p.port.delete.mock.calls[0]?.[2].aborted).toBe(true)
 expect(p.onRefresh).toHaveBeenCalledOnce()
 await act(async () => { finish(result) })
 expect(p.onResult).not.toHaveBeenCalled()
 expect(p.port.delete).toHaveBeenCalledOnce()
})


it.each([false, true])('keeps busy close opt-in for shared dialogs (%s)', async closeWhileBusy => {
 const onClose = vi.fn()
 await act(async () => { view = create(<ArkmeConfirmDialog titleId="test" title="Test" description="Test"
  busy closeWhileBusy={closeWhileBusy} onClose={onClose} onConfirm={vi.fn()} confirmLabel="Confirm" busyLabel="Working" />) })
 const cancel = view!.root.findAllByType('button').find(button => button.children.includes('取消'))!
 expect(cancel.props.disabled).toBe(!closeWhileBusy)
 const target = {}
 act(() => view!.root.findByProps({ 'data-arkme-confirm-dialog-backdrop': 'true' }).props.onMouseDown({ target, currentTarget: target }))
 expect(onClose).toHaveBeenCalledTimes(closeWhileBusy ? 1 : 0)
 const confirm = view!.root.findAllByType('button').find(button => button.children.includes('Working'))!
 expect(confirm.props.disabled).toBe(true)
})
