import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readdir, readFile, rename, link } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { securePrivateDirectory } from './private-filesystem.js'
import { LocalSessionOwnership } from './local-session-ownership.js'

type LocalSessionScope = { root: string; accountRef: string; environment: 'test' | 'prod'; dshVersion: string }

function assertSupportedScope(input: LocalSessionScope): void {
  if (input.environment !== 'test' || input.dshVersion !== '0.1.5-rc.2') throw new Error('本机接管需要测试环境与 DSH 0.1.5-rc.2')
  if (!isAbsolute(input.root) || !/^[a-f0-9]{64}$/.test(input.accountRef)) throw new Error('共享会话作用域无效')
}

/** The plugin owns its DSH composition; launchers only supply scope and environment overrides. */
export function localSessionProfilePatch(input: LocalSessionScope & { pluginDir: string; basePatch: string }): string {
  assertSupportedScope(input)
  const module = (name: string) => JSON.stringify(pathToFileURL(join(input.pluginDir, 'lib', `${name}.js`)).href)
  return [
    '- id: arkme-self', '  disabled: true', '- insert:',
    '    - id: arkme-self-local', `      name: ${module('index')}`,
    ...input.basePatch.trimEnd().split('\n').slice(1).map(line => `    ${line}`),
    '- id: agent', '  disabled: true', '- id: typert-gateway', '  disabled: true',
    '- id: session-persistence-jsonl', '  config:', `    root: ${JSON.stringify(join(input.root, 'sessions'))}`,
    '- id: attachment-local', '  config:', `    dshHome: ${JSON.stringify(input.root)}`,
    '- insert:', '    - id: arkme-local-sessions', `      name: ${module('local-session/index')}`, '      config:',
    `        root: ${JSON.stringify(input.root)}`, `        accountRef: ${JSON.stringify(input.accountRef)}`, `        environment: ${input.environment}`,
    '    - id: arkme-gateway-browser', `      name: ${module('local-session/gateway-browser/index')}`, '',
  ].join('\n')
}

/** Called by the desktop launcher only after its previous Harness exited.
 * DSH 0.1.5 stores project/session directories; move each complete directory
 * atomically, retaining the native log and lock files without decoding them. */
export async function prepareLocalSessionStore(input: {
  dshHome: string; root: string; accountRef: string; environment: 'test' | 'prod'; dshVersion: string
}): Promise<void> {
  assertSupportedScope(input)
  const root = resolve(input.root), home = resolve(input.dshHome)
  const withinHome = relative(home, root)
  if (!withinHome || !isAbsolute(withinHome) && withinHome !== '..' && !withinHome.startsWith(`..${sep}`)) throw new Error('共享会话目录不能位于实例目录中')
  await mkdir(root, { recursive: true, mode: 0o700 }); await securePrivateDirectory(root)
  const migrations: { id: string; source: string; target: string }[] = []
  for (const project of await entries(join(home, 'sessions'))) {
    if (!project.isDirectory() || project.isSymbolicLink()) throw new Error('旧会话目录格式异常，保留原文件')
    const source = join(home, 'sessions', project.name)
    for (const session of await readdir(source, { withFileTypes: true })) {
      if (!session.isDirectory() || session.isSymbolicLink()) throw new Error('旧会话目录包含非会话文件')
      migrations.push({ id: session.name, source: join(source, session.name), target: join(root, 'sessions', project.name, session.name) })
    }
  }
  const pending = new Set(migrations.map(item => item.id))
  // Retain cloud aliases before making a migrated journal visible to any peer.
  const statePath = join(home, 'arkme-self', input.environment, 'dsh-remote', 'runtime-state.json')
  let state: { schemaVersion?: number; accounts?: Record<string, { runtimes?: Record<string, { runtimeRef: string }>; projections?: Record<string, { sessions: { sessionRef: string }[] }> }> } | undefined
  try { state = JSON.parse(await readFile(statePath, 'utf8')) as typeof state }
  catch (error) { if (!missing(error)) throw error }
  if (state && pending.size > 0) {
    if (state.schemaVersion !== 2) throw new Error('旧实例会话目录版本不兼容')
    for (const [accountId, account] of Object.entries(state.accounts ?? {})) {
      if (createHash('sha256').update(`arkme-dsh-account-scope-v1\n${accountId}`).digest('hex') !== input.accountRef) continue
      const store = new LocalSessionOwnership(root, { accountId, environment: input.environment })
      try {
        for (const [profile, inventory] of Object.entries(account.projections ?? {})) {
          const runtime = account.runtimes?.[profile]?.runtimeRef
          if (!runtime && inventory.sessions.length) throw new Error('旧会话缺少原始云端地址')
          // After migration this inventory describes executed/shared sessions,
          // not original addresses. Import aliases only for remaining old logs.
          for (const session of inventory.sessions) if (pending.has(session.sessionRef) && store.bindAddress(session.sessionRef, runtime!) !== runtime) throw new Error('会话云端地址冲突')
        }
      } finally { store.close() }
    }
  }
  // Attachments are immutable content-addressed blobs. Install those before
  // publishing journals that refer to them; concurrent identical blobs are safe.
  await mergeAttachments(join(home, 'attachments'), join(root, 'attachments'))
  for (const item of migrations) {
    await mkdir(resolve(item.target, '..'), { recursive: true, mode: 0o700 })
    try { await lstat(item.target); throw new Error(`共享会话目录已存在 ${item.id}，未覆盖原历史`) }
    catch (error) { if (!missing(error)) throw error }
    await rename(item.source, item.target)
  }
}

async function entries(path: string) {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error('会话迁移不接受符号链接')
    return await readdir(path, { withFileTypes: true })
  } catch (error) { if (missing(error)) return []; throw error }
}

async function mergeAttachments(source: string, target: string): Promise<void> {
  for (const entry of await entries(source)) {
    if (entry.isSymbolicLink()) throw new Error('附件迁移不接受符号链接')
    await mkdir(target, { recursive: true, mode: 0o700 })
    const from = join(source, entry.name), to = join(target, entry.name)
    if (entry.isDirectory()) await mergeAttachments(from, to)
    else if (entry.isFile()) {
      try { await link(from, to) }
      catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error
        if ((await lstat(to)).isSymbolicLink() || await digest(from) !== await digest(to)) throw new Error('共享附件内容冲突')
      }
    } else throw new Error('附件格式不支持迁移')
  }
}

async function digest(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
function missing(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'ENOENT' }
