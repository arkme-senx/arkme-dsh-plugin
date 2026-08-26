import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { hits, notes, source } from './data.js'
import { syntheticAac } from './aac.js'

// Synthetic, local-only data. This harness never connects to an Arkme backend.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: { host: '127.0.0.1', fs: { allow: [fileURLToPath(new URL('../../..', import.meta.url))] } },
  plugins: [{
    name: 'voice-parity-fixtures',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url?.startsWith('/arkme-self/api/media?')) {
          if (request.url.includes('missing')) { response.statusCode = 404; response.end(); return }
          if (request.url.includes('fixture-voice-0')) {
            const aac = await syntheticAac()
            response.setHeader('Content-Type', 'audio/mp4'); response.setHeader('Content-Length', aac.length)
            response.end(aac); return
          }
          const wav = Buffer.alloc(44 + 16000 * 2 * 2)
          wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
          wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
          wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
          wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
          response.setHeader('Content-Type', 'audio/wav'); response.setHeader('Content-Length', wav.length)
          response.end(wav); return
        }
        if (request.url !== '/arkme-self/api' || request.method !== 'POST') { next(); return }
        let body = ''
        for await (const chunk of request) body += chunk
        const { operation } = JSON.parse(body)
        const result = { items: hits, sourceAggregates: [{ sourceKind: 3, sourceUid: source.sourceRef, title: source.displayName, routeTargetKind: 'source', matchedRecordCount: hits.length, matchedRecordCountExact: true }], hasMore: false, queryGuard: { state: 'ok' }, itemCount: hits.length }
        const value = operation === 'search.history' ? { items: [], hasMore: false }
          : ['search.records', 'search.scene', 'search.source-records'].includes(operation) ? result
          : operation === 'search.recordings' ? { items: [], hasMore: false, queryGuard: { state: 'ok' } }
          : operation === 'search.history.create' ? { created: true }
          : operation === 'source.timeline' ? { source, items: notes, hasMore: false }
          : undefined
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify(value === undefined ? { ok: false, error: { code: 'fixture-unhandled', message: operation } } : { ok: true, value }))
      })
    },
  }],
})
