import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { WorldService } from '../src/services/world-service.js'
import { MediaService } from '../src/services/media-service.js'

it('preserves typed audio, approval status and team identity through the actual World Host feed owner', async () => {
  const uid = `world-sound-${'4'.repeat(64)}`
  const wire = process.env.SOUND_TEST_PUBLICATION_OUTPUT ? JSON.parse(readFileSync(process.env.SOUND_TEST_PUBLICATION_OUTPUT, 'utf8')) : {
    record_uid: uid, principal: { kind: 'team', team_id: 17, name: '团队', jotmo_id: 'fixture-team' }, publisher_user_id: 7,
    record_type: 'sound_excerpt', check_status: 2, headline: '原话', text_content: '原话',
    sound_excerpt: { source: 'recording', revision: 'a'.repeat(64), duration_ms: 1000, segments: [{ text: '原话', speaker: '说话人 1', offset_ms: 0, duration_ms: 1000, omitted_before: false, audio_url: `https://jotmo-world.senguo.me/api/public/v1/public-record/media?record_uid=${uid}&version=${'c'.repeat(64)}&kind=sound&index=0` }] },
  }
  const runtime = {
    config: { environment: 'test', worldBaseUrl: new URL(wire.sound_excerpt.segments[0].audio_url).origin, routePath: '/arkme-self' },
    stateStore: { uniqueCode: async () => 'isolated-fixture-secret' }, requireSession: async () => ({ userId: 42 }),
    post: vi.fn(async () => ({ items: [wire], has_more: false })),
    authenticatedAuthPost: vi.fn(async () => ({ items: [{ user_id: 7, nickname: '发布者' }] })),
  }
  const media = new MediaService(runtime as never, {} as never, {} as never, {} as never)
  const world = new WorldService(runtime as never, {} as never, media, {} as never)
  try {
    const page = await world.listMixedFeed()
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({ recordType: 'sound_excerpt', soundStatus: 'published', teamAuthor: { name: '团队', jotmoId: 'fixture-team' }, soundExcerpt: { source: 'recording', durationMillis: 1000, segments: [{ text: '原话' }] } })
    expect(page.items[0]!.soundExcerpt!.segments[0]!.audioUrl).toMatch(/^\/arkme-self\/media\?ref=arkme-media-v1/)
    expect(JSON.stringify(page)).not.toContain('world-excerpts/')
    expect(JSON.stringify(page)).not.toContain('audio_owner')
  } finally { world.dispose(); media.dispose() }
})
