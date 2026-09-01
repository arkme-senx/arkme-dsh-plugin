import { defineConfig } from 'tsdown'

const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-slots',
]

const PUBLIC_WORKBENCH_BUILD = process.env.ARKME_PUBLIC_BUILD === '1'

export default defineConfig([
  {
    name: '@senguoyun/arkme-workbench',
    entry: { index: 'src/workbench-extension-host.ts' },
    outDir: 'packages/arkme-workbench/lib',
    format: 'esm', platform: 'node', target: 'es2024', fixedExtension: false, dts: false, clean: false,
  },
  {
    name: '@senguoyun/arkme-workbench/client',
    entry: { client: 'src/workbench-extension-client.tsx' },
    outDir: 'packages/arkme-workbench/lib',
    format: 'cjs', platform: 'browser', target: 'es2022', fixedExtension: false, dts: false, clean: false,
    minify: true, loader: { '.svg': 'base64', '.png': 'base64' }, sourcemap: false,
    external: CLIENT_EXTERNALS,
    noExternal: (id: string) => CLIENT_EXTERNALS.includes(id) ? undefined : true,
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      // The marketplace package is built with ARKME_PUBLIC_BUILD=1 and starts
      // empty. Local builds intentionally keep the owner's demo library.
      '__ARKME_WORKBENCH_PUBLIC__': JSON.stringify(PUBLIC_WORKBENCH_BUILD),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "@senguoyun/arkme-workbench", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
  {
    name: '@senguoyun/dsh-arkme',
    entry: {
      index: 'src/index.ts',
      'plugin-updater-helper': 'src/plugin-updater-helper-cli.ts',
      'persistent-extension': 'src/extensions/persistent-runtime.ts',
      'bundle-runtime': 'src/extensions/bundle-runtime.ts',
      'extension-profile-restart-helper': 'src/extensions/profile-restart-helper.ts',
    },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { alwaysBundle: ['pinyin-pro'] },
  },
  {
    name: '@senguoyun/dsh-arkme/client',
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
    minify: PUBLIC_WORKBENCH_BUILD,
    loader: { '.svg': 'base64', '.png': 'base64' },
    sourcemap: PUBLIC_WORKBENCH_BUILD ? false : true,
    external: CLIENT_EXTERNALS,
    noExternal: (id: string) => CLIENT_EXTERNALS.includes(id) ? undefined : true,
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      '__ARKME_WORKBENCH_PUBLIC__': JSON.stringify(PUBLIC_WORKBENCH_BUILD),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "@senguoyun/dsh-arkme", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
  {
    name: '@senguoyun/dsh-arkme/sdk',
    entry: { sdk: 'src/sdk/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
