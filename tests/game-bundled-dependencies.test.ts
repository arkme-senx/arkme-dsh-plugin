import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {cp, mkdir, mkdtemp, readFile, realpath, rm, symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, relative, isAbsolute, resolve} from 'node:path'
import {expect, it} from 'vitest'

it('ships the real Tencent SDK inside the isolated offline plugin archive', async()=>{
  const root=await mkdtemp(join(tmpdir(),'arkme-game-bundled-'))
  try {
    const source=JSON.parse(await readFile('package.json','utf8'))
    const staging = join(root, 'source')
    await mkdir(staging)
    await cp('package.json', join(staging, 'package.json'))
    await cp('pnpm-workspace.yaml', join(staging, 'pnpm-workspace.yaml'))
    await cp('scripts', join(staging, 'scripts'), { recursive: true })
    await symlink(resolve('node_modules'), join(staging, 'node_modules'), 'junction')
    execFileSync('pnpm', ['exec', 'tsdown', '--filter', '@senguoyun/dsh-arkme/game', '--out-dir', join(staging, 'lib')], {
      stdio: 'pipe', timeout: 30000,
    })
    execFileSync('pnpm',['--config.verifyDepsBeforeRun=warn','pack','--pack-destination',root],{
      cwd: staging,
      env:{...process.env,ARKME_SKIP_PREPARE_BUILD:'true'},stdio:'pipe',timeout:30000,
    })
    execFileSync('tar',['-xzf',join(root,`senguoyun-dsh-arkme-${source.version}.tgz`),'-C',root])
    const packed=await realpath(join(root,'package'))
    const manifest=JSON.parse(await readFile(join(packed,'package.json'),'utf8'))
    expect(manifest.bundledDependencies).toContain('@tencentcloud/lite-chat')
    const sdk=JSON.parse(await readFile(join(packed,'node_modules/@tencentcloud/lite-chat/package.json'),'utf8'))
    expect(sdk.version).toBe(source.dependencies['@tencentcloud/lite-chat'])
    const entry=await realpath(createRequire(join(packed,'package.json')).resolve('@tencentcloud/lite-chat'))
    const local=relative(packed,entry)
    expect(isAbsolute(local)||local.startsWith('..')).toBe(false)
    expect((await readFile(entry)).length).toBeGreaterThan(0)
    expect((await readFile(join(packed,'lib/game.js'))).length).toBeGreaterThan(0)
  } finally {await rm(root,{recursive:true,force:true})}
},60000)
