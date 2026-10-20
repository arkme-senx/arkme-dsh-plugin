import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, test, vi } from 'vitest'
import { AppMigrationDialog } from '../src/client/AppMigrationDialog.js'
import { appMigrationStore } from '../src/client/app-migration-store.js'
import type { MigrationSnapshot } from '../src/app-migration-shared.js'
afterEach(()=>vi.restoreAllMocks())
test.each(['available','downloading','completed','failed'] as const)('renders confirmed %s state',phase=>{
 const status: MigrationSnapshot={phase,currentVersion:'0.3.3',downloadedBytes:5,totalBytes:10,prompt:true,target:{version:'3.0.0',versionCode:277,downloadUrl:'https://d.jiwo.cc/app.pkg',kind:'pkg'}}
 vi.spyOn(appMigrationStore,'getSnapshot').mockReturnValue({status,visible:true,busy:false,error:''})
 const markup=renderToStaticMarkup(<AppMigrationDialog />)
 const expected={available:'下载安装包',downloading:'50%',completed:'开始安装',failed:'重试'}
 expect(markup).toContain(expected[phase]);expect(markup).toContain('role="dialog"')
 expect(markup).not.toContain('重启并安装');expect(markup).not.toContain('请先完成同步')
 expect(markup).not.toContain('正在校验安装包')
})

test('unknown response length displays bytes and indeterminate progress',()=>{
 const status:MigrationSnapshot={phase:'downloading',currentVersion:'0.3.3',downloadedBytes:1048576,prompt:true}
 vi.spyOn(appMigrationStore,'getSnapshot').mockReturnValue({status,visible:true,busy:false,error:''})
 const markup=renderToStaticMarkup(<AppMigrationDialog />)
 expect(markup).toContain('已下载 1.0 MB')
 expect(markup).not.toMatch(/<progress[^>]*value=/)
 expect(markup).not.toContain('NaN')
})
