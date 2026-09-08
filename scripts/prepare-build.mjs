import { spawnSync } from 'node:child_process'

// CI builds explicitly after validation. Local install/pack keeps the default build.
if (process.env.ARKME_SKIP_PREPARE_BUILD === 'true') {
  console.log('ARKME_SKIP_PREPARE_BUILD=true: 跳过 prepare 隐式构建，由发布流程显式构建。')
} else {
  const result = spawnSync('pnpm', ['run', 'build'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error) console.error(result.error)
  process.exit(result.status ?? 1)
}
