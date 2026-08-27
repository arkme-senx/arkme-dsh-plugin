import { useCallback, useEffect, useRef, useState } from 'react'
import { Pause } from '@phosphor-icons/react/dist/icons/Pause'
import { Play } from '@phosphor-icons/react/dist/icons/Play'
import { SpinnerGap } from '@phosphor-icons/react/dist/icons/SpinnerGap'
import type { ArkmeUnmarkedSpeakerSegment, ArkmeUnmarkedSpeakerSegmentPage } from '../../../types.js'
import { callArkme } from '../../api.js'
import {
  useSingleAudioPlayback,
  type SingleAudioPlaybackDependencies,
} from './useSingleAudioPlayback.js'
import { UnmarkedSpeakerLinearIcon } from './UnmarkedSpeakerVisuals.js'

export type UnmarkedSpeakerSegmentLoader = (
  candidateRef: string,
  options: { limit: number; cursor?: string },
  signal: AbortSignal,
) => Promise<ArkmeUnmarkedSpeakerSegmentPage>

export interface UnmarkedSpeakerAudioListProps {
  accountKey: string
  candidateRef: string
  onBack(): void
  loadSegments?: UnmarkedSpeakerSegmentLoader
  playbackDependencies?: SingleAudioPlaybackDependencies
}

const defaultLoadSegments: UnmarkedSpeakerSegmentLoader = async (candidateRef, options, signal) => await callArkme(
  'unmarked-speakers.segments',
  { candidateRef, limit: options.limit, ...(options.cursor === undefined ? {} : { cursor: options.cursor }) },
  signal,
)

function message(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : '声音片段加载失败'
}

function mergeSegments(
  existing: readonly ArkmeUnmarkedSpeakerSegment[],
  incoming: readonly ArkmeUnmarkedSpeakerSegment[],
): ArkmeUnmarkedSpeakerSegment[] {
  const result = [...existing]
  const indexes = new Map(result.map((item, index) => [item.segmentRef, index]))
  for (const item of incoming) {
    const index = indexes.get(item.segmentRef)
    if (index === undefined) {
      indexes.set(item.segmentRef, result.length)
      result.push(item)
    } else {
      result[index] = item
    }
  }
  return result
}

interface SegmentListState {
  identity: string
  items: ArkmeUnmarkedSpeakerSegment[]
  loading: boolean
  error: string | undefined
  hasMore: boolean
  nextCursor: string | undefined
}

function emptySegmentListState(identity: string, loading = false): SegmentListState {
  return { identity, items: [], loading, error: undefined, hasMore: false, nextCursor: undefined }
}

function durationLabel(durationMillis: number): string {
  const seconds = Math.max(0, Math.round(durationMillis / 1_000))
  return `${String(seconds)} 秒`
}

export function UnmarkedSpeakerAudioList({
  accountKey,
  candidateRef,
  onBack,
  loadSegments = defaultLoadSegments,
  playbackDependencies,
}: UnmarkedSpeakerAudioListProps) {
  const identity = `${accountKey}:${candidateRef}`
  const playback = useSingleAudioPlayback(identity, playbackDependencies)
  const [storedState, setStoredState] = useState<SegmentListState>(() => emptySegmentListState(identity, true))
  const state = storedState.identity === identity ? storedState : emptySegmentListState(identity, true)
  const stateRef = useRef(state)
  stateRef.current = state
  const controllerRef = useRef<AbortController>()
  const generationRef = useRef(0)
  const activeIdentityRef = useRef(identity)
  activeIdentityRef.current = identity

  const requestPage = useCallback(function requestPage(
    mode: 'replace' | 'append',
    cursor?: string,
  ): void {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const generation = generationRef.current + 1
    generationRef.current = generation
    const requestIdentity = identity
    setStoredState(current => {
      if (mode === 'replace' || current.identity !== requestIdentity) {
        return emptySegmentListState(requestIdentity, true)
      }
      return { ...current, loading: true, error: undefined }
    })
    void loadSegments(candidateRef, {
      limit: 20,
      ...(mode === 'append' && cursor !== undefined ? { cursor } : {}),
    }, controller.signal).then(page => {
      if (controller.signal.aborted || activeIdentityRef.current !== requestIdentity
        || generationRef.current !== generation) return
      if (mode === 'append' && page.cursorStale === true) {
        setStoredState(emptySegmentListState(requestIdentity, true))
        requestPage('replace')
        return
      }
      setStoredState(current => {
        if (current.identity !== requestIdentity) return current
        return {
          identity: requestIdentity,
          items: mode === 'append' ? mergeSegments(current.items, page.items) : [...page.items],
          loading: false,
          error: undefined,
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
        }
      })
    }).catch(reason => {
      if (controller.signal.aborted || activeIdentityRef.current !== requestIdentity
        || generationRef.current !== generation) return
      setStoredState(current => current.identity === requestIdentity
        ? { ...current, loading: false, error: message(reason) }
        : current)
    })
  }, [candidateRef, identity, loadSegments])

  useEffect(() => {
    requestPage('replace')
    return () => {
      generationRef.current += 1
      controllerRef.current?.abort()
    }
  }, [identity, requestPage])

  return <section className="arkme-unmarked-speaker-audio" aria-label="声音片段">
    <header className="arkme-unmarked-speaker-subview-header">
      <button type="button" onClick={onBack}>返回候选摘要</button>
      <span className="arkme-unmarked-speaker-action-icon"><UnmarkedSpeakerLinearIcon kind="sound" /></span>
      <div className="arkme-unmarked-speaker-subview-heading">
        <h2>声音片段</h2>
        <p>试听相关片段，确认这是谁的声音</p>
      </div>
    </header>
    {state.loading && state.items.length === 0 && <div role="status">正在加载声音片段…</div>}
    {state.error !== undefined && <div role="alert">{state.error}</div>}
    {!state.loading && state.items.length === 0 && state.error === undefined && <p>暂无可听声音片段</p>}
    <div className="arkme-unmarked-speaker-segment-list" role="list">
      {state.items.map(item => {
        const active = playback.activeSegmentRef === item.segmentRef
        const itemLoading = playback.loadingSegmentRef === item.segmentRef
        const mediaRef = item.mediaRef?.trim() ?? ''
        const controlState = itemLoading ? 'loading' : mediaRef === '' ? 'unavailable' : active ? 'pause' : 'play'
        const controlLabel = active ? '暂停' : itemLoading ? '正在加载' : mediaRef === '' ? '声音不可播放' : '播放'
        return <article className="arkme-unmarked-speaker-segment-card" key={item.segmentRef} role="listitem">
          <div className="arkme-unmarked-speaker-segment-meta">{item.date} · {item.sessionLabel} · {item.timeRange} · {durationLabel(item.durationMillis)}</div>
          <p className="arkme-unmarked-speaker-segment-transcript">{item.transcript}</p>
          <button
            type="button"
            className="arkme-unmarked-speaker-segment-play"
            disabled={mediaRef === '' || itemLoading}
            aria-label={`${controlLabel} ${item.date} ${item.sessionLabel} ${item.timeRange}`}
            title={controlLabel}
            onClick={() => { void playback.toggle(item.segmentRef, mediaRef) }}
          >{controlState === 'pause'
              ? <Pause aria-hidden data-audio-state-icon="pause" size={18} weight="fill" />
              : controlState === 'loading'
                ? <SpinnerGap aria-hidden className="arkme-icon-spin" data-audio-state-icon="loading" size={18} weight="bold" />
                : <Play aria-hidden data-audio-state-icon={controlState} size={18} weight="fill" />}</button>
          {playback.errors[item.segmentRef] !== undefined && <div role="alert">{playback.errors[item.segmentRef]}</div>}
        </article>
      })}
    </div>
    {state.hasMore && <button
      type="button"
      disabled={state.loading}
      onClick={() => {
        if (!stateRef.current.loading && stateRef.current.nextCursor !== undefined) {
          requestPage('append', stateRef.current.nextCursor)
        }
      }}
    >
      {state.loading ? '正在加载…' : '加载更多声音'}
    </button>}
  </section>
}
