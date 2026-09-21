import { useEffect, useMemo, useRef, useState } from 'react'
import { getAuth } from './api'

export interface Segment {
  number: number
  name: string
  category: string
  multiplierX100: number
  color: string
}
export type Phase = 'BETTING_OPEN' | 'BETTING_CLOSED' | 'SPINNING' | 'RESULT'
export type GameType = 'WHEEL' | 'DOGS'
export interface RaceDog {
  trap: number
  name: string
  weight: number
  winOdds: number
  placeOdds: number
  jacket: string
  coat: string
}
export interface RaceInfo {
  marginPercent: number
  distance: string
  track: string
  odds: Record<string, number>
  dogs: RaceDog[]
}
export interface GameInfo {
  id: number
  type: GameType
  phase: Phase
  countdownActive: boolean
  opensAt: number
  closesAt: number
  spinAt: number
  resultAt: number
  endsAt: number
  commitment: string
  timing: { bettingSeconds: number; closedSeconds: number; spinSeconds: number; resultSeconds: number; countdownSeconds: number }
  wheel: Segment[]
  race?: RaceInfo
  result: { number: number; index: number; category: string; multiplier: number; color: string; resultHash: string; order?: number[] } | null
}
export interface RecentResult {
  gameId: number
  number: number
  category: string
  multiplier: number
  color: string
  order?: number[]
}
export interface DisplayExtras {
  window: number
  numbers: Record<string, number>
  groups: { name: string; items: { label: string; count: number }[] }[]
  payTable: { name: string; odds: number | null; options: { label: string; tone: string; odds: number }[] }[]
  sectors: { label: string; start: number; count: number }[]
}
export interface DogExtras {
  window: number
  wins: Record<string, number>
  places: Record<string, number>
  payTable: { name: string; text: string }[]
}
/** One game's view of the shared state message. */
export interface GameState {
  totalBet?: number
  extras?: (DisplayExtras & Partial<DogExtras>) | (DogExtras & Partial<DisplayExtras>) | null
  serverTime: number
  serverId: string
  paused: boolean
  notice: string
  company: string
  game: GameInfo | null
  nextGameId?: number
  previousNumber: number | null
  previousHash: string | null
  recent: RecentResult[]
}

/** The server sends both games in one message; useGameState picks the one being shown. */
export interface RawState {
  serverTime: number
  serverId: string
  notice: string
  company: string
  games: Record<GameType, Omit<GameState, 'serverTime' | 'serverId' | 'notice' | 'company'>>
}

const STALE_MS = 4500

/**
 * Live game state from the central server over WebSocket. The server sends a snapshot at least once a
 * second, so silence means the link is down: `connected` goes false and callers must stop selling.
 * `serverNow()` is the server's clock as best we can tell — client PC clocks are never trusted.
 */
export function useGameState(opts: { role: 'display' | 'pos' | 'other'; shop?: string; key?: string; game?: GameType }) {
  const [raw, setRaw] = useState<RawState | null>(null)
  const [connected, setConnected] = useState(false)
  const offset = useRef(0)
  const lastMsg = useRef(0)
  const open = useRef(false)

  useEffect(() => {
    let ws: WebSocket | null = null
    let retry = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let dead = false

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const q = new URLSearchParams({ role: opts.role })
      if (opts.shop) q.set('shop', opts.shop)
      if (opts.key) q.set('key', opts.key)
      const token = getAuth()?.accessToken
      if (opts.role === 'pos' && token) q.set('token', token)
      ws = new WebSocket(`${proto}://${location.host}/ws?${q}`)
      ws.onopen = () => {
        open.current = true
        retry = 0
      }
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type !== 'state') return
          const received = Date.now()
          offset.current = msg.serverTime - received
          lastMsg.current = received
          setRaw(msg)
          setConnected(true)
        } catch {
          /* ignore malformed frame */
        }
      }
      ws.onclose = () => {
        open.current = false
        setConnected(false)
        if (!dead) timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 5000))
      }
      ws.onerror = () => ws?.close()
    }
    connect()

    const watchdog = setInterval(() => {
      if (open.current && Date.now() - lastMsg.current > STALE_MS) ws?.close()
    }, 1000)
    return () => {
      dead = true
      clearTimeout(timer)
      clearInterval(watchdog)
      ws?.close()
    }
  }, [opts.role, opts.shop, opts.key])

  const type = opts.game ?? 'WHEEL'
  const state = useMemo<GameState | null>(() => (raw ? { serverTime: raw.serverTime, serverId: raw.serverId, notice: raw.notice, company: raw.company, ...raw.games[type] } : null), [raw, type])
  return { state, raw, connected, serverNow: () => Date.now() + offset.current }
}

/** Re-renders on an interval with the current server time (ms). */
export function useServerNow(serverNow: () => number, everyMs = 100) {
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), everyMs)
    return () => clearInterval(t)
  })
  return now
}
