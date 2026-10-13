import { build } from 'tsdown'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const outDir = process.argv[2]
if (!outDir) throw new Error('Pass an isolated output directory')
await mkdir(outDir, { recursive: true })
await build({ config: false, entry: { catalog: 'tests/fixtures/session-catalog-entry.tsx' }, outDir,
  format: 'esm', platform: 'browser', target: 'es2022', deps: { alwaysBundle: [/.*/], onlyBundle: false },
  dts: false, sourcemap: false, loader: { '.svg': 'base64', '.png': 'base64' }, define: { 'process.env.NODE_ENV': JSON.stringify('production') },
})
await writeFile(join(outDir, 'catalog.html'), '<!doctype html><html lang="zh"><meta charset="utf-8"><link rel="stylesheet" href="catalog.css"><style>body{font:16px system-ui;margin:28px}button{margin:8px;padding:12px;display:block}</style><div id="root"></div><script type="module" src="catalog.js"></script></html>')
await writeFile(join(outDir, 'index.html'), '<!doctype html><html lang="zh"><meta charset="utf-8"><section data-arkme-account-id="fixture" data-arkme-account-scope="local" data-arkme-visible="true"><iframe title="会话目录" src="catalog.html" style="width:100%;height:850px;border:0"></iframe></section><output id="navigation"></output><script>document.addEventListener("arkme:native-session-open", e => {document.getElementById("navigation").textContent=JSON.stringify(e.detail)})</script></html>')
