import { build } from 'vite';
import path from 'node:path';
await build({ configFile: false, root: process.cwd(), build: { outDir: process.argv[2] || '/private/tmp/arkme-attachment-preview-bundle', emptyOutDir: true, rollupOptions: { input: path.resolve('tests/fixtures/attachment-preview.html') } } });
