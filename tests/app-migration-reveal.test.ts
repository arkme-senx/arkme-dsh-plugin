import { EventEmitter } from 'node:events'
import { expect, test, vi, beforeEach } from 'vitest'
import { spawn } from 'node:child_process'
import { revealMigrationFile } from '../src/app-migration.js'
vi.mock('node:child_process',async original=>({
 ...await original<typeof import('node:child_process')>(),spawn:vi.fn(),
}))
beforeEach(()=>vi.clearAllMocks())
test('Windows reveals with a visible detached Explorer and does not await its exit',async()=>{
 const child=Object.assign(new EventEmitter(),{unref:vi.fn()})
 vi.mocked(spawn).mockImplementation((()=>{queueMicrotask(()=>child.emit('spawn'));return child}) as typeof spawn)
 const path='C:\\Users\\A B\\Downloads\\即我-3.0.0 (1).exe'
 await revealMigrationFile(path,'win32')
 expect(spawn).toHaveBeenCalledWith('explorer.exe',[`/select,${path}`],{windowsHide:false,detached:true,stdio:'ignore'})
 expect(child.unref).toHaveBeenCalledOnce()
})
test('Windows launch errors remain retryable rather than reporting success',async()=>{
 const child=Object.assign(new EventEmitter(),{unref:vi.fn()})
 vi.mocked(spawn).mockImplementation((()=>{queueMicrotask(()=>child.emit('error',new Error('launch failed')));return child}) as typeof spawn)
 await expect(revealMigrationFile('C:\\Downloads\\app.exe','win32')).rejects.toThrow('launch failed')
 expect(child.unref).not.toHaveBeenCalled()
})
