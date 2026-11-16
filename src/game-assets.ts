import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
// Tencent IM uses a locally generated Blob worker for its WebSocket transport.
export const GAME_CONTENT_SECURITY_POLICY = "default-src 'none'; script-src 'self'; worker-src blob:; style-src 'unsafe-inline'; connect-src https: wss:; img-src https: data:; frame-ancestors 'none'"

export function createGameAssetHandler(prefix: string) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end()
      return
    }
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    if (path !== `${prefix}/index.html` && path !== `${prefix}/game.js`) {
      res.writeHead(404).end()
      return
    }
    try {
      const script = path.endsWith('/game.js')
      const body = script
        ? await readFile(fileURLToPath(new URL('./game.js', import.meta.url)))
        : Buffer.from(
            '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Arkme 游戏</title></head><body><div id="game"></div><script src="./game.js"></script></body></html>',
          )
      res
        .writeHead(200, {
          'Content-Type': script ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy':
            GAME_CONTENT_SECURITY_POLICY,
        })
        .end(req.method === 'HEAD' ? undefined : body)
    } catch {
      res.writeHead(503).end('游戏资源尚未构建')
    }
  }
}
