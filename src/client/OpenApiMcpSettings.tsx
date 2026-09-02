import { useCallback, useEffect, useState } from 'react'
import { CaretRight } from '@phosphor-icons/react/CaretRight'
import { CircleNotch } from '@phosphor-icons/react/CircleNotch'
import type { OpenApiMcpStatus } from '../openapi-mcp/types.js'
import { callArkme } from './api.js'

export interface OpenApiMcpPresentation {
  title: string
  description: string
  action?: 'retry'
}

export function openApiMcpPresentation(status: OpenApiMcpStatus | undefined): OpenApiMcpPresentation {
  if (status === undefined || status.state === 'reconciling') {
    return { title: '开放平台 MCP', description: '正在同步可用工具…' }
  }
  if (status.state === 'ready') {
    return { title: '开放平台 MCP', description: '已连接，Agent 可使用开放平台工具' }
  }
  if (status.state === 'degraded') {
    return { title: '开放平台 MCP', description: '连接暂时不可用，可安全重试', action: 'retry' }
  }
  return {
    title: '开放平台 MCP',
    description: status.userAction === 'login' ? '登录后自动连接' : '当前未启用',
  }
}

export function OpenApiMcpSettings(): JSX.Element {
  const [status, setStatus] = useState<OpenApiMcpStatus>()
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const next = await callArkme<OpenApiMcpStatus>('openapi.mcp.status', undefined, signal)
    setStatus(next)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      try { await refresh(controller.signal) } catch { /* The row remains safely unavailable until the next poll. */ }
      if (controller.signal.aborted) return
      const interval = status?.state === 'ready' || status?.state === 'inactive' ? 30_000 : 5_000
      timer = setTimeout(() => { void poll() }, interval)
    }
    void poll()
    return () => {
      controller.abort()
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [refresh, status?.state])

  const presentation = openApiMcpPresentation(status)
  const runAction = async (): Promise<void> => {
    if (presentation.action === undefined || busy) return
    setBusy(true)
    setFeedback('')
    try {
      const next = await callArkme<OpenApiMcpStatus>('openapi.mcp.retry')
      setStatus(next)
    } catch {
      setFeedback('操作未完成，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  const body = <>
    <strong>{presentation.title}</strong>
    <span className="arkme-redesign-setting-summary">{busy ? '正在处理…' : presentation.description}</span>
    {busy
      ? <CircleNotch size={15} aria-label="正在处理" className="arkme-spin" />
      : presentation.action === undefined
        ? <span className="arkme-redesign-trailing-slot" aria-hidden />
        : <CaretRight size={15} aria-hidden />}
  </>

  return <>
    {presentation.action === undefined
      ? <div className="arkme-redesign-setting-row" role="status">{body}</div>
      : <button
          type="button"
          className="arkme-redesign-setting-row"
          disabled={busy}
          aria-label="重试开放平台 MCP 连接"
          onClick={() => { void runAction() }}
        >{body}</button>}
    {feedback === '' ? null : <p className="arkme-account-feedback" role="alert">{feedback}</p>}
  </>
}
