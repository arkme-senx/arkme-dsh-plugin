import { useCallback, useMemo, useSyncExternalStore, type CSSProperties } from 'react'
import type { ArkmeRecordInputCaptureOwner } from './record-input-capture.js'

export interface ArkmeBackgroundSoundWaveformProps {
  owner: ArkmeRecordInputCaptureOwner
  draftKey: string | undefined
  className?: string
  style?: CSSProperties
}

const shellStyle: CSSProperties = {
  position: 'absolute',
  left: 13,
  bottom: 0,
  zIndex: 1,
  width: 85,
  height: 11,
  display: 'flex',
  alignItems: 'flex-end',
  overflow: 'hidden',
  color: 'var(--dsw-alias-label-primary, #1d2028)',
  pointerEvents: 'none',
}

function visualLevels(amplitudes: readonly number[]): readonly number[] {
  const visible = amplitudes.slice(-40).map(value => {
    const normalized = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
    return Math.sqrt(normalized)
  })
  return visible.length === 40 ? visible : [...visible, ...Array.from({ length: 40 - visible.length }, () => 0)]
}

/** Subscribes only to the owner's compact waveform channel, not the composer draft. */
export function ArkmeBackgroundSoundWaveform({
  owner,
  draftKey,
  className,
  style,
}: ArkmeBackgroundSoundWaveformProps) {
  const subscribe = useCallback(
    (listener: () => void) => owner.subscribeWaveform(draftKey, listener),
    [draftKey, owner],
  )
  const getSnapshot = useCallback(
    () => owner.getWaveformSnapshot(draftKey),
    [draftKey, owner],
  )
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const levels = useMemo(() => visualLevels(snapshot.amplitudes), [snapshot.amplitudes])
  if (!snapshot.visible) return null

  return <div
    className={className}
    style={{ ...shellStyle, ...style }}
    role="status"
    aria-live="off"
    aria-label={snapshot.recording ? '正在记录环境声音' : '正在准备录音'}
    data-arkme-background-sound-waveform
  >
    {levels.map((level, index) => <span
      // The index is stable inside the capped rolling window and carries no business identity.
      key={index}
      aria-hidden
      style={{
        width: 1,
        height: 11 * level,
        flex: '0 0 1px',
        marginRight: 1,
        background: 'linear-gradient(to bottom, transparent 15%, currentColor 99.5%)',
        opacity: 0.28,
        transition: 'height 200ms linear',
      }}
    />)}
  </div>
}
