import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { Modal } from '@/components/Modal'
import { api, ApiError, logout } from '@/lib/api'
import { etb, fmtTime, gameNo, mmss } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useGameState, useServerNow, type GameState, type GameType, type RawState } from '@/lib/realtime'
import Book from './Book'
import Check from './Check'
import Results from './Results'
import ShiftPage from './ShiftPage'

export interface Shift {
  id: number
  openedAt: number
  closedAt: number | null
  status: string
  openingFloat: number
  sales: number
  cancellations: number
  payouts: number
  adjustments: number
  expectedCash: number
  ticketCount: number
  cancelledCount: number
  paidCount: number
  countedCash: number | null
  difference: number | null
}
export interface PosInfo {
  user: { id: number; fullName: string; cashierCode: string; payoutLimit: number }
  shop: { id: number; code: string; name: string; address: string; phone: string; status: string }
  shift: Shift | null
  today: { sales: number; tickets: number }
  limits: { minStake: number; maxSelectionStake: number; maxTicketStake: number; maxPayout: number; maxSelections: number }
  minAge: number
  notice: string
  autoPrint: boolean
  categoryColors: Record<string, string>
}
interface PosCtx {
  /** Which game this terminal is selling right now */
  gameType: GameType
  info: PosInfo | null
  reload: () => Promise<void>
  state: GameState | null
  raw: RawState | null
  now: number
  connected: boolean
  apiOk: boolean
  /** null when selling is allowed, otherwise why it is not */
  blocked: string | null
}
const Ctx = createContext<PosCtx>(null as never)
export const usePos = () => useContext(Ctx)

export default function PosApp() {
  const auth = useAuth()
  const nav = useNavigate()
  const [gameType, setGameTypeState] = useState<GameType>(() => {
    try {
      return localStorage.getItem('sw.pos.game') === 'DOGS' ? 'DOGS' : 'WHEEL'
    } catch {
      return 'WHEEL'
    }
  })
  const setGameType = (t: GameType) => {
    setGameTypeState(t)
    try {
      localStorage.setItem('sw.pos.game', t)
    } catch {
      /* not persisted */
    }
  }
  const { state, raw, connected, serverNow } = useGameState({ role: 'pos', game: gameType })
  const now = useServerNow(serverNow, 100)
  const [info, setInfo] = useState<PosInfo | null>(null)
  const [apiOk, setApiOk] = useState(true)
  const [showInfo, setShowInfo] = useState(false)
  const signedInAt = useRef(Date.now())

  const reload = useCallback(async () => {
    try {
      setInfo(await api<PosInfo>('/pos/context', { background: true }))
      setApiOk(true)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NETWORK') setApiOk(false)
    }
  }, [])
  useEffect(() => {
    reload()
    const t = setInterval(reload, 8000)
    return () => clearInterval(t)
  }, [reload])

  const g = state?.game
  const blocked = useMemo(() => {
    if (!connected || !apiOk) return 'CONNECTION LOST — BETTING TEMPORARILY UNAVAILABLE'
    if (!state || state.paused || !g) return 'GAMES ARE PAUSED'
    if (!info?.shift) return 'START YOUR SHIFT TO SELL TICKETS'
    if (g.phase !== 'BETTING_OPEN' || now >= g.closesAt) return 'BETTING CLOSED'
    return null
  }, [connected, apiOk, state, g, info?.shift, now])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = { F1: '/cashier/ticket', F2: '/cashier/check', F3: '/cashier/cashbook', F4: '/cashier/results' }[e.key]
      if (t) {
        e.preventDefault()
        nav(t)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nav])

  if (!auth) return null
  const open = g?.phase === 'BETTING_OPEN' && now < g.closesAt
  const left = g ? Math.max(0, g.closesAt - now) : 0
  const total = (g?.timing.bettingSeconds ?? 45) * 1000
  const secsShown = g ? (open ? mmss(left) : g.phase === 'RESULT' ? mmss(g.endsAt - now) : '0:00') : '--:--'
  const frac = open ? left / total : 0
  const urgent = open && left <= 10_000
  const statusText = !connected ? 'OFFLINE' : open ? 'BETTING OPEN' : g?.phase === 'BETTING_CLOSED' ? 'BETTING CLOSED' : g?.phase === 'SPINNING' ? 'DRAW IN PROGRESS' : g ? 'RESULT' : '—'

  const tab = ({ isActive }: { isActive: boolean }) => `px-5 py-2 text-lg ${isActive ? 'bg-[#7d1b1f] font-semibold' : 'hover:bg-[#8f2126]'}`

  return (
    <Ctx.Provider value={{ gameType, info, reload, state, raw, now, connected, apiOk, blocked }}>
      <div className="cashier flex h-full flex-col bg-[#dcdcdc]">
        {/* top bar: title, round timer, navigation */}
        <header className="flex items-stretch justify-between pl-4">
          <div className="flex items-center gap-6 py-1">
            <div>
              <div className="text-4xl font-light leading-none tracking-[0.12em] text-[#222]">CASHIER</div>
              <div className="mt-1 text-[0.7rem] text-[#555]"><b>{auth.user.username}</b> · {info?.user.cashierCode ?? ''} logged in at {fmtTime(signedInAt.current, false)}</div>
            </div>
          </div>
          <div className="relative -mb-4 mt-1 flex h-[4.2rem] w-[4.2rem] items-center justify-center self-start rounded-full bg-white shadow-lg" title="Time until betting closes">
            <svg viewBox="0 0 60 60" className="absolute inset-0 -rotate-90">
              <circle cx="30" cy="30" r="27" fill="none" stroke="#e2e2e2" strokeWidth="4" />
              <circle cx="30" cy="30" r="27" fill="none" stroke={urgent ? '#c62828' : open ? '#1f9d4d' : '#999'} strokeWidth="4" strokeDasharray={`${frac * 169.6} 169.6`} />
            </svg>
            <span className={`relative text-xl font-semibold tabular-nums ${urgent ? 'text-[#c62828]' : ''}`}>{secsShown}</span>
          </div>
          <nav className="flex items-stretch rounded-bl-lg bg-[#a5262a] text-white">
            <NavLink to="/cashier/ticket" className={tab}>Ticket</NavLink>
            <NavLink to="/cashier/check" className={tab}>Check</NavLink>
            <NavLink to="/cashier/cashbook" className={tab}>Cashbook</NavLink>
            <NavLink to="/cashier/results" className={tab}>Results</NavLink>
            <a href="/" target="_blank" rel="noreferrer" className="px-5 py-2 text-lg hover:bg-[#8f2126]">Displays</a>
            <button onClick={() => logout().then(() => nav('/cashier'))} aria-label="Sign out" title="Sign out" className="px-4 hover:bg-[#8f2126]">
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 4h5v16h-5M4 12h10m-4-4 4 4-4 4" /></svg>
            </button>
          </nav>
        </header>

        {/* main panel */}
        <div className="mx-3 mb-2 mt-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-white shadow">
          <div className="flex items-center gap-5 whitespace-nowrap bg-[#0f2a5c] px-4 py-2 text-white">
            <div className="flex items-center gap-2">
              <svg viewBox="0 0 48 48" className="h-8 w-8"><circle cx="24" cy="24" r="22" fill="#14161a" stroke="#e7c15a" strokeWidth="2" />{Array.from({ length: 12 }, (_, i) => { const a0 = (i / 12) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 1) / 12) * Math.PI * 2 - Math.PI / 2; const p = (a: number, r: number) => `${24 + Math.cos(a) * r},${24 + Math.sin(a) * r}`; return <path key={i} d={`M${p(a0, 8)} L${p(a0, 19)} A19 19 0 0 1 ${p(a1, 19)} L${p(a1, 8)} Z`} fill={i === 0 ? '#25a244' : i % 2 ? '#c8161d' : '#14161a'} /> })}<circle cx="24" cy="24" r="6" fill="#e0a92a" /></svg>
              <span className="text-xl font-bold tracking-wide">SPIN &amp; WHEEL</span>
            </div>
            <div className="flex overflow-hidden rounded border border-white/30 text-xs font-bold" role="tablist" aria-label="Game">
              {(['WHEEL', 'DOGS'] as const).map((t) => {
                const gg = raw?.games[t]?.game
                const isOpen = !!gg && gg.phase === 'BETTING_OPEN' && now < gg.closesAt
                return (
                  <button key={t} role="tab" aria-selected={gameType === t} onClick={() => setGameType(t)} className={`flex items-center gap-2 px-3 py-1 ${gameType === t ? 'bg-white text-[#0f2a5c]' : 'text-white/80 hover:bg-white/10'}`}>
                    {t === 'WHEEL' ? 'WHEEL' : 'DOG RACE'}
                    <span className={`tabular-nums ${isOpen ? (gameType === t ? 'text-[#1f9d4d]' : 'text-[#7ee2a0]') : 'opacity-60'}`}>{gg ? (isOpen ? mmss(gg.closesAt - now) : '·') : '—'}</span>
                  </button>
                )
              })}
            </div>
            <Banner k={gameType === 'DOGS' ? 'Race' : 'Round'} v={g ? gameNo(g.id) : '—'} />
            <span className={`rounded px-2 py-0.5 text-xs font-bold tracking-widest ${!connected ? 'blink bg-[#c62828]' : open ? 'bg-[#1f9d4d]' : 'bg-[#c62828]'}`}>{statusText}</span>
            <div className="ml-auto flex gap-5">
              <Banner k="Balance" v={info?.shift ? etb(info.shift.expectedCash) : '—'} />
              <Banner k="Today's sales" v={info ? etb(info.today.sales) : '—'} />
              <Banner k="Min-Stake" v={info ? String(info.limits.minStake / 100) : '—'} />
              <Banner k="Max-Stake" v={info ? String(info.limits.maxSelectionStake / 100) : '—'} />
            </div>
          </div>
          {(!connected || !apiOk) && <div className="blink bg-[#c62828] px-4 py-2 text-center text-lg font-black tracking-widest text-white">CONNECTION LOST — BETTING TEMPORARILY UNAVAILABLE · RETRYING…</div>}
          <main className="min-h-0 flex-1 overflow-auto">
            <Routes>
              <Route path="ticket" element={<Book />} />
              <Route path="check" element={<Check />} />
              <Route path="cashbook" element={<ShiftPage />} />
              <Route path="results" element={<Results />} />
              <Route path="*" element={<Navigate to="/cashier/ticket" replace />} />
            </Routes>
          </main>
        </div>

        {/* bottom bar */}
        <footer className="flex items-center justify-between bg-[#2b2b2b] px-6 py-1.5 text-white">
          <div className="flex gap-8">
            <Foot label="Printer" onClick={() => nav('/cashier/results')}><path d="M7 9V3h10v6M7 17H4V9h16v8h-3M7 14h10v7H7z" /></Foot>
            <Foot label="Information" onClick={() => setShowInfo(true)}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></Foot>
          </div>
          <div className="text-sm tracking-[0.2em] text-white/70">{info?.shop.name?.toUpperCase()} · SPIN &amp; WHEEL</div>
          <div className="flex gap-8">
            <Foot label="Manager" onClick={() => window.open('/admin', '_blank')}><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></Foot>
            <Foot label="Stop" onClick={() => nav('/cashier/cashbook')}><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></Foot>
            <Foot label="Start" onClick={() => nav('/cashier/cashbook')}><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></Foot>
          </div>
        </footer>

        {showInfo && info && (
          <Modal dark onClose={() => setShowInfo(false)}>
            <div className="space-y-3 p-6 text-sm">
              <h2 className="text-xl font-bold">Terminal information</h2>
              <p><b>{info.shop.name}</b> ({info.shop.code}) · {info.user.cashierCode}</p>
              <ul className="space-y-1">
                <li>Stake per bet: {etb(info.limits.minStake)} – {etb(info.limits.maxSelectionStake)}</li>
                <li>Stake per ticket: up to {etb(info.limits.maxTicketStake)} · up to {info.limits.maxSelections} bets</li>
                <li>Maximum payout per ticket: {etb(info.limits.maxPayout)}</li>
                <li>Your payout limit: {etb(info.user.payoutLimit)} (above this a manager must approve)</li>
              </ul>
              <div className="rounded bg-panel2 p-3 text-xs leading-relaxed">
                <b>Keys:</b> F1 Ticket · F2 Check · F3 Cashbook · F4 Results · type digits to set the stake of the highlighted bet · Enter prints the ticket · Esc clears · Del removes the highlighted bet · / jumps to quick number entry.
              </div>
              <p className="text-xs text-mute">{info.notice}</p>
              <button autoFocus onClick={() => setShowInfo(false)} className="w-full rounded border border-line py-2 font-bold">Close</button>
            </div>
          </Modal>
        )}
      </div>
    </Ctx.Provider>
  )
}

const Banner = ({ k, v }: { k: string; v: string }) => (
  <div className="text-sm"><span className="text-white/70">{k}: </span><b className="tabular-nums">{v}</b></div>
)
function Foot({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-0.5 px-2 text-xs hover:text-[#ffd34d]">
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
      {label}
    </button>
  )
}
