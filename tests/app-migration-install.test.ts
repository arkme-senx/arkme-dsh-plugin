import { expect, test, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { openMigrationInstaller } from '../src/app-migration.js'
vi.mock('node:child_process',async original=>({
 ...await original<typeof import('node:child_process')>(),
 execFile:vi.fn((_file,_args,_options,callback)=>callback(null,'','')),
}))
test('macOS opens the package with Installer via system association without a shell',async()=>{
 await openMigrationInstaller('/Users/A/Downloads/即我.pkg','darwin')
 expect(execFile).toHaveBeenLastCalledWith('/usr/bin/open',['/Users/A/Downloads/即我.pkg'],expect.any(Object),expect.any(Function))
})
test('Windows uses ShellExecute and passes the package path as data, allowing UAC',async()=>{
 const path="C:\\Users\\A B\\Downloads\\即我'$(x).exe"
 await openMigrationInstaller(path,'win32')
 const [file,args,options]=vi.mocked(execFile).mock.calls.at(-1)! as unknown as [string,string[],{env:Record<string,string>}]
 expect(file).toBe('powershell.exe')
 expect(args.join(' ')).toContain('UseShellExecute = $true')
 expect(args.join(' ')).not.toContain(path)
 expect(options.env.ARKME_MIGRATION_INSTALLER_PATH).toBe(path)
 expect(args.join(' ')).not.toMatch(/-Wait|\/S\b/)
})
