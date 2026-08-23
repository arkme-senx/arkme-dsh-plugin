import { useCallback, useEffect, useRef, useState } from 'react'

export interface SingleAudioPlaybackDependencies {
  fetchMedia?(mediaRef: string, signal: AbortSignal): Promise<Blob>
  createObjectUrl?(blob: Blob): string
  revokeObjectUrl?(url: string): void
  createAudio?(url: string): HTMLAudioElement
}

export interface SingleAudioPlayback {
  activeSegmentRef: string | undefined
  loadingSegmentRef: string | undefined
  errors: Readonly<Record<string, string>>
  toggle(segmentRef: string, mediaRef: string): Promise<void>
  stop(): void
}

interface ActivePlayback {
  owner: symbol
  generation: number
  segmentRef: string
  controller: AbortController
  audio?: HTMLAudioElement
  objectUrl?: string
}

interface GlobalPlaybackLease {
  playback: ActivePlayback
  stop(): void
}

let globalPlaybackLease: GlobalPlaybackLease | undefined

interface PlaybackState {
  activeSegmentRef: string | undefined
  loadingSegmentRef: string | undefined
  errors: Record<string, string>
}

const initialState = (): PlaybackState => ({ activeSegmentRef: undefined, loadingSegmentRef: undefined, errors: {} })

async function defaultFetchMedia(mediaRef: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(`/arkme-self/api/media?ref=${encodeURIComponent(mediaRef)}`, { signal })
  if (!response.ok) throw new Error(`media response ${String(response.status)}`)
  return await response.blob()
}

function resetAudio(audio: HTMLAudioElement): void {
  audio.onended = null
  audio.onerror = null
  audio.pause()
  try { audio.currentTime = 0 } catch {}
}

/** Owns the only Audio instance allowed for one mounted candidate detail. */
export function useSingleAudioPlayback(
  identityKey: string,
  dependencies: SingleAudioPlaybackDependencies = {},
): SingleAudioPlayback {
  const [state, setState] = useState<PlaybackState>(initialState)
  const activeRef = useRef<ActivePlayback>()
  const ownerRef = useRef(Symbol(identityKey))
  const generationRef = useRef(0)
  const mountedRef = useRef(true)
  const dependenciesRef = useRef(dependencies)
  dependenciesRef.current = dependencies

  const release = useCallback((playback: ActivePlayback | undefined, updateState: boolean) => {
    if (playback === undefined) return
    playback.controller.abort()
    if (playback.audio !== undefined) resetAudio(playback.audio)
    if (playback.objectUrl !== undefined) {
      const revoke = dependenciesRef.current.revokeObjectUrl ?? URL.revokeObjectURL.bind(URL)
      revoke(playback.objectUrl)
    }
    if (globalPlaybackLease?.playback === playback) globalPlaybackLease = undefined
    if (activeRef.current === playback) activeRef.current = undefined
    if (updateState && mountedRef.current) {
      setState(current => ({ ...current, activeSegmentRef: undefined, loadingSegmentRef: undefined }))
    }
  }, [])

  const stop = useCallback(() => {
    generationRef.current += 1
    release(activeRef.current, true)
  }, [release])

  useEffect(() => {
    mountedRef.current = true
    generationRef.current += 1
    release(activeRef.current, false)
    setState(initialState())
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      release(activeRef.current, false)
    }
  }, [identityKey, release])

  const toggle = useCallback(async (segmentRef: string, mediaRef: string): Promise<void> => {
    const normalizedSegmentRef = segmentRef.trim()
    const normalizedMediaRef = mediaRef.trim()
    if (normalizedSegmentRef === '' || normalizedMediaRef === '') return
    const current = activeRef.current
    if (current?.segmentRef === normalizedSegmentRef) {
      stop()
      return
    }

    if (globalPlaybackLease !== undefined && globalPlaybackLease.playback.owner !== ownerRef.current) {
      globalPlaybackLease.stop()
    }
    generationRef.current += 1
    release(current, false)
    const generation = generationRef.current
    const playback: ActivePlayback = {
      owner: ownerRef.current,
      generation,
      segmentRef: normalizedSegmentRef,
      controller: new AbortController(),
    }
    activeRef.current = playback
    globalPlaybackLease = {
      playback,
      stop: () => {
        if (activeRef.current !== playback) return
        generationRef.current += 1
        release(playback, true)
      },
    }
    setState(previous => {
      const errors = { ...previous.errors }
      delete errors[normalizedSegmentRef]
      return { errors, activeSegmentRef: undefined, loadingSegmentRef: normalizedSegmentRef }
    })

    try {
      const configured = dependenciesRef.current
      const blob = await (configured.fetchMedia ?? defaultFetchMedia)(normalizedMediaRef, playback.controller.signal)
      if (playback.controller.signal.aborted || generationRef.current !== generation || activeRef.current !== playback) return
      const objectUrl = (configured.createObjectUrl ?? URL.createObjectURL.bind(URL))(blob)
      playback.objectUrl = objectUrl
      const audio = (configured.createAudio ?? (url => new Audio(url)))(objectUrl)
      playback.audio = audio
      audio.onended = () => {
        if (activeRef.current !== playback) return
        release(playback, false)
        if (mountedRef.current) {
          setState(previous => ({ ...previous, activeSegmentRef: undefined, loadingSegmentRef: undefined }))
        }
      }
      audio.onerror = () => {
        if (activeRef.current !== playback) return
        release(playback, false)
        if (mountedRef.current) {
          setState(previous => ({
            ...previous,
            activeSegmentRef: undefined,
            loadingSegmentRef: undefined,
            errors: { ...previous.errors, [normalizedSegmentRef]: '声音播放失败，请重试' },
          }))
        }
      }
      await audio.play()
      if (playback.controller.signal.aborted || generationRef.current !== generation || activeRef.current !== playback) return
      if (mountedRef.current) {
        setState(previous => ({ ...previous, activeSegmentRef: normalizedSegmentRef, loadingSegmentRef: undefined }))
      }
    } catch (error) {
      if (playback.controller.signal.aborted || generationRef.current !== generation || activeRef.current !== playback) return
      release(playback, false)
      if (mountedRef.current) {
        setState(previous => ({
          ...previous,
          activeSegmentRef: undefined,
          loadingSegmentRef: undefined,
          errors: { ...previous.errors, [normalizedSegmentRef]: '声音加载失败，请重试' },
        }))
      }
    }
  }, [release, stop])

  return {
    activeSegmentRef: state.activeSegmentRef,
    loadingSegmentRef: state.loadingSegmentRef,
    errors: state.errors,
    toggle,
    stop,
  }
}
