import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ArkmeUnmarkedSpeakerInference,
  ArkmeUnmarkedSpeakerInferenceRetry,
  ArkmeUnmarkedSpeakerMarkResult,
  ArkmeUnmarkedSpeakerOptions,
} from '../../../types.js'
import { callArkme } from '../../api.js'
import {
  SpeakerChoicePanel,
  type SpeakerMarkTarget,
} from './SpeakerChoicePanel.js'
import {
  UnmarkedSpeakerAudioList,
  type UnmarkedSpeakerAudioListProps,
  type UnmarkedSpeakerSegmentLoader,
} from './UnmarkedSpeakerAudioList.js'
import { UnmarkedSpeakerLinearIcon, UnmarkedSpeakerTokenAvatar } from './UnmarkedSpeakerVisuals.js'

export type UnmarkedSpeakerSubview = 'summary' | 'audio' | 'choice' | 'success'
export type UnmarkedSpeakerOptionsLoader = (
  candidateRef: string,
  signal: AbortSignal,
) => Promise<ArkmeUnmarkedSpeakerOptions & { retryAfterMillis?: number }>
export type UnmarkedSpeakerInferenceRetryer = (
  candidateRef: string,
  signal: AbortSignal,
) => Promise<ArkmeUnmarkedSpeakerInferenceRetry>
export type UnmarkedSpeakerMarker = (
  input: { candidateRef: string; candidateVersion: string; speakerRef?: string; newSpeakerName?: string },
  signal: AbortSignal,
) => Promise<ArkmeUnmarkedSpeakerMarkResult>

export interface UnmarkedSpeakerDetailProps {
  accountKey: string
  candidateRef: string
  onDirectoryRefresh(): void
  onCandidateCleared(): void
  loadOptions?: UnmarkedSpeakerOptionsLoader
  retryInference?: UnmarkedSpeakerInferenceRetryer
  loadSegments?: UnmarkedSpeakerSegmentLoader
  markSpeaker?: UnmarkedSpeakerMarker
  playbackDependencies?: UnmarkedSpeakerAudioListProps['playbackDependencies']
}

const defaultLoadOptions: UnmarkedSpeakerOptionsLoader = async (candidateRef, signal) => await callArkme(
  'unmarked-speakers.options', { candidateRef }, signal,
)
const defaultRetryInference: UnmarkedSpeakerInferenceRetryer = async (candidateRef, signal) => await callArkme(
  'unmarked-speakers.retry-inference', { candidateRef }, signal,
)
const defaultMarkSpeaker: UnmarkedSpeakerMarker = async (input, signal) => await callArkme(
  'unmarked-speakers.mark', input, signal,
)

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : fallback
}

export function clampInferencePollDelay(value: number): number {
  if (!Number.isFinite(value)) return 1_000
  return Math.min(30_000, Math.max(1_000, Math.trunc(value)))
}

function scheduledPollDelay(completedPolls: number): number {
  if (completedPolls < 5) return 2_000
  if (completedPolls < 11) return 5_000
  return 10_000
}

function mergeInference(
  previous: ArkmeUnmarkedSpeakerInference | undefined,
  next: ArkmeUnmarkedSpeakerInference,
): ArkmeUnmarkedSpeakerInference {
  if (next.state !== 'pending' && !(next.state === 'failed' && next.retryable === true)) return next
  return {
    ...next,
    ...(next.recommendedSpeakerRef === undefined && previous?.recommendedSpeakerRef !== undefined
      ? { recommendedSpeakerRef: previous.recommendedSpeakerRef } : {}),
    ...(next.recommendedDisplayName === undefined && previous?.recommendedDisplayName !== undefined
      ? { recommendedDisplayName: previous.recommendedDisplayName } : {}),
  }
}

function mergeOptions(
  previous: ArkmeUnmarkedSpeakerOptions | undefined,
  next: ArkmeUnmarkedSpeakerOptions,
): ArkmeUnmarkedSpeakerOptions {
  return { ...next, inference: mergeInference(previous?.inference, next.inference) }
}

function inferencePresentation(inference: ArkmeUnmarkedSpeakerInference | undefined): string {
  if (inference === undefined) return '正在加载'
  if (inference.recommendedDisplayName !== undefined) {
    const suffix = inference.state === 'pending' ? '（正在更新）'
      : inference.state === 'failed' ? '（推测失败）' : ''
    return `${inference.recommendedDisplayName}${suffix}`
  }
  switch (inference.state) {
    case 'ready': return '未找到明确推荐'
    case 'pending': return '正在推测'
    case 'failed': return '推测失败'
    case 'unavailable': return '暂不可用'
  }
}

function durationPresentation(durationMillis: number): string {
  const seconds = Math.max(0, Math.round(durationMillis / 1_000))
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes === 0) return `${String(seconds)} 秒`
  return rest === 0 ? `${String(minutes)} 分钟` : `${String(minutes)} 分 ${String(rest)} 秒`
}

function latestPresentation(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value)).replaceAll('/', '.')
}

function isCandidateNotFound(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  const source = error as { code?: unknown; body?: { code?: unknown } }
  return source.code === 'unmarked-candidate-not-found'
    || source.body?.code === 'unmarked-candidate-not-found'
}

interface IdentityOptionsState {
  identity: string
  value: ArkmeUnmarkedSpeakerOptions | undefined
}

export function UnmarkedSpeakerDetail({
  accountKey,
  candidateRef,
  onDirectoryRefresh,
  onCandidateCleared,
  loadOptions = defaultLoadOptions,
  retryInference = defaultRetryInference,
  loadSegments,
  markSpeaker = defaultMarkSpeaker,
  playbackDependencies,
}: UnmarkedSpeakerDetailProps) {
  const identity = `${accountKey}:${candidateRef}`
  const [stateIdentity, setStateIdentity] = useState(identity)
  const identityIsCurrent = stateIdentity === identity
  const [view, setView] = useState<UnmarkedSpeakerSubview>('summary')
  const visibleView: UnmarkedSpeakerSubview = identityIsCurrent ? view : 'summary'
  const [optionsState, setOptionsState] = useState<IdentityOptionsState>(() => ({ identity, value: undefined }))
  const options = optionsState.identity === identity ? optionsState.value : undefined
  const optionsRef = useRef<ArkmeUnmarkedSpeakerOptions>()
  optionsRef.current = options
  const [optionsLoading, setOptionsLoading] = useState(true)
  const [optionsError, setOptionsError] = useState<string>()
  const [inferenceRetryBusy, setInferenceRetryBusy] = useState(false)
  const [inferenceError, setInferenceError] = useState<string>()
  const [markBusy, setMarkBusy] = useState(false)
  const markBusyRef = useRef(false)
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const recoveryBusyRef = useRef(false)
  const [markError, setMarkError] = useState<string>()
  const [candidateGone, setCandidateGone] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const identityRef = useRef(identity)
  identityRef.current = identity
  const retryControllerRef = useRef<AbortController>()
  const markControllerRef = useRef<AbortController>()
  const missingCandidateIdentityRef = useRef<string>()

  const stopForMissingCandidate = useCallback((requestIdentity: string) => {
    if (identityRef.current !== requestIdentity || missingCandidateIdentityRef.current === requestIdentity) return
    missingCandidateIdentityRef.current = requestIdentity
    retryControllerRef.current?.abort()
    markControllerRef.current?.abort()
    markBusyRef.current = false
    recoveryBusyRef.current = false
    setMarkBusy(false)
    setRecoveryBusy(false)
    setCandidateGone(true)
    setOptionsState({ identity: requestIdentity, value: undefined })
    setMarkError('候选已不存在，正在刷新列表')
    onCandidateCleared()
    onDirectoryRefresh()
  }, [onCandidateCleared, onDirectoryRefresh])

  useEffect(() => {
    setStateIdentity(identity)
    setView('summary')
    setOptionsState({ identity, value: undefined })
    setOptionsLoading(true)
    setOptionsError(undefined)
    setInferenceRetryBusy(false)
    setInferenceError(undefined)
    markBusyRef.current = false
    recoveryBusyRef.current = false
    setMarkBusy(false)
    setRecoveryBusy(false)
    setMarkError(undefined)
    setCandidateGone(false)
    retryControllerRef.current?.abort()
    markControllerRef.current?.abort()
  }, [identity])

  useEffect(() => {
    let active = true
    let completedPolls = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    const requestIdentity = identity

    const load = () => {
      controller?.abort()
      controller = new AbortController()
      setOptionsLoading(true)
      void loadOptions(candidateRef, controller.signal).then(response => {
        if (!active || controller?.signal.aborted === true || identityRef.current !== requestIdentity) return
        setOptionsState(current => ({
          identity: requestIdentity,
          value: mergeOptions(current.identity === requestIdentity ? current.value : undefined, response),
        }))
        setOptionsLoading(false)
        setOptionsError(undefined)
        if (recoveryBusyRef.current) {
          recoveryBusyRef.current = false
          markBusyRef.current = false
          setRecoveryBusy(false)
          setMarkError(undefined)
        }
        if (response.inference.state === 'pending') {
          const serverDelay = response.retryAfterMillis
          const delay = serverDelay === undefined
            ? scheduledPollDelay(completedPolls)
            : clampInferencePollDelay(serverDelay)
          timer = setTimeout(() => {
            completedPolls += 1
            load()
          }, delay)
        }
      }).catch(error => {
        if (!active || controller?.signal.aborted === true || identityRef.current !== requestIdentity) return
        if (isCandidateNotFound(error)) {
          stopForMissingCandidate(requestIdentity)
          return
        }
        setOptionsLoading(false)
        setOptionsError(errorMessage(error, '候选详情加载失败'))
        if (recoveryBusyRef.current) {
          recoveryBusyRef.current = false
          markBusyRef.current = false
          setRecoveryBusy(false)
        }
      })
    }
    load()
    return () => {
      active = false
      if (timer !== undefined) clearTimeout(timer)
      controller?.abort()
    }
  }, [candidateRef, identity, loadOptions, reloadToken, stopForMissingCandidate])

  useEffect(() => () => {
    retryControllerRef.current?.abort()
    markControllerRef.current?.abort()
  }, [])

  const reloadOptions = useCallback(() => {
    setOptionsError(undefined)
    setReloadToken(value => value + 1)
  }, [])

  const beginRecovery = useCallback((message: string) => {
    markBusyRef.current = true
    recoveryBusyRef.current = true
    setMarkBusy(false)
    setRecoveryBusy(true)
    setMarkError(message)
    setOptionsState({ identity, value: undefined })
    reloadOptions()
  }, [identity, reloadOptions])

  const retryRecovery = useCallback(() => {
    markBusyRef.current = true
    recoveryBusyRef.current = true
    setRecoveryBusy(true)
    reloadOptions()
  }, [reloadOptions])

  const retry = () => {
    if (inferenceRetryBusy || candidateGone) return
    retryControllerRef.current?.abort()
    const controller = new AbortController()
    retryControllerRef.current = controller
    const requestIdentity = identity
    setInferenceRetryBusy(true)
    setInferenceError(undefined)
    void retryInference(candidateRef, controller.signal).then(result => {
      if (controller.signal.aborted || identityRef.current !== requestIdentity) return
      setInferenceRetryBusy(false)
      setOptionsState(current => current.identity !== requestIdentity || current.value === undefined ? current : {
        identity: requestIdentity,
        value: { ...current.value, inference: mergeInference(current.value.inference, result.inference) },
      })
      if (result.inference.state === 'pending') reloadOptions()
    }).catch(error => {
      if (controller.signal.aborted || identityRef.current !== requestIdentity) return
      setInferenceRetryBusy(false)
      setInferenceError(errorMessage(error, '重新推测失败，请重试'))
    })
  }

  const submit = (target: SpeakerMarkTarget) => {
    const current = optionsRef.current
    if (current === undefined || markBusyRef.current || candidateGone) return
    markBusyRef.current = true
    setMarkBusy(true)
    setMarkError(undefined)
    markControllerRef.current?.abort()
    const controller = new AbortController()
    markControllerRef.current = controller
    const requestIdentity = identity
    const input = {
      candidateRef,
      candidateVersion: current.candidateVersion,
      ...(target.mode === 'existing' ? { speakerRef: target.speakerRef } : { newSpeakerName: target.newSpeakerName }),
    }
    void markSpeaker(input, controller.signal).then(result => {
      if (controller.signal.aborted || identityRef.current !== requestIdentity) return
      switch (result.outcome) {
        case 'marked':
          markBusyRef.current = false
          setMarkBusy(false)
          setView('success')
          onDirectoryRefresh()
          return
        case 'stale':
          beginRecovery('候选版本已过期，请重新选择说话人')
          return
        case 'conflict':
          beginRecovery('部分片段已被其他操作标记，请刷新后重新选择说话人')
          return
        case 'candidate_not_found':
          stopForMissingCandidate(requestIdentity)
          return
        case 'speaker_not_found':
          beginRecovery('说话人已不存在，请重新选择')
      }
    }).catch(error => {
      if (controller.signal.aborted || identityRef.current !== requestIdentity) return
      markBusyRef.current = false
      setMarkBusy(false)
      setMarkError(errorMessage(error, '标记失败，请重试'))
    })
  }

  if (identityIsCurrent && candidateGone) {
    return <section className="arkme-unmarked-speaker-gone" aria-label="未标记说话人候选">
      <div role="status">{markError ?? '候选已不存在，正在刷新列表'}</div>
    </section>
  }
  if (visibleView === 'audio') {
    return <UnmarkedSpeakerAudioList
      accountKey={accountKey}
      candidateRef={candidateRef}
      onBack={() => { setView('summary') }}
      {...(loadSegments === undefined ? {} : { loadSegments })}
      {...(playbackDependencies === undefined ? {} : { playbackDependencies })}
    />
  }
  if (visibleView === 'choice') {
    return <SpeakerChoicePanel
      key={identity}
      identityKey={identity}
      options={options}
      loading={identityIsCurrent ? optionsLoading : true}
      busy={identityIsCurrent && markBusy}
      recovering={identityIsCurrent && recoveryBusy}
      {...(!identityIsCurrent || markError === undefined ? {} : { error: markError })}
      onBack={() => { setView('summary') }}
      onReload={markError === undefined ? reloadOptions : retryRecovery}
      onSubmit={submit}
    />
  }
  if (visibleView === 'success') {
    return <section className="arkme-unmarked-speaker-success" aria-label="标记成功">
      <h2>标记成功</h2>
      <p>说话人已标记，联系人目录正在刷新。</p>
    </section>
  }

  const speakerToken = options?.speakerToken?.trim() || '…'

  return <section className="arkme-unmarked-speaker-summary" aria-label="未标记说话人候选摘要">
    <header className="arkme-unmarked-speaker-identity">
      <UnmarkedSpeakerTokenAvatar
        token={speakerToken}
        size={64}
        label={`${options === undefined ? '未标记说话人' : `说话人 ${speakerToken}`}的头像`}
      />
      <div>
        <h1>{options === undefined ? '未标记说话人' : `说话人 ${speakerToken}`}</h1>
        <p>最近：{options === undefined ? '正在加载…' : latestPresentation(options.latestAtMillis)}</p>
      </div>
    </header>
    {options !== undefined && <div className="arkme-unmarked-speaker-stats" aria-label="说话人统计">
      <span>出现 <strong>{options.appearanceDays}</strong> 天</span>
      <span>有效声音 <strong>{durationPresentation(options.validAudioDurationMillis)}</strong></span>
      <span>相关片段 <strong>{options.segmentCount}</strong> 个</span>
    </div>}
    <div className="arkme-unmarked-speaker-inference">
      <span className="arkme-unmarked-speaker-inference-icon"><UnmarkedSpeakerLinearIcon kind="search" /></span>
      <div>
        <span className="arkme-unmarked-speaker-inference-label">推测说话人</span>
        <strong>{inferencePresentation(options?.inference)}</strong>
        {options?.conversationSummary !== undefined && <p>{options.conversationSummary}</p>}
      </div>
    </div>
    {(identityIsCurrent ? optionsLoading : true) && options === undefined && <div role="status">正在加载候选详情…</div>}
    {identityIsCurrent && optionsError !== undefined && <div role="alert">{optionsError}</div>}
    {identityIsCurrent && inferenceError !== undefined && <div role="alert">{inferenceError}</div>}
    {options?.inference.retryable === true && <button
      type="button"
      disabled={inferenceRetryBusy}
      onClick={retry}
    >{inferenceRetryBusy ? '正在重新推测…' : '重新推测'}</button>}
    <div className="arkme-unmarked-speaker-actions">
      <button type="button" className="arkme-unmarked-speaker-action" onClick={() => { setView('audio') }}>
        <span className="arkme-unmarked-speaker-action-icon"><UnmarkedSpeakerLinearIcon kind="sound" /></span>
        <span>去听声音</span>
      </button>
      <button type="button" className="arkme-unmarked-speaker-action" onClick={() => { setView('choice') }}>
        <span className="arkme-unmarked-speaker-action-icon"><UnmarkedSpeakerLinearIcon kind="profile" /></span>
        <span>选择说话人</span>
      </button>
    </div>
    {identityIsCurrent && optionsError !== undefined && <button type="button" onClick={reloadOptions}>重试候选详情</button>}
  </section>
}
