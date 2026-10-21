import { build } from 'vite'
import path from 'node:path'
await build({ configFile: false, root: process.cwd(),
  plugins: [{ name: 'isolated-recording-api', enforce: 'pre', resolveId(source, importer) {
    if (source === '../api.js' && importer?.endsWith('/recordings/ArkmeRecordingImportDialog.tsx')) return path.resolve('tests/fixtures/recording-picker-api.ts')
  } }], build: {
  outDir: process.argv[2] || '/tmp/arkme-recording-picker-fixture', emptyOutDir: true,
  rollupOptions: { input: ['recording-picker', 'recording-picker-component'].map(name => path.resolve(`tests/fixtures/${name}.html`)) },
} })
