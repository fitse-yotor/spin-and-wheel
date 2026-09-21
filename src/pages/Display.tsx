import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Wheel } from '@/components/Wheel'
import { fmtTime, gameNo, mmss, num } from '@/lib/format'
import { useGameState, useServerNow, type DisplayExtras, type RecentResult, type Segment } from '@/lib/realtime'
import { wheelAngle } from '@/lib/wheelMath'

const chipClass = (category: string) => (category === 'RED' ? 'chip-red' : category === 'GREEN' ? 'chip-green' : category === 'BLACK' ? 'chip-black' : '')

/** The customer-facing game screen. Public: no sign-in, no controls, nothing but the game. */
export default function Display() {
  const [params] = useSearchParams()
  const { state, connected, serverNow } = useGameState({ role: 'display', game: 'WHEEL', shop: params.get('shop') ?? undefined, key: params.get('key') ?? undefined })
  const now = useServerNow(serverNow, 100)
  const stateRef = useRef(state)
  stateRef.current = state

  // Scale the whole UI with the screen, hide the cursor, F toggles full screen.
  useEffect(() => {
    const html = document.documentElement
    html.classList.add('display-mode')
    let hide: ReturnType<typeof setTimeout>
    const move = () => {
      html.classList.add('show-cursor')
      clearTimeout(hide)
      hide = setTimeout(() => html.classList.remove('show-cursor'), 2000)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'f') document.fullscreenElement ? document.exitFullscreen() : html.requestFullscreen?.()
      if (e.key.toLowerCase() === 'g') location.assign('/dogs' + location.search)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('keydown', key)
    return () => {
      html.classList.remove('display-mode', 'show-cursor')
      window.removeEventListener('mousemove', move)
      window.removeEventListener('keydown', key)
    }
  }, [])

  const g = state?.game
  const ex = state?.extras as DisplayExtras | null | undefined
  const angle = () => {
    const s = stateRef.current
    return s?.game ? wheelAngle(s.game, s.previousNumber, s.previousHash, serverNow()) : 0
  }

  if (!state) return <Shell><Centered big="CONNECTING" sub="Waiting for the game server…" /></Shell>
  if (!g) return <Shell><Centered big="GAMES PAUSED" sub="The next game will start shortly." /></Shell>

  const phase = g.phase
  const msToClose = g.closesAt - now
  const finished = phase === 'RESULT' || (phase === 'SPINNING' && now >= g.resultAt)
  const res = finished ? g.result : null
  const urgent = phase === 'BETTING_OPEN' && msToClose <= g.timing.countdownSeconds * 1000
  const nextDraw = phase === 'BETTING_OPEN' ? msToClose : phase === 'RESULT' ? g.endsAt - now + g.timing.bettingSeconds * 1000 : 0

  const status =
    phase === 'BETTING_OPEN' ? { text: 'BETTING OPEN', cls: 'bg-[#1fb350] text-black' }
    : phase === 'BETTING_CLOSED' ? { text: 'BETTING CLOSED', cls: 'bg-[#e0332b] text-white' }
    : res ? { text: 'RESULT', cls: 'bg-[#f2b01e] text-black' }
    : { text: 'WHEEL SPINNING', cls: 'bg-[#f2b01e] text-black' }

  // number table: three columns, filled column by column
  const nums = [...g.wheel].sort((a, b) => a.number - b.number)
  const perCol = Math.ceil(nums.length / 3)
  const cols = [0, 1, 2].map((c) => nums.slice(c * perCol, (c + 1) * perCol))

  return (
    <Shell>
      {!connected && <div className="blink absolute inset-x-0 top-0 z-30 bg-[#e0332b] py-[0.5rem] text-center text-[1.5rem] font-black tracking-[0.2em]">CONNECTION LOST · RECONNECTING TO GAME SERVER</div>}

      {/* Header */}
      <header className="col-span-3 flex items-center justify-between px-[1.6rem]" style={{ background: 'linear-gradient(#0c3d1c, #082a14)' }}>
        <div className="flex items-center gap-[0.9rem]">
          <Logo />
          <div className="leading-none">
            <div className="text-[2.1rem] font-black tracking-[0.06em]">SPIN &amp; WHEEL</div>
            <div className="mt-[0.2rem] text-[0.8rem] font-bold tracking-[0.3em] text-white/60">{state.company.toUpperCase()}</div>
          </div>
        </div>
        <div className={`rounded-[0.4rem] px-[1.6rem] py-[0.35rem] text-[1.7rem] font-black tracking-[0.15em] ${status.cls} ${phase === 'BETTING_OPEN' && urgent ? 'blink' : ''}`}>{status.text}</div>
        <div className="flex items-baseline gap-[0.9rem]">
          <span className="text-[1.15rem] font-extrabold tracking-[0.12em]">NEXT DRAW</span>
          <span className={`text-[3rem] font-black leading-none tabular-nums ${urgent ? (msToClose <= 5000 ? 'blink text-[#ff5a4f]' : 'text-[#ffd34d]') : ''}`}>{mmss(nextDraw)}</span>
        </div>
      </header>

      {/* Left: numbers + pay table */}
      <aside className="flex min-h-0 flex-col gap-[0.8rem] p-[0.8rem]">
        <Panel title="NUMBERS" grow>
          <div className="grid grid-cols-3 gap-x-[0.5rem] gap-y-[0.22rem] p-[0.5rem]">
            {Array.from({ length: perCol }, (_, r) =>
              cols.map((col, c) => {
                const s = col[r]
                return s ? <NumberCell key={`${r}-${c}`} s={s} count={ex?.numbers[s.number] ?? 0} hot={res?.number === s.number} /> : <div key={`${r}-${c}`} />
              }),
            )}
          </div>
        </Panel>
        <Panel title="PAY TABLE">
          <div className="space-y-[0.28rem] p-[0.6rem] text-[0.95rem]">
            {ex?.payTable.map((row) => (
              <div key={row.name} className="flex items-center justify-between gap-[0.6rem]">
                <span className="font-bold tracking-wide">{row.name.toUpperCase()}</span>
                <span className="flex gap-[0.3rem]">
                  {row.odds !== null ? (
                    <b className="tabular-nums">x{row.odds}</b>
                  ) : (
                    row.options.map((o) => <b key={o.label} className={`rounded-[0.2rem] px-[0.4rem] tabular-nums ${chipClass(o.tone) || 'tv-cell'}`}>x{o.odds}</b>)
                  )}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </aside>

      {/* Centre: wheel + result strip */}
      <section className="flex min-h-0 min-w-0 flex-col items-center px-[0.6rem] pb-[0.4rem] pt-[0.9rem]">
        <div className="relative min-h-0 w-full flex-1">
          <div className="absolute inset-0 flex items-center justify-center">
            <Wheel segments={g.wheel} sectors={ex?.sectors} getAngle={angle} highlight={res ? res.index : null}>
              {res ? (
                <div key={g.id} className="pop-in text-[4.6rem] font-black leading-none">{res.number}</div>
              ) : phase === 'BETTING_OPEN' && urgent ? (
                <div className={`text-[4.6rem] font-black leading-none ${msToClose <= 5000 ? 'blink text-[#b3120b]' : ''}`}>{Math.max(0, Math.ceil(msToClose / 1000))}</div>
              ) : (
                <>
                  <div className="text-[0.75rem] font-extrabold tracking-[0.25em]">GAME</div>
                  <div className="text-[2rem] font-black leading-none">{g.id}</div>
                </>
              )}
            </Wheel>
          </div>
        </div>
        <div className="mt-[0.5rem] flex h-[5.4rem] w-full items-center justify-between rounded-[0.5rem] px-[1.4rem]" style={{ background: 'rgba(0,0,0,0.32)' }}>
          <div>
            <div className="text-[0.85rem] font-bold tracking-[0.25em] text-white/60">TOTAL BET</div>
            <div className="text-[2rem] font-black leading-none tabular-nums">{num(state.totalBet ?? 0)} <span className="text-[1.1rem] text-white/60">ETB</span></div>
          </div>
          {res ? (
            <div key={g.id} className="pop-in flex items-center gap-[1.2rem]">
              <div className="text-right text-[0.9rem] font-bold tracking-[0.25em] text-white/70">WINNING<br />NUMBER</div>
              <div className={`flex h-[4.2rem] w-[4.2rem] items-center justify-center rounded-[0.5rem] border-[0.2rem] border-white text-[2.6rem] font-black ${chipClass(res.category)}`}>{res.number}</div>
              <div>
                <div className="text-[2rem] font-black leading-none">{res.category}</div>
                <div className="text-[1.5rem] font-black leading-none text-[#ffd34d]">x{res.multiplier}</div>
              </div>
            </div>
          ) : (
            <div className="text-[1.6rem] font-black tracking-[0.15em] text-white/85">{phase === 'BETTING_OPEN' ? 'PLACE YOUR BETS' : phase === 'BETTING_CLOSED' ? 'NO MORE BETS' : 'GOOD LUCK'}</div>
          )}
          <div className="text-right">
            <div className="text-[0.85rem] font-bold tracking-[0.25em] text-white/60">{res ? 'NEXT GAME' : 'GAME'}</div>
            <div className="text-[2rem] font-black leading-none tabular-nums">#{gameNo(res ? g.id + 1 : g.id)}</div>
          </div>
        </div>
      </section>

      {/* Right: history + statistics */}
      <aside className="flex min-h-0 flex-col gap-[0.8rem] p-[0.8rem]">
        <Panel title="HISTORY">
          <div className="grid grid-cols-2 gap-x-[0.8rem] gap-y-[0.35rem] p-[0.7rem]">
            {historyOrder(state.recent.slice(0, 10)).map((r) => (
              <div key={r.gameId} className="flex items-center gap-[0.5rem]">
                <span className="w-[4.6rem] text-[0.95rem] font-bold tabular-nums text-white/85">#{r.gameId}</span>
                <span className={`flex h-[2.3rem] flex-1 items-center justify-center rounded-[0.25rem] text-[1.35rem] font-black ${chipClass(r.category)}`}>{r.number}</span>
              </div>
            ))}
            {state.recent.length === 0 && <div className="col-span-2 py-[1rem] text-center text-white/60">No draws yet</div>}
          </div>
        </Panel>
        <Panel title="STATISTICS" grow>
          <div className="space-y-[0.45rem] p-[0.6rem]">
            {ex && <div className="text-center text-[0.75rem] font-bold tracking-[0.2em] text-white/55">LAST {ex.window} DRAWS</div>}
            {ex?.groups.map((grp) => (
              <div key={grp.name}>
                <div className="mb-[0.15rem] text-center text-[0.72rem] font-extrabold tracking-[0.18em] text-white/70">{grp.name.toUpperCase()}</div>
                <div className={`grid gap-[0.3rem] ${grp.items.some((i) => i.label.length > 8) ? 'grid-cols-2' : 'grid-cols-3'}`}>
                  {grp.items.map((it) => (
                    <div key={it.label} className="tv-cell rounded-[0.2rem] py-[0.15rem] text-center text-[0.9rem] font-bold tabular-nums">{it.label}: {it.count}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </aside>

      {/* Footer */}
      <footer className="col-span-3 flex items-center justify-between px-[1.6rem] text-[0.95rem] font-bold" style={{ background: 'linear-gradient(#082a14, #061d0e)' }}>
        <span className="flex items-center gap-[0.6rem] text-white/75"><span className="rounded-[0.25rem] border border-white/70 px-[0.4rem] font-black text-white">18+</span>{state.notice}</span>
        <span className="tracking-[0.2em]">CURRENT DRAW {gameNo(g.id)}</span>
        <span className="tabular-nums text-white/85">{fmtTime(now)}</span>
      </footer>
    </Shell>
  )
}

/** Newest five down the first column, the five before that down the second (as on a casino board). */
function historyOrder(list: RecentResult[]) {
  const first = list.slice(0, 5)
  const second = list.slice(5, 10)
  return Array.from({ length: 5 }, (_, i) => [first[i], second[i]]).flat().filter(Boolean)
}

function NumberCell({ s, count, hot }: { s: Segment; count: number; hot: boolean }) {
  return (
    <div className={`flex items-center gap-[0.3rem] ${hot ? 'rounded-[0.25rem] bg-white/25' : ''}`}>
      <span className={`flex h-[2.1rem] w-[3rem] items-center justify-center rounded-[0.2rem] text-[1.05rem] font-black ${chipClass(s.category)}`}>{s.name}</span>
      <span className="tv-cell flex h-[2.1rem] flex-1 items-center justify-center rounded-[0.2rem] text-[1rem] font-bold tabular-nums">{count}</span>
    </div>
  )
}

function Panel({ title, children, grow }: { title: string; children: React.ReactNode; grow?: boolean }) {
  return (
    <section className={`tv-panel flex min-h-0 flex-col overflow-hidden rounded-[0.4rem] ${grow ? 'flex-1' : ''}`}>
      <div className="tv-head py-[0.35rem] text-[1.15rem]">{title}</div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>
  )
}

function Logo() {
  return (
    <svg viewBox="0 0 48 48" className="h-[3.4rem] w-[3.4rem]" aria-hidden>
      <circle cx="24" cy="24" r="22" fill="#14161a" stroke="#e7c15a" strokeWidth="2" />
      {Array.from({ length: 12 }, (_, i) => {
        const a0 = (i / 12) * Math.PI * 2 - Math.PI / 2
        const a1 = ((i + 1) / 12) * Math.PI * 2 - Math.PI / 2
        const p = (a: number, r: number) => `${24 + Math.cos(a) * r},${24 + Math.sin(a) * r}`
        return <path key={i} d={`M${p(a0, 8)} L${p(a0, 19)} A19 19 0 0 1 ${p(a1, 19)} L${p(a1, 8)} Z`} fill={i === 0 ? '#25a244' : i % 2 ? '#c8161d' : '#14161a'} stroke="#e7c15a" strokeWidth="0.6" />
      })}
      <circle cx="24" cy="24" r="6" fill="#e0a92a" />
    </svg>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="felt relative grid h-screen w-screen grid-cols-[25rem_1fr_25rem] grid-rows-[5rem_1fr_2.4rem] overflow-hidden text-white">
      {children}
    </div>
  )
}
function Centered({ big, sub }: { big: string; sub: string }) {
  return (
    <div className="col-span-3 row-span-3 flex flex-col items-center justify-center">
      <div className="text-[8rem] font-black tracking-[0.1em]">{big}</div>
      <div className="text-[2rem] text-white/70">{sub}</div>
    </div>
  )
}
