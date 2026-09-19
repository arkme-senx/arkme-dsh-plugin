import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// No credentials or production data: every application API is answered locally.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: { host: '127.0.0.1', fs: { allow: [fileURLToPath(new URL('../../..', import.meta.url))] } },
  plugins: [{ name: 'theme-fixtures', configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      if (request.url?.startsWith('/arkme-self/api/files/local')) {
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
        response.end('# 文档预览\n\n正文应始终清晰可读。\n\n## 接口说明\n\n使用 `POST + JSON`。\n\n| 能力 | 状态 |\n|---|---|\n| 日历 | 可用 |\n\n> 引用内容\n\n```ts\nconst enabled = true\n```')
        return
      }
      if (!request.url?.startsWith('/arkme-self/')) { next(); return }
      let body = ''; for await (const chunk of request) body += chunk
      const { operation } = body ? JSON.parse(body) : {}
      const date = new Date(), month = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`
      const days = [2, 6, 12, 18].map(day => ({ bucketDate: `${month}-${String(day).padStart(2,'0')}`, count: day, hasRecords: true, protectedCount: 0 }))
      response.setHeader('Content-Type', 'application/json')
      const voiceprintValues: Record<string, unknown> = {
        'voiceprint.status': { hasVoiceprint: true, nickname: '我的声音', updatedAtMillis: 1, canIdentify: true, canPlay: true, canRestorePlayback: false, enrollmentStatus: 'ready', enrollmentPending: false },
        'voiceprint.grants': { items: [], nextCursor: '', hasMore: false },
        'voiceprint.people': { items: [{ personRef: 'synthetic-person', identityKind: 'speaker', displayName: '测试说话人', playGranted: true, previewAvailable: false, canInvite: false, inviteTargetSelectionRequired: false }], nextCursor: '', hasMore: false },
      }
      if (operation in voiceprintValues) { response.end(JSON.stringify({ ok: true, value: voiceprintValues[operation] })); return }
      response.end(JSON.stringify(operation === 'calendar.buckets'
        ? { ok: true, value: { days } }
        : { ok: false, error: { code: 'fixture-only', message: '此验收页不连接业务服务' } }))
    })
  } }],
})
