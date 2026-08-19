import { randomUUID } from 'node:crypto'
import { ArkmePluginError } from '../arkme-service.js'
import type { ArkmeExtensionManager } from './manager.js'
import type { ArkmeExtensionInstallProgress, ArkmeExtensionInstallTaskSnapshot } from './types.js'

export interface ArkmeAgentRegistryLike {
  get(sessionId: string): unknown
}

interface InstallTaskEntry {
  snapshot: ArkmeExtensionInstallTaskSnapshot
  controller: AbortController
  agent: unknown
  version?: string
  pauseRequested: boolean
  attempt: number
  cleanup?: ReturnType<typeof setTimeout>
}

const TASK_RETENTION_MILLIS = 10 * 60 * 1000
const MAX_RETAINED_TASKS = 100

export class ArkmeExtensionInstallTasks {
  private readonly tasks = new Map<string, InstallTaskEntry>()

  constructor(
    private readonly manager: ArkmeExtensionManager,
    private readonly agents: ArkmeAgentRegistryLike,
  ) {}

  start(input: { extensionId: string; version?: string; sessionId: string }): ArkmeExtensionInstallTaskSnapshot {
    const extensionId = requiredToken(input.extensionId, 'extension_id')
    const sessionId = requiredToken(input.sessionId, 'session_id')
    const agent = this.agents.get(sessionId)
    if (agent === undefined) {
      throw new ArkmePluginError('extension-agent-unavailable', '当前 DSH 会话不可用，请先打开或选择一个会话', false, 409)
    }
    for (const entry of this.tasks.values()) {
      if (!entry.snapshot.done && entry.snapshot.extensionId === extensionId && entry.snapshot.sessionId === sessionId) {
        return cloneSnapshot(entry.snapshot)
      }
    }
    this.evictOldestCompletedTask()
    const taskId = randomUUID()
    const controller = new AbortController()
    const snapshot: ArkmeExtensionInstallTaskSnapshot = {
      taskId, extensionId, sessionId, phase: 'resolving', done: false, updatedAtMillis: Date.now(),
      message: '正在解析可安装版本',
    }
    const normalizedVersion = input.version?.trim()
    const entry: InstallTaskEntry = {
      snapshot, controller, agent, pauseRequested: false, attempt: 0,
      ...(normalizedVersion === undefined || normalizedVersion === '' ? {} : { version: normalizedVersion }),
    }
    this.tasks.set(taskId, entry)
    void this.run(entry)
    return cloneSnapshot(snapshot)
  }

  status(taskIdValue: string, sessionIdValue: string): ArkmeExtensionInstallTaskSnapshot {
    const taskId = requiredToken(taskIdValue, 'task_id')
    const sessionId = requiredToken(sessionIdValue, 'session_id')
    const entry = this.tasks.get(taskId)
    if (entry === undefined || entry.snapshot.sessionId !== sessionId) {
      throw new ArkmePluginError('extension-install-task-not-found', '安装任务不存在或不属于当前会话', false, 404)
    }
    return cloneSnapshot(entry.snapshot)
  }

  pause(taskIdValue: string, sessionIdValue: string): ArkmeExtensionInstallTaskSnapshot {
    const entry = this.ownedTask(taskIdValue, sessionIdValue)
    if (entry.snapshot.done || entry.snapshot.phase === 'paused') return cloneSnapshot(entry.snapshot)
    if (!['resolving', 'downloading'].includes(entry.snapshot.phase)) {
      throw new ArkmePluginError('extension-install-not-pausable', '扩展已进入校验或应用阶段，不能暂停', false, 409)
    }
    entry.pauseRequested = true
    this.update(entry, { phase: 'paused', message: '安装已暂停，继续后将重新安全下载制品' })
    entry.controller.abort()
    return cloneSnapshot(entry.snapshot)
  }

  resume(taskIdValue: string, sessionIdValue: string): ArkmeExtensionInstallTaskSnapshot {
    const entry = this.ownedTask(taskIdValue, sessionIdValue)
    if (entry.snapshot.done) return cloneSnapshot(entry.snapshot)
    if (entry.snapshot.phase !== 'paused') {
      throw new ArkmePluginError('extension-install-not-paused', '安装任务当前没有暂停', false, 409)
    }
    entry.pauseRequested = false
    entry.controller = new AbortController()
    entry.attempt += 1
    const { downloadedBytes: _downloaded, totalBytes: _total, error: _error, result: _result, ...retained } = entry.snapshot
    entry.snapshot = {
      ...retained,
      phase: 'resolving',
      done: false,
      updatedAtMillis: Date.now(),
      message: '正在继续安装',
    }
    void this.run(entry)
    return cloneSnapshot(entry.snapshot)
  }

  async uninstall(input: { extensionId: string; sessionId: string }): Promise<unknown> {
    const extensionId = requiredToken(input.extensionId, 'extension_id')
    const sessionId = requiredToken(input.sessionId, 'session_id')
    const agent = this.agents.get(sessionId)
    if (agent === undefined) {
      throw new ArkmePluginError('extension-agent-unavailable', '当前 DSH 会话不可用，请先打开或选择一个会话', false, 409)
    }
    for (const entry of this.tasks.values()) {
      if (!entry.snapshot.done && entry.snapshot.extensionId === extensionId) {
        throw new ArkmePluginError('extension-install-busy', '该扩展正在安装，请先暂停或等待完成', false, 409)
      }
    }
    return await this.manager.uninstall({ agent, extensionId })
  }

  async restart(extensionId: string): Promise<{ restarting: true }> {
    return await this.manager.restartProfileChange(extensionId)
  }

  dispose(): void {
    for (const entry of this.tasks.values()) {
      entry.controller.abort()
      if (entry.cleanup !== undefined) clearTimeout(entry.cleanup)
    }
    this.tasks.clear()
  }

  private async run(entry: InstallTaskEntry): Promise<void> {
    const attempt = entry.attempt
    try {
      const result = await this.manager.apply({
        agent: entry.agent,
        extensionId: entry.snapshot.extensionId,
        ...(entry.version === undefined ? {} : { version: entry.version }),
        signal: entry.controller.signal,
        onProgress: progress => {
          if (attempt === entry.attempt && !entry.pauseRequested) this.update(entry, progress)
        },
      })
      if (attempt !== entry.attempt) return
      const phase = result.active ? 'active' : result.approval_required ? 'awaiting-approval' : result.state === 'failed' ? 'failed' : 'installed'
      this.update(entry, {
        phase,
        version: result.version,
        message: result.message,
      }, true, {
        installed: result.installed,
        active: result.active,
        approvalRequired: result.approval_required,
        restartRequired: result.restart_required,
      }, result.state === 'failed' ? { code: 'extension-apply-failed', message: result.message, retryable: false } : undefined)
    } catch (error) {
      if (attempt !== entry.attempt) return
      if (entry.pauseRequested) {
        this.update(entry, { phase: 'paused', message: '安装已暂停，继续后将重新安全下载制品' })
        return
      }
      const known = error instanceof ArkmePluginError
        ? error
        : new ArkmePluginError('extension-install-failed', error instanceof Error ? error.message : String(error), true, 500)
      this.update(entry, { phase: 'failed', message: known.message }, true, undefined, {
        code: known.code, message: known.message, retryable: known.retryable,
      })
    }
  }

  private ownedTask(taskIdValue: string, sessionIdValue: string): InstallTaskEntry {
    const taskId = requiredToken(taskIdValue, 'task_id')
    const sessionId = requiredToken(sessionIdValue, 'session_id')
    const entry = this.tasks.get(taskId)
    if (entry === undefined || entry.snapshot.sessionId !== sessionId) {
      throw new ArkmePluginError('extension-install-task-not-found', '安装任务不存在或不属于当前会话', false, 404)
    }
    return entry
  }

  private update(
    entry: InstallTaskEntry,
    progress: ArkmeExtensionInstallProgress,
    done = false,
    result?: ArkmeExtensionInstallTaskSnapshot['result'],
    error?: ArkmeExtensionInstallTaskSnapshot['error'],
  ): void {
    entry.snapshot = {
      ...entry.snapshot,
      ...progress,
      done,
      updatedAtMillis: Date.now(),
      ...(result === undefined ? {} : { result }),
      ...(error === undefined ? {} : { error }),
    }
    if (done && entry.cleanup === undefined) {
      entry.cleanup = setTimeout(() => { this.tasks.delete(entry.snapshot.taskId) }, TASK_RETENTION_MILLIS)
      entry.cleanup.unref?.()
    }
  }

  private evictOldestCompletedTask(): void {
    if (this.tasks.size < MAX_RETAINED_TASKS) return
    const completed = [...this.tasks.values()]
      .filter(entry => entry.snapshot.done)
      .sort((left, right) => left.snapshot.updatedAtMillis - right.snapshot.updatedAtMillis)[0]
    if (completed === undefined) {
      throw new ArkmePluginError('extension-install-busy', '当前安装任务过多，请稍后重试', true, 429)
    }
    if (completed.cleanup !== undefined) clearTimeout(completed.cleanup)
    this.tasks.delete(completed.snapshot.taskId)
  }
}

function requiredToken(value: string, label: string): string {
  const normalized = value.trim()
  if (normalized === '' || normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new ArkmePluginError('extension-install-param-invalid', `${label}无效`, false, 400)
  }
  return normalized
}

function cloneSnapshot(snapshot: ArkmeExtensionInstallTaskSnapshot): ArkmeExtensionInstallTaskSnapshot {
  return {
    ...snapshot,
    ...(snapshot.result === undefined ? {} : { result: { ...snapshot.result } }),
    ...(snapshot.error === undefined ? {} : { error: { ...snapshot.error } }),
  }
}
