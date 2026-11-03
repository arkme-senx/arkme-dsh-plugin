// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { ArkmeDeletedArrangementItem } from '../src/types.js'
const mocks=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.call}))
vi.mock('../src/client/ArkmeConfirmDialog.js',()=>({ArkmeConfirmDialog:(props:any)=><div data-dialog><div>{props.description}</div><span>{props.error}</span><button onClick={props.onConfirm} disabled={props.busy}>{props.confirmLabel}</button><button onClick={props.onClose}>cancel</button></div>}))
import { ArkmeArrangementRestore } from '../src/client/ArkmeArrangementRestore.js'
const item:ArkmeDeletedArrangementItem={arrangementRef:'opaque',title:'恢复测试',description:'',status:'deleted',createdAtMillis:1,updatedAtMillis:10,reminderEnabled:false,reminderState:'cancelled',dueAtMillis:100,restore:{expectedVersion:10,targetStatus:'completed',historicalFallback:false}}
let root:ReactTestRenderer|undefined
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve()}
const click=async(text:string)=>{await act(async()=>{root!.root.findAllByType('button').filter(b=>b.children.join('')===text).at(-1)!.props.onClick();await tick()})}
beforeEach(()=>mocks.call.mockReset())
afterEach(()=>{act(()=>root?.unmount());root=undefined})
it('confirms previous state, unchanged date and reminders off before any write',async()=>{
 const restored=vi.fn()
 await act(async()=>{root=create(<ArkmeArrangementRestore item={item} disabled={false} onRestored={restored} onRefresh={()=>{}} />)})
 await click('恢复安排')
 expect(mocks.call).not.toHaveBeenCalled()
 expect(JSON.stringify(root!.toJSON())).toContain('已完成')
 expect(JSON.stringify(root!.toJSON())).toContain('安排时间保持不变')
 expect(JSON.stringify(root!.toJSON())).toContain('提醒默认关闭')
 mocks.call.mockResolvedValue({state:'completed',item:{...item,status:'completed'}})
 await click('确认恢复')
 expect(mocks.call).toHaveBeenCalledWith('arrangements.restore',expect.objectContaining({arrangementRef:'opaque',expectedVersion:10,requestId:expect.any(String)}),expect.any(AbortSignal))
 expect(restored).toHaveBeenCalledOnce()
})
it('keeps the request identity and only queries after an uncertain result, including dialog close/reopen',async()=>{
 await act(async()=>{root=create(<ArkmeArrangementRestore item={{...item,restore:{...item.restore!,historicalFallback:true}}} disabled={false} onRestored={()=>{}} onRefresh={()=>{}} />)})
 await click('恢复安排')
 expect(JSON.stringify(root!.toJSON())).toContain('历史记录未保存删除前状态')
 mocks.call.mockResolvedValue({state:'unknown'})
 await click('确认恢复')
 const request=mocks.call.mock.calls[0]![1]
 await click('cancel')
 await click('查询恢复结果')
 await click('查询恢复结果')
 expect(mocks.call.mock.calls.at(-1)!.slice(0,2)).toEqual(['arrangements.restore.result',request])
 expect(mocks.call.mock.calls.filter(c=>c[0]==='arrangements.restore')).toHaveLength(1)
})
it('does not offer an active restore command on old deployments or while fresh detail is loading',async()=>{
 const {restore:_,...old}=item
 await act(async()=>{root=create(<ArkmeArrangementRestore item={old} disabled={false} onRestored={()=>{}} onRefresh={()=>{}} />)})
 expect(root!.root.findByType('button').props.disabled).toBe(true)
 expect(JSON.stringify(root!.toJSON())).toContain('当前服务暂不支持恢复')
 await act(async()=>{root!.update(<ArkmeArrangementRestore item={item} disabled onRestored={()=>{}} onRefresh={()=>{}} />)})
 expect(root!.root.findByType('button').props.disabled).toBe(true)
})
