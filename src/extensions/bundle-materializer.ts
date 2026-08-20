import { Buffer } from 'node:buffer'
import {
  ARKME_BUNDLE_CONTRACT_VERSION,
  arkmeSandboxEntryId,
  canonicalBundleJson,
  packBundleFiles,
  renderArkmeSandboxHostEntry,
  type ArkmeBundlePublishSource,
} from './bundle-artifact.js'
import { renderArkmeBundleClientBundle } from './persistent-client-bundle.js'

export interface CordisBundleMaterializeInput {
  packageName: string
  name: string
  description: string
  version: string
  hostCode?: string
  clientCode?: string
}

export function materializeCordisBundle(input: CordisBundleMaterializeInput): ArkmeBundlePublishSource {
  if (input.hostCode === undefined && input.clientCode === undefined) throw new Error('Cordis Bundle 至少需要 Host 或 Client 代码')
  const entryId = arkmeSandboxEntryId(input.packageName)
  const source = {
    format: 'arkme-cordis-source',
    formatVersion: 1,
    name: input.name.trim(),
    description: input.description.trim(),
    ...(input.hostCode === undefined ? {} : { hostCode: input.hostCode.replace(/\r\n?/g, '\n') }),
    ...(input.clientCode === undefined ? {} : { clientCode: input.clientCode.replace(/\r\n?/g, '\n') }),
  }
  const manifest = {
    name: input.packageName,
    version: input.version,
    type: 'module',
    main: './lib/index.js',
    files: ['lib', 'arkme', 'cordis.patch.yml'],
    exports: { '.': './lib/index.js', './package.json': './package.json' },
    peerDependencies: {
      '@deepseek-ai/cordis': '^4.0.1',
      '@senguoyun/dsh-arkme': '^0.1.8',
    },
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      arkme: { executionModel: 'arkme-sandboxed', runtimeContract: ARKME_BUNDLE_CONTRACT_VERSION },
      ...(input.clientCode === undefined ? {} : { client: { inject: [], platform: 'web' } }),
    },
  }
  const files = new Map<string, Buffer>([
    ['package/package.json', Buffer.from(canonicalBundleJson(manifest), 'utf8')],
    ['package/cordis.patch.yml', Buffer.from([
      '- insert:',
      `    - id: ${entryId}`,
      `      name: '${input.packageName}'`,
      '',
    ].join('\n'), 'utf8')],
    ['package/arkme/source.json', Buffer.from(canonicalBundleJson(source), 'utf8')],
    ['package/lib/index.js', Buffer.from(renderArkmeSandboxHostEntry(input.packageName), 'utf8')],
  ])
  if (input.clientCode !== undefined) {
    files.set('package/lib/client.js', Buffer.from(renderArkmeBundleClientBundle(input.packageName, {
      version: input.version,
      name: input.name.trim(),
      code: input.clientCode.replace(/\r\n?/g, '\n'),
      apiPath: '/arkme-self/api',
    }), 'utf8'))
  }
  return packBundleFiles(files)
}
