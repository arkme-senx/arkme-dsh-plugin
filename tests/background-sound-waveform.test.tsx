import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import { ArkmeBackgroundSoundWaveform } from '../src/client/ArkmeBackgroundSoundWaveform.js'
import {
  ArkmeRecordInputCaptureOwner,
  type ArkmeBackgroundSoundRecorder,
  type ArkmeBackgroundSoundRecorderSegment,
} from '../src/client/record-input-capture.js'

class WaveformRecorder implements ArkmeBackgroundSoundRecorder {
  private readonly listeners = new Set<(value: number) => void>()

  async start(): Promise<void> {}
  async stop(): Promise<ArkmeBackgroundSoundRecorderSegment> {
    return {
      blob: new Blob(['audio'], { type: 'audio/webm' }),
      fileName: 'audio.webm',
      mimeType: 'audio/webm',
      durationMillis: 1,
    }
  }
  async cancel(): Promise<void> {}
  async dispose(): Promise<void> {}
  subscribeAmplitude(listener: (value: number) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  emit(value: number): void { for (const listener of this.listeners) listener(value) }
}

describe('ArkmeBackgroundSoundWaveform', () => {
  let renderer: ReactTestRenderer | undefined
  let owner: ArkmeRecordInputCaptureOwner | undefined

  afterEach(async () => {
    await act(async () => {
      renderer?.unmount()
      await owner?.dispose()
    })
    renderer = undefined
    owner = undefined
  })

  it('renders from the lightweight waveform channel and hides when the draft deactivates', async () => {
    const recorder = new WaveformRecorder()
    owner = new ArkmeRecordInputCaptureOwner({
      accountId: 1,
      recorder,
      backgroundSoundEnabled: () => true,
      subscribeBackgroundSoundPreference: () => () => undefined,
      startDelayMillis: 0,
      operationTimeoutMillis: 100,
    })
    renderer = create(<ArkmeBackgroundSoundWaveform owner={owner} draftKey="draft-a" />)
    expect(renderer.toJSON()).toBeNull()

    await act(async () => {
      owner!.sync({ draftKey: 'draft-a', isActive: true, hasUserContent: true })
      await new Promise(resolve => { setTimeout(resolve, 5) })
    })
    const waveform = renderer.root.findByProps({ 'data-arkme-background-sound-waveform': true })
    expect(waveform.props['aria-label']).toBe('正在记录环境声音')
    expect(waveform.props.style).toMatchObject({
      position: 'absolute', left: 13, bottom: 0, width: 85, height: 11,
      alignItems: 'flex-end', pointerEvents: 'none',
    })
    expect(JSON.stringify(renderer.toJSON())).not.toContain('背景音')

    await act(async () => { recorder.emit(0.75) })
    const bars = waveform.findAll(node => node.type === 'span' && node.props['aria-hidden'] === true)
    expect(bars).toHaveLength(40)
    expect(bars[0]?.props.style).toMatchObject({
      width: 1, marginRight: 1, opacity: 0.28,
      transition: 'height 200ms linear',
    })
    expect(bars[0]?.props.style.height).toBeCloseTo(11 * Math.sqrt(0.75))
    expect(bars.slice(1).every(bar => bar.props.style.height === 0)).toBe(true)

    await act(async () => { recorder.emit(0.05) })
    expect(bars[1]?.props.style.height).toBeCloseTo(11 * Math.sqrt(0.05))

    await act(async () => {
      recorder.emit(Number.NaN)
      recorder.emit(-1)
      recorder.emit(2)
    })
    expect(bars[2]?.props.style.height).toBe(0)
    expect(bars[3]?.props.style.height).toBe(0)
    expect(bars[4]?.props.style.height).toBe(11)
    expect(owner.getWaveformSnapshot('draft-a').amplitudes).toEqual([0.75, 0.05, 0, 0, 1])

    await act(async () => {
      owner!.sync({ draftKey: 'draft-a', isActive: false, hasUserContent: false })
      await Promise.resolve()
    })
    expect(renderer.toJSON()).toBeNull()
  })

  it('hides after the hard capture limit without adding inline copy', async () => {
    const recorder = new WaveformRecorder()
    owner = new ArkmeRecordInputCaptureOwner({
      accountId: 1,
      recorder,
      backgroundSoundEnabled: () => true,
      subscribeBackgroundSoundPreference: () => () => undefined,
      startDelayMillis: 0,
      maxCaptureDurationMillis: 10,
      operationTimeoutMillis: 100,
    })
    renderer = create(<ArkmeBackgroundSoundWaveform owner={owner} draftKey="draft-limit" />)

    await act(async () => {
      owner!.sync({ draftKey: 'draft-limit', isActive: true, hasUserContent: true })
      await new Promise(resolve => { setTimeout(resolve, 30) })
    })

    expect(renderer.toJSON()).toBeNull()
    expect(renderer.root.findAllByProps({ 'data-arkme-background-sound-waveform': true })).toHaveLength(0)
  })
})
