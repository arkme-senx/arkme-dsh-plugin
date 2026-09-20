import { build } from 'tsdown'
const outDir = process.argv[2]
if (!outDir) throw new Error('Pass a temporary output directory')
await build({ config: false, entry: { editor: 'tests/fixtures/long-article-window-entry.tsx' }, outDir,
  format: 'esm', platform: 'browser', target: 'es2022', deps: { alwaysBundle: [/.*/], onlyBundle: false }, dts: false, sourcemap: false,
  loader: { '.svg': 'base64', '.png': 'base64' }, define: { 'process.env.NODE_ENV': JSON.stringify('production') },
})
