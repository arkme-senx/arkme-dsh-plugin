import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TEAM_CODEX_BRIDGE_SCRIPT } from '../src/team-codex-bridge-script.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

// Exercise only directory classification: no enroll/capture calls or fabricated Hook events.
const probe = String.raw`
import json, os, runpy, sys
namespace = runpy.run_path(sys.argv[1])
original_fdopen = os.fdopen
class HeaderOnlyReader:
    def __init__(self, stream): self.stream, self.lines = stream, 0
    def __enter__(self): return self
    def __exit__(self, *args): self.stream.close()
    def fileno(self): return self.stream.fileno()
    def readline(self, limit):
        assert self.lines < 3 and 0 < limit <= 2048, 'Read beyond project metadata header'
        self.lines += 1
        return self.stream.readline(limit)
def header_reader(*args, **kwargs):
    assert kwargs.get('buffering') == 0, 'Do not prefetch project instructions'
    return HeaderOnlyReader(original_fdopen(*args, **kwargs))
os.fdopen = header_reader
print(json.dumps([namespace['project_metadata'](cwd) for cwd in json.loads(sys.argv[2])]))
`

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'arkme-project-metadata-')); roots.push(root)
  const config = join(root, 'codex'), helper = join(root, 'bridge.py')
  mkdirSync(config); writeFileSync(helper, TEAM_CODEX_BRIDGE_SCRIPT)
  const project = (id: string, name?: string) => {
    const path = join(config, '.chatgpt-projects', id)
    mkdirSync(path, { recursive: true })
    if (name !== undefined) label(path, name)
    return path
  }
  const classify = (...paths: (string | null)[]) => {
    const result = spawnSync('python3', ['-c', probe, helper, JSON.stringify(paths)], {
      env: { ...process.env, CODEX_HOME: config }, encoding: 'utf8', timeout: 5000,
    })
    expect(result.status, result.stderr).toBe(0)
    return JSON.parse(result.stdout) as { key: string; name: string; cwd: string; branch: string; worktree: string }[]
  }
  return { root, config, project, classify }
}

function label(root: string, name: string) {
  writeFileSync(join(root, 'AGENTS.md'), `# ChatGPT project context\n\nThis directory is a local mirror of the ChatGPT project “${name}”.\n`)
}
const key = (id: string) => createHash('sha256').update(`chatgpt-project:${id}`).digest('hex')

describe('Codex local project mirror metadata', () => {
  it('recognizes the real ArkCam directory shape and groups its subdirectories', () => {
    const f = fixture(), id = 'g-p-6aaa73a603908191a34fc2b56f8a6392', root = f.project(id, 'ArkCam')
    const child = join(root, 'Cam', 'Sources'); mkdirSync(child, { recursive: true })
    const results = f.classify(root, child)
    expect(results.every(p => p.key === key(id) && p.name === 'ArkCam')).toBe(true)
    expect(results[1]?.cwd).toMatch(/\/Cam\/Sources$/)
  })

  it('keeps identity across rename and separates projects with the same display name', () => {
    const f = fixture(), first = f.project('g-p-first', '同名项目'), second = f.project('g-p-second', '同名项目')
    const before = f.classify(first, second)
    expect(before[0]?.key).not.toBe(before[1]?.key)
    label(first, '新的名字')
    expect(f.classify(first)[0]).toMatchObject({ key: before[0]?.key, name: '新的名字' })
  })

  it('reads only the three metadata lines, even when the following body is invalid UTF-8', () => {
    const f = fixture(), root = f.project('g-p-private')
    writeFileSync(join(root, 'AGENTS.md'), Buffer.concat([
      Buffer.from('# ChatGPT project context\r\n\r\nThis directory is a local mirror of the ChatGPT project “ArkCam”.\r\n'),
      Buffer.from([0xff, 0xfe, 0xfd]),
    ]))
    expect(f.classify(root)[0]).toMatchObject({ key: key('g-p-private'), name: 'ArkCam' })
  })

  it('falls back to the project ID for absent, malformed, symlinked or oversized labels', () => {
    const f = fixture(), absent = f.project('g-p-absent'), bad = f.project('g-p-bad')
    writeFileSync(join(bad, 'AGENTS.md'), '# Unrelated document\n\nThis directory is a local mirror of the ChatGPT project “Wrong”.\n')
    const linked = f.project('g-p-linked'), oversized = f.project('g-p-large', 'x'.repeat(3000))
    symlinkSync(join(bad, 'AGENTS.md'), join(linked, 'AGENTS.md'))
    expect(f.classify(absent, bad, linked, oversized).map(p => p.name)).toEqual(['g-p-absent', 'g-p-bad', 'g-p-linked', 'g-p-large'])
  })

  it('keeps projectless internal directories unassigned and normal directories assigned', () => {
    const f = fixture(), projectless = join(f.config, 'workspaces', 'task_123'), normal = join(f.root, 'project-a')
    mkdirSync(projectless, { recursive: true }); mkdirSync(normal); label(normal, 'Not a mirror')
    const metadata = join(f.config, '.chatgpt-projects', '.metadata'); mkdirSync(metadata, { recursive: true })
    const results = f.classify(projectless, f.config, metadata, null, normal)
    expect(results.slice(0, 4).every(p => p.key === 'unknown' && p.name === '')).toBe(true)
    expect(results[4]?.name).toBe('project-a')
  })

  it('keeps hosted project identity while retaining Git metadata, with normal Git grouping unchanged', () => {
    const f = fixture(), root = f.project('g-p-repo', 'ArkCam'), repo = join(root, 'Cam')
    const normal = join(f.root, 'ordinary-repo')
    for (const path of [repo, normal]) {
      mkdirSync(join(path, '.git'), { recursive: true })
      writeFileSync(join(path, '.git', 'HEAD'), 'ref: refs/heads/main\n')
      mkdirSync(join(path, 'src'))
    }
    const [hosted, ordinary, nested] = f.classify(join(repo, 'src'), normal, join(normal, 'src'))
    expect(hosted).toMatchObject({ key: key('g-p-repo'), name: 'ArkCam', branch: 'main' })
    expect(hosted?.worktree).toMatch(/\/Cam$/)
    expect(ordinary).toMatchObject({ name: 'ordinary-repo', branch: 'main' })
    expect(nested?.key).toBe(ordinary?.key)
  })
})
