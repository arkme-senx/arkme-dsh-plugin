import {afterEach,expect,test,vi} from 'vitest'
import {resolveHostPolicy,assertHostCapability} from '../src/host-policy.js'
import {ArkmeExtensionManager} from '../src/extensions/manager.js'
import {ArkmeExtensionInstallTasks} from '../src/extensions/install-tasks.js'
import {ArkmeExtensionProfileInstaller} from '../src/extensions/profile-installer.js'
import {ExtensionPublishClient} from '../src/extensions/publish-client.js'
import {ArkmePluginUpdateManager} from '../src/plugin-update.js'
import {AppMigrationManager} from '../src/app-migration.js'
import {runPluginUpdater} from '../src/plugin-updater-helper.js'
const mas={schemaVersion:1,distribution:'mas',capabilities:{clientSelfUpdate:false,runtimeSelfUpdate:false,executableExtensionInstall:false},credentialServicePrefix:'com.senqisi.dsh-arkme.mas'}
afterEach(()=>vi.unstubAllEnvs())
test('old hosts keep website abilities and credential naming',()=>{
 const policy=resolveHostPolicy({});expect(policy.distribution).toBe('website');expect(Object.values(policy.capabilities)).toEqual([true,true,true]);expect(policy.credentialServicePrefix).toBeUndefined()
})
test('explicit website configuration preserves default abilities',()=>{
 const policy={schemaVersion:1,distribution:'website',capabilities:{clientSelfUpdate:true,runtimeSelfUpdate:true,executableExtensionInstall:true}}
 expect(resolveHostPolicy({ARKME_HOST_POLICY:JSON.stringify(policy)})).toEqual(policy)
})
test('invalid and permissive MAS policies fail closed',()=>{
 for(const raw of ['', 'null','{}', JSON.stringify({...mas,capabilities:{...mas.capabilities,runtimeSelfUpdate:true}}),JSON.stringify({...mas,credentialServicePrefix:'website'})])expect(()=>resolveHostPolicy({ARKME_HOST_POLICY:raw})).toThrow('ARKME_HOST_POLICY_INVALID')
})
test('MAS denies real mutation entrypoints before touching filesystem, credentials or network',async()=>{
 vi.stubEnv('ARKME_HOST_POLICY',JSON.stringify(mas))
 const cases:[object,string][]=[
  [ArkmeExtensionManager.prototype,'apply'],[ArkmeExtensionManager.prototype,'setEnabled'],
  [ArkmeExtensionManager.prototype,'applyLegacyV1'],[ArkmeExtensionManager.prototype,'applyBundleV2'],[ArkmeExtensionManager.prototype,'applyNativeBundleV3'],
  [ArkmeExtensionProfileInstaller.prototype,'install'],[ArkmeExtensionProfileInstaller.prototype,'installTarball'],[ArkmeExtensionProfileInstaller.prototype,'run'],[ArkmeExtensionProfileInstaller.prototype,'setEnabled'],
  [ExtensionPublishClient.prototype,'downloadArtifact'],[ArkmePluginUpdateManager.prototype,'install'],[ArkmePluginUpdateManager.prototype,'installOnce'],[ArkmePluginUpdateManager.prototype,'installSupervisedProfilePlugin'],
  [AppMigrationManager.prototype,'download'],[AppMigrationManager.prototype,'install']]
 for(const [proto,method] of cases){const fn=(proto as Record<string, (...args:unknown[])=>Promise<unknown>>)[method]!;await expect(fn.call({}, {distribution:'website',capabilities:{executableExtensionInstall:true}})).rejects.toThrow('该功能仅在官网版本中可用。')}
 const tasks=Object.create(ArkmeExtensionInstallTasks.prototype) as ArkmeExtensionInstallTasks
 expect(()=>tasks.start({} as never)).toThrow('该功能仅在官网版本中可用。')
 expect(()=>tasks.resume('id','id')).toThrow('该功能仅在官网版本中可用。')
 await expect(runPluginUpdater('/does-not-exist')).rejects.toThrow('该功能仅在官网版本中可用。')
 await expect(ArkmeExtensionManager.prototype.updates.call({} as never)).resolves.toEqual([])
})
test('website capability restrictions are honored without changing default behavior',()=>{
 vi.stubEnv('ARKME_HOST_POLICY',JSON.stringify({...mas,distribution:'website'}));expect(()=>assertHostCapability('runtimeSelfUpdate')).toThrow('ARKME_CAPABILITY_DISABLED')
 vi.unstubAllEnvs();expect(()=>assertHostCapability('runtimeSelfUpdate')).not.toThrow()
})
