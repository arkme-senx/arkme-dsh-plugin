import { pathToFileURL } from 'node:url'

const WAIT_WINDOW_MS = 15 * 60_000
const POLL_INTERVAL_MS = 5_000
const REQUEST_TIMEOUT_MS = 30_000

async function checkRegistry(url, { version, integrity }, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('Registry 请求超时')), timeoutMs)
  let httpStatus = 'HTTP 未收到响应'
  try {
    const response = await fetch(url, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: controller.signal,
    })
    httpStatus = `HTTP ${response.status}`
    if (!response.ok) {
      await response.body?.cancel()
      return httpStatus
    }
    let value
    try {
      value = await response.json()
    } catch (error) {
      if (controller.signal.aborted || !(error instanceof SyntaxError)) throw error
      return `${httpStatus}，Registry 响应不是有效 JSON`
    }
    const failures = []
    if (value?.version !== version) {
      failures.push(`version 不一致：预期 ${version}，实际 ${JSON.stringify(value?.version ?? null)}`)
    }
    if (typeof value?.dist?.integrity !== 'string') {
      failures.push('dist.integrity 缺失')
    } else if (value.dist.integrity !== integrity) {
      failures.push(`dist.integrity 不一致：预期 ${integrity}，实际 ${value.dist.integrity}`)
    }
    if (typeof value?.dist?.attestations?.url !== 'string') failures.push('dist.attestations.url 缺失')
    if (typeof value?.dist?.attestations?.provenance?.predicateType !== 'string') {
      failures.push('dist.attestations.provenance.predicateType 缺失')
    }
    return failures.length === 0 ? null : `${httpStatus}，${failures.join('；')}`
  } catch (error) {
    const detail = controller.signal.aborted ? controller.signal.reason : error
    return `${httpStatus}，请求失败：${detail.message ?? String(detail)}${detail.cause?.code ? ` (${detail.cause.code})` : ''}`
  } finally {
    clearTimeout(timer)
  }
}

export async function waitForNpmRelease({ packageName, version, integrity }) {
  for (const [name, value] of Object.entries({ PACKAGE_NAME: packageName, VERSION: version, RELEASE_INTEGRITY: integrity })) {
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`缺少发布校验参数 ${name}`)
  }
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`
  const startedAt = Date.now()
  const deadline = startedAt + WAIT_WINDOW_MS
  let lastReason
  let lastLoggedAt = startedAt
  for (let attempt = 1; ; attempt++) {
    // Always check after the last sleep, including when the waiting window has elapsed.
    const finalCheck = Date.now() >= deadline
    if (finalCheck) console.log('已达到 15 分钟等待窗口，执行最后一次 Registry 校验。')
    const timeoutMs = finalCheck ? REQUEST_TIMEOUT_MS : Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now())
    const reason = await checkRegistry(`${url}?cache_bust=${Date.now()}-${attempt}`, { version, integrity }, Math.max(1, timeoutMs))
    const elapsed = Math.round((Date.now() - startedAt) / 1_000)
    if (reason === null) {
      console.log(`Registry integrity 与 provenance 回读通过：${packageName}@${version}，已等待 ${elapsed} 秒。`)
      return
    }
    if (finalCheck) {
      throw new Error(`Registry integrity 或 provenance 回读未通过：${packageName}@${version}，已等待 ${elapsed} 秒；最后检查：${reason}`)
    }
    if (reason !== lastReason || Date.now() - lastLoggedAt >= 60_000) {
      console.log(`等待 Registry integrity 与 provenance 生效：${elapsed}/900 秒，第 ${attempt} 次；${reason}`)
      lastReason = reason
      lastLoggedAt = Date.now()
    }
    const remaining = deadline - Date.now()
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(POLL_INTERVAL_MS, remaining)))
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  waitForNpmRelease({
    packageName: process.env.PACKAGE_NAME,
    version: process.env.VERSION,
    integrity: process.env.RELEASE_INTEGRITY,
  }).catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
