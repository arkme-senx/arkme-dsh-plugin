import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import { collectEvidence, fallbackNotes, generateNotes, renderItems, summarizeNotes, validateNotes } from '../scripts/runtime-release-notes.mjs'
import { finalizeRelease, findBaseline, prepareRelease, publishProductionRelease, requestJSON, runtimeVersionID } from '../scripts/production-runtime-release.mjs'

const exec = promisify(execFile)
const roots: string[] = []
const sourceSHA = '1'.repeat(40)
const version = '0.2.0'
const notes = '1. 新增聊天记录导出。\n2. 优化消息加载速度。\n3. 修复录音中断问题。'
const record = { schemaVersion: 1, version, sourceSHA, notes }
const activated = { id: runtimeVersionID(version), component: 'arkme-plugin', version, source_revision: sourceSHA, notes, status: 'ready', last_activated_version_code: 42 }
const evidence = [{ id: 'file:src/chat.ts', text: '+ export function exportChat() {}' }]
const items = [{ kind: 'feature', text: '新增聊天记录导出。', evidence: [evidence[0].id] }]
const modelResponse = (value: unknown, status = 'completed') => new Response(JSON.stringify({ status, output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }))
const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.invalid' }
const git = async (cwd: string, ...args: string[]) => (await exec('git', args, { cwd, env: gitEnv })).stdout.trim()

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'arkme release notes '))
  roots.push(root)
  await git(root, 'init', '--initial-branch=master')
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'package.json'), JSON.stringify({ version, arkme: { updateNotice: { summary: 'old' } } }))
  await writeFile(join(root, 'src/chat.ts'), 'export const enabled = false\n')
  await git(root, 'add', '.')
  await git(root, 'commit', '-m', 'baseline')
  const baseSHA = await git(root, 'rev-parse', 'HEAD')
  await git(root, 'tag', 'v0.1.0')
  await writeFile(join(root, 'src/chat.ts'), 'export const enabled = true\n')
  await git(root, 'add', '.')
  await git(root, 'commit', '-m', 'feat: enable chat export (#123)')
  const sha = await git(root, 'rev-parse', 'HEAD')
  const directory = join(root, '.notes')
  return { root, baseSHA, sha, directory }
}

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('numbered user notes', () => {
  it('sorts features before improvements and fixes, deduplicates and retains evidence', () => {
    const result = renderItems([
      { kind: 'fix', text: '修复录音中断问题。', evidence: ['x'] },
      { kind: 'improvement', text: '优化消息加载速度。', evidence: ['x'] },
      ...[1, 2].map(() => ({ kind: 'feature', text: '新增聊天记录导出。', evidence: ['x'] })),
    ], new Set(['x']))
    expect(result.notes).toBe(notes)
    expect(result.items).toHaveLength(3)
  })

  it.each(['1. 太'.repeat(20) + '。', '1. 缺少句号', '2. 错误编号。', '1. 多行\n内容。', '1. 包含空 格。', '1. 两句话。另一句。'])('rejects malformed notes: %s', value => {
    expect(() => validateNotes(value)).toThrow()
  })

  it('counts Unicode characters including the full stop, excluding numbering', () => {
    expect(validateNotes('1. ' + '字'.repeat(14) + '。')).toBeTruthy()
    expect(() => validateNotes('1. ' + '字'.repeat(15) + '。')).toThrow()
    expect(validateNotes('1. ' + '😀'.repeat(14) + '。')).toBeTruthy()
  })

  it('summarizes whole leading items within the 120-character metadata limit', () => {
    const long = Array.from({ length: 20 }, (_, index) => `${index + 1}. ${'字'.repeat(14)}。`).join('\n')
    expect(summarizeNotes(long)).toHaveLength(120)
    expect(summarizeNotes(notes)).toBe('新增聊天记录导出。优化消息加载速度。修复录音中断问题。')
  })

  it('requires evidence to exist in the supplied range', () => {
    expect(() => renderItems([{ ...items[0], evidence: ['invented'] }], new Set(['x']))).toThrow('evidence')
  })
})

describe('OpenAI generation', () => {
  it('uses Responses structured outputs and does not store input remotely', async () => {
    const fetchImpl = vi.fn(async () => modelResponse({ items }))
    const result = await generateNotes(evidence, { apiKey: 'test-key', model: 'configured-model', fetchImpl })
    expect(result.notes).toBe('1. 新增聊天记录导出。')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'configured-model', store: false, text: { format: { type: 'json_schema', strict: true } } })
  })

  it('regenerates overlong items instead of truncating them', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(modelResponse({ items: [{ ...items[0], text: '字'.repeat(15) + '。' }] })).mockResolvedValueOnce(modelResponse({ items }))
    expect((await generateNotes(evidence, { apiKey: 'key', model: 'model', fetchImpl })).notes).toBe('1. 新增聊天记录导出。')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).instructions).toContain('禁止直接截断')
  })

  it('falls back after an unsuccessful format repair', async () => {
    const fetchImpl = vi.fn(async () => modelResponse({ items: [{ ...items[0], text: '字'.repeat(16) + '。' }] }))
    const warn = vi.fn()
    expect((await generateNotes(evidence, { apiKey: 'key', model: 'model', fetchImpl, warn })).notes).toBe(fallbackNotes)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('retries transient failures twice and falls back without leaking service errors', async () => {
    const fetchImpl = vi.fn(async () => new Response('secret error detail', { status: 429 }))
    const warn = vi.fn(), sleep = vi.fn()
    expect((await generateNotes(evidence, { apiKey: 'key', model: 'model', fetchImpl, warn, sleep })).notes).toBe(fallbackNotes)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret error detail')
  })

  it('processes every diff chunk then merges candidates', async () => {
    const fetchImpl = vi.fn().mockImplementation(async (_url, init) => {
      const input = JSON.parse(JSON.parse(init.body).input)
      return modelResponse({ items: [{ ...items[0], evidence: [input[0].id] }] })
    })
    const result = await generateNotes([{ id: 'large', text: 'x'.repeat(45000) }], { apiKey: 'key', model: 'model', fetchImpl })
    expect(result.notes).toBe('1. 新增聊天记录导出。')
    expect(fetchImpl).toHaveBeenCalledTimes(4) // 3 bounded chunks + merge
    expect(result.candidates).toHaveLength(3)
  })

  it('uses the fallback for empty changes, missing config and incomplete responses', async () => {
    const fetchImpl = vi.fn(async () => modelResponse({ items }, 'incomplete'))
    for (const options of [{}, { apiKey: 'key', model: 'model', fetchImpl }]) {
      expect((await generateNotes(evidence, options)).notes).toBe(fallbackNotes)
    }
    expect((await generateNotes([], { fetchImpl })).notes).toBe(fallbackNotes)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})

describe('release range and durable recovery', () => {
  it('uses the existing Backend UUID contract', () => {
    expect(runtimeVersionID('0.2.0')).toBe('e9e81678-582c-51aa-8a1c-0fcc454999f1')
  })

  it('generates from a verified Tag once, persisting the same notes for a retry', async () => {
    const project = await fixture()
    const backend = vi.fn(async id => id === runtimeVersionID('0.1.0')
      ? { ...activated, id, version: '0.1.0', source_revision: project.baseSHA } : undefined)
    const github = vi.fn(async () => [])
    const fetchImpl = vi.fn(async () => modelResponse({ items }))
    const options = { cwd: project.root, directory: project.directory, version, sourceSHA: project.sha, backend, github,
      modelOptions: { apiKey: 'key', model: 'model', fetchImpl } }
    const first = await prepareRelease(options)
    expect(first).toMatchObject({ base: { tag: 'v0.1.0' }, reason: 'generated', notes: '1. 新增聊天记录导出。' })
    const second = await prepareRelease(options)
    expect(second.notes).toBe(first.notes)
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(await readFile(join(project.directory, 'notes.txt'), 'utf8')).toBe(first.notes)
  })

  it('rejects a conflicting Tag before generating or publishing anything', async () => {
    const project = await fixture()
    await git(project.root, 'tag', `v${version}`, project.baseSHA)
    const backend = vi.fn()
    await expect(prepareRelease({ cwd: project.root, directory: project.directory, version, sourceSHA: project.sha, backend, github: vi.fn() }))
      .rejects.toThrow('Existing release Tag points to another commit')
    expect(backend).not.toHaveBeenCalled()
  })

  it('compares the final trees and excludes config/tests and fully reverted changes', async () => {
    const project = await fixture()
    const options = { cwd: project.root, baseSHA: project.baseSHA, sourceSHA: project.sha }
    expect((await collectEvidence(options)).map(e => e.id)).toEqual(['file:src/chat.ts', 'commits'])
    await writeFile(join(project.root, 'src/chat.ts'), 'export const enabled = false\n')
    await writeFile(join(project.root, 'src/chat.test.ts'), 'test only\n')
    await git(project.root, 'add', '.')
    await git(project.root, 'commit', '-m', 'revert')
    expect(await collectEvidence({ ...options, sourceSHA: await git(project.root, 'rev-parse', 'HEAD') })).toEqual([])
    expect(await collectEvidence({ ...options, baseSHA: undefined })).toEqual([])
  })

  it('ignores npm-only and prerelease tags, and verifies historical activation', async () => {
    const project = await fixture()
    await git(project.root, 'tag', 'v0.1.1')
    await git(project.root, 'tag', 'v0.1.2-pre.1')
    const backend = vi.fn(async id => id === runtimeVersionID('0.1.0') ? {
      ...activated, id, version: '0.1.0', source_revision: project.baseSHA,
    } : { ...activated, last_activated_version_code: 0 })
    expect(await findBaseline({ cwd: project.root, version, sourceSHA: project.sha, backend })).toMatchObject({ tag: 'v0.1.0', sha: project.baseSHA })
    expect(backend).toHaveBeenCalledTimes(2)
  })

  it('recovers notes and activation from Backend, skipping model generation', async () => {
    const project = await fixture()
    const backend = vi.fn(async () => ({ ...activated, source_revision: project.sha }))
    const github = vi.fn()
    const value = await prepareRelease({ cwd: project.root, directory: project.directory, version, sourceSHA: project.sha, backend, github })
    expect(value).toMatchObject({ notes, activation: { versionCode: 42 }, reason: 'backend-recovery' })
    expect(await readFile(join(project.directory, 'notes.txt'), 'utf8')).toBe(notes)
    expect(JSON.parse(await readFile(join(project.root, 'package.json'), 'utf8')).arkme.updateNotice.summary).toBe(summarizeNotes(notes))
    expect(github).not.toHaveBeenCalled()
  })

  it('pins the first-release fallback and reuses the saved file on reruns', async () => {
    const project = await fixture()
    const options = { cwd: project.root, directory: project.directory, version, sourceSHA: project.sha, backend: async () => undefined, github: vi.fn() }
    const first = await prepareRelease(options)
    expect(first.notes).toBe(fallbackNotes)
    expect(first.base).toBeNull()
    const again = await prepareRelease({ ...options, backend: async () => { throw new Error('outage') } }) .catch(() => undefined)
    expect(again).toBeUndefined() // Unknown Backend state is not treated as an absent version.
    expect((await prepareRelease(options)).notes).toBe(first.notes)
  })
})

describe('activation owns tags and releases', () => {
  function githubFixture() {
    const state: { ref?: any; release?: any } = {}
    const github = vi.fn(async (path, options = {}) => {
      if (path === `git/ref/tags/v${version}`) return state.ref
      if (path === 'git/refs') return state.ref = { object: { type: 'commit', sha: options.body.sha } }
      if (path === `releases/tags/v${version}`) return state.release
      if (path === 'releases') return state.release = options.body
      throw new Error('Unexpected GitHub request')
    })
    return { github, state }
  }

  it.each([undefined, { ...activated, last_activated_version_code: 0 }, { ...activated, status: 'validating' }, { ...activated, source_revision: '2'.repeat(40) }, { ...activated, notes: 'different' }])('does not tag an unconfirmed Runtime', async runtime => {
    const github = vi.fn()
    await expect(finalizeRelease(record, { backend: async () => runtime, github })).rejects.toThrow()
    expect(github).not.toHaveBeenCalled()
  })

  it('submits the exact multiline notes before creating a Tag and Release', async () => {
    let runtime: any
    const { github, state } = githubFixture()
    const publishArtifact = vi.fn(async options => {
      expect(github).not.toHaveBeenCalled()
      expect(options).toMatchObject({ notes, sourceSHA })
      runtime = { ...activated }
    })
    await publishProductionRelease(record, { backend: async () => runtime, github, publishArtifact })
    expect(state.ref.object.sha).toBe(sourceSHA)
    expect(state.release.body).toBe(notes)
    expect(publishArtifact).toHaveBeenCalledOnce()
  })

  it('does not tag after failed publication or activation', async () => {
    const github = vi.fn()
    const publishArtifact = vi.fn(async () => { throw new Error('activation failed') })
    await expect(publishProductionRelease(record, { backend: async () => undefined, github, publishArtifact })).rejects.toThrow('activation failed')
    expect(github).not.toHaveBeenCalled()
  })

  it('recovers from a failed Release creation without activating again or overwriting human edits', async () => {
    const { github, state } = githubFixture()
    const publishArtifact = vi.fn()
    const options = { backend: async () => activated, github, publishArtifact }
    const failingGithub = async (path, init) => { if (path === 'releases') throw new Error('GitHub outage'); return github(path, init) }
    await expect(publishProductionRelease(record, { ...options, github: failingGithub })).rejects.toThrow('GitHub outage')
    expect(state.ref.object.sha).toBe(sourceSHA)
    await publishProductionRelease(record, options)
    state.release.body = '人工编辑的说明'
    await publishProductionRelease(record, options)
    expect(state.release.body).toBe('人工编辑的说明')
    expect(publishArtifact).not.toHaveBeenCalled()
    expect(github.mock.calls.filter(([path]) => path === 'git/refs')).toHaveLength(1)
  })

  it('rejects a conflicting Tag and never overwrites it', async () => {
    const { github, state } = githubFixture()
    state.ref = { object: { type: 'commit', sha: '2'.repeat(40) } }
    await expect(finalizeRelease(record, { backend: async () => activated, github })).rejects.toThrow('refusing to overwrite')
    expect(github).toHaveBeenCalledOnce()
  })

  it('treats only a real 404 as absent and fails closed on auth/outage', async () => {
    expect(await requestJSON('https://example.invalid', { token: 'key', allow404: true, fetchImpl: async () => new Response('', { status: 404 }) })).toBeUndefined()
    await expect(requestJSON('https://example.invalid', { token: 'key', allow404: true, fetchImpl: async () => new Response('', { status: 401 }) })).rejects.toThrow('401')
  })

  it('keeps npm independent and places Tag creation after Runtime publication in the production workflow', async () => {
    const root = resolve(import.meta.dirname, '..')
    const npm = await readFile(join(root, '.github/workflows/publish-plugin-release.yml'), 'utf8')
    expect(npm).not.toContain('gh release create')
    expect(npm).not.toContain('git tag -a')
    const workflow = parse(await readFile(join(root, '.github/workflows/publish-production-runtime.yml'), 'utf8'))
    const job = workflow.jobs['publish-runtime']
    expect(job.permissions.contents).toBe('write')
    expect(job.steps.find(s => s.id === 'notes').run).toContain('prepare')
    expect(job.steps.at(-1).run).toContain('publish')
    expect(job.steps.find(s => s.name === '校验、构建并打包 Runtime').if).toContain('already_activated')
  })
})
