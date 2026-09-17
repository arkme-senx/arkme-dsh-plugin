import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const definition = parse(readFileSync(resolve(import.meta.dirname, '../.github/workflows/restrict-master-pr-authors.yml'), 'utf8'))
const step = definition.jobs['enforce-organization-members-only'].steps[0]

function checkSource(overrides: Record<string, string> = {}) {
  try {
    return { status: 0, output: execFileSync('bash', ['-eo', 'pipefail', '-c', `
      gh() { printf 'GH_CALL'; printf ' <%s>' "$@"; printf '\\n'; }
      ${step.run}
    `], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        AUTHOR_ASSOCIATION: 'MEMBER', PR_AUTHOR: 'team-member',
        HEAD_REF: 'dev', HEAD_REPO: 'arkme-senx/arkme-dsh-plugin',
        GH_REPO: 'arkme-senx/arkme-dsh-plugin', PR_NUMBER: '123',
        ...overrides,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) }
  } catch (error) {
    const result = error as { status: number; stdout: string }
    return { status: result.status, output: result.stdout }
  }
}

describe('master PR source policy', () => {
  it.each(['MEMBER', 'OWNER', 'COLLABORATOR'])('allows same-repository dev from %s', role => {
    const result = checkSource({ AUTHOR_ASSOCIATION: role })
    expect(result.status).toBe(0)
    expect(result.output).not.toContain('GH_CALL')
  })

  it('allows the existing automated release workflow', () => {
    const result = checkSource({ HEAD_REF: 'release/v0.1.65', PR_AUTHOR: 'github-actions[bot]', AUTHOR_ASSOCIATION: 'NONE' })
    expect(result.status).toBe(0)
    expect(result.output).not.toContain('GH_CALL')
  })

  it.each([
    { HEAD_REF: 'feature/calls' },
    { HEAD_REF: 'feature/calendar', AUTHOR_ASSOCIATION: 'OWNER' },
    { HEAD_REF: 'feature/search', AUTHOR_ASSOCIATION: 'COLLABORATOR' },
    { HEAD_REF: 'release/v0.1.65' },
    { HEAD_REPO: 'someone/arkme-dsh-plugin' },
    { AUTHOR_ASSOCIATION: 'CONTRIBUTOR' },
    { HEAD_REF: 'release/v0.1.65', HEAD_REPO: 'someone/arkme-dsh-plugin', PR_AUTHOR: 'github-actions[bot]' },
    { HEAD_REF: 'feature/bot', PR_AUTHOR: 'github-actions[bot]', AUTHOR_ASSOCIATION: 'NONE' },
  ])('closes and fails disallowed source %j', overrides => {
    const result = checkSource(overrides)
    expect(result.status).toBe(1)
    expect(result.output).toContain('请先将功能分支合入 dev')
    expect(result.output).toContain('GH_CALL <pr> <close> <123> <--repo> <arkme-senx/arkme-dsh-plugin>')
  })
})
