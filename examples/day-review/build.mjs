// Build after installing the packed Provider into this package's parent profile.
import { build } from 'tsdown'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
await mkdir(new URL('./lib/', import.meta.url), { recursive: true })
// The official loader imports each package on the Host. This inert entry has
// no injected services, filesystem access, RPC, model call or data collection.
await writeFile(new URL('./lib/index.js', import.meta.url), 'export function apply() {}\n')
await build({ entry: [fileURLToPath(new URL('./client.tsx', import.meta.url))], outDir: fileURLToPath(new URL('./lib/', import.meta.url)),
  config: false, format: 'cjs', platform: 'browser', dts: false, clean: false, target: 'es2022',
  external: ['react', 'react/jsx-runtime'], noExternal: ['@senguoyun/dsh-arkme/sdk'],
  outputOptions: { codeSplitting: false, entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "@arkme-examples/day-review", factory: (require) => {',
    intro: 'var module = { exports: {} }; var exports = module.exports;', footer: 'return module.exports; } });' } })
