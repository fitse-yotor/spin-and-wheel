import type { Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { get } from './db.ts'
import { buildState, displayAllowed, tick } from './game.ts'
import { verifyJwt } from './util.ts'

interface Client {
  ws: WebSocket
  role: 'display' | 'pos' | 'other'
  shopId: number | null
  ip: string
}
const clients = new Set<Client>()

/** Which shops currently have a POS terminal or a game display connected. */
export function presence() {
  const byShop = new Map<number, { pos: number; display: number }>()
  for (const c of clients) {
    if (!c.shopId || c.role === 'other') continue
    const p = byShop.get(c.shopId) ?? { pos: 0, display: 0 }
    p[c.role]++
    byShop.set(c.shopId, p)
  }
  return [...byShop].map(([shopId, p]) => ({ shopId, online: true, pos: p.pos, display: p.display }))
}

export function broadcastNow() {
  if (clients.size === 0) return
  const now = Date.now()
  const forDisplay = JSON.stringify(buildState(now, true))
  const forOthers = JSON.stringify(buildState(now, false))
  for (const c of clients) {
    if (c.ws.readyState === c.ws.OPEN && c.ws.bufferedAmount < 256_000) c.ws.send(c.role === 'display' ? forDisplay : forOthers)
  }
}

export function attachRealtime(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 })
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const ip = (process.env.TRUST_PROXY ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') || (req.socket.remoteAddress ?? '')
    if ([...clients].filter((c) => c.ip === ip).length >= 50) return ws.close(1013, 'too many connections')
    let role: Client['role'] = url.searchParams.get('role') === 'display' && displayAllowed(url.searchParams.get('key')) ? 'display' : 'other'
    let shopId: number | null = null
    if (role === 'display') {
      const code = url.searchParams.get('shop')
      if (code) shopId = get<{ id: number }>('SELECT id FROM shops WHERE code = ?', code.toUpperCase())?.id ?? null
    } else if (url.searchParams.get('role') === 'pos') {
      const p = verifyJwt(url.searchParams.get('token') ?? '')
      const u = p ? get<{ shop_id: number | null; status: string }>('SELECT shop_id, status FROM users WHERE id = ?', p.sub) : undefined
      if (u && u.status === 'ACTIVE') {
        role = 'pos'
        shopId = u.shop_id
      }
    }
    const client: Client = { ws, role, shopId, ip }
    clients.add(client)
    ws.send(JSON.stringify(buildState(Date.now(), role === 'display')))
    ws.on('close', () => clients.delete(client))
    ws.on('error', () => clients.delete(client))
    ws.on('message', () => {
      /* clients never send anything we act on */
    })
  })

  // Engine loop: advance the round on the server clock, push immediately on a
  // transition and otherwise once a second (which doubles as the heartbeat).
  let lastPush = 0
  setInterval(() => {
    try {
      const changed = tick()
      const now = Date.now()
      if (changed || now - lastPush >= 1000) {
        lastPush = now
        broadcastNow()
      }
    } catch (e) {
      console.error('[engine] tick failed', e)
    }
  }, 250)
}
