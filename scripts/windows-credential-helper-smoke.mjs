import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const helperPath = process.argv[2]
if (!helperPath) throw new Error('Windows credential helper path is required')

function invoke(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`helper exited with code ${String(code)}: ${stderr.trim()}`))
        return
      }
      try {
        resolve(JSON.parse(stdout.trim()))
      } catch {
        reject(new Error('helper returned invalid JSON'))
      }
    })
    child.stdin.end(`${JSON.stringify(request)}\n`, 'utf8')
  })
}

const service = `com.senqisi.dsh-arkme.smoke.${randomUUID()}`
const account = 'session'
const payload = JSON.stringify({
  accessToken: 'smoke-access-token',
  refreshToken: 'smoke-refresh-token',
  userId: 10001,
})

try {
  const initial = await invoke({ operation: 'read', service, account })
  if (initial.ok !== true || initial.found !== false) throw new Error('initial read was not empty')
  const written = await invoke({ operation: 'write', service, account, payload })
  if (written.ok !== true) throw new Error('write failed')
  const read = await invoke({ operation: 'read', service, account })
  if (read.ok !== true || read.found !== true || read.value !== payload) throw new Error('round trip failed')
  const deleted = await invoke({ operation: 'delete', service, account })
  if (deleted.ok !== true) throw new Error('delete failed')
  const afterDelete = await invoke({ operation: 'read', service, account })
  if (afterDelete.ok !== true || afterDelete.found !== false) throw new Error('credential remained after delete')
  const idempotentDelete = await invoke({ operation: 'delete', service, account })
  if (idempotentDelete.ok !== true) throw new Error('idempotent delete failed')
  process.stdout.write('Windows credential helper smoke test: PASS\n')
} finally {
  await invoke({ operation: 'delete', service, account }).catch(() => undefined)
}
