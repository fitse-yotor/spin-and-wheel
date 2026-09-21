import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fmtTime, gameNo, mmss, num } from '@/lib/format'
import { useGameState, useServerNow, type DogExtras, type RecentResult } from '@/lib/realtime'
import { Dog } from './DogArt'
import { racePoses } from './raceMath'

const ordinal = (n: number) => ['1st', '2nd', '3rd', '4th', '5th', '6th'][n - 1] ?? `${n}th`
const inkOn = (jacket: string) => (jacket === '#f4f4f4' || jacket === '#f59e0b' ? '#141414' : '#ffffff')
const DOG_W = 0.15 // dog width as a share of the track, used to keep the nose on the line

/** The customer-facing dog race screen. Public: no sign-in, no controls, only the race. */
export default function DogDisplay() {
  const [params] = useSearchParams()
  const { state, connected, serverNow } = useGameState({ role: 'display', game: 'DOGS', shop: params.get('shop') ?? undefined, key: params.get('key') ?? undefined })
  const now = useServerNow(serverNow, 100)
  const stateRef = useRef(state)
  stateRef.current = state
  const trackRef = useRef<HTMLDivElement>(null)
  const dogRefs = useRef<(HTMLDivElement | null)[]>([])

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
      if (e.key.toLowerCase() === 'g') location.assign('/' + location.search)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('keydown', key)
    return () => {
      html.classList.remove('display-mode', 'show-cursor')
      window.removeEventListener('mousemove', move)
      window.removeEventListener('keydown', key)
    }
  }, [])

  // Dogs are moved every frame from the server clock (transform only, so it stays smooth on a TV).
  useEffect(() => {
    let raf = 0
    const loop = () => {
      const g = stateRef.current?.game
      const track = trackRef.current
      if (g && track) {
        const poses = racePoses(g, serverNow())
        const W = track.clientWidth
        dogRefs.current.forEach((el, i) => {
          if (!el) return
          const pose = poses?.[i]
          const pos = DOG_W + (pose?.p ?? 0) * (0.92 - DOG_W) // nose inside the box at the start, on the finish line (92%) at p = 1
          el.style.transform = `translateX(${pos * W - DOG_W * W}px)`
          el.firstElementChild?.classList.toggle('running', !!pose?.running)
        })
      }
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [serverNow])

  const g = state?.game
  const ex = state?.extras as DogExtras | null | undefined

  if (!state) return <Shell><Centered big="CONNECTING" sub="Waiting for the game server…" /></Shell>
  if (!g || !g.race) return <Shell><Centered big="RACES PAUSED" sub="The next race will start shortly." /></Shell>

  const race = g.race
  const phase = g.phase
  const msToClose = g.closesAt - now
  const finished = phase === 'RESULT' || (phase === 'SPINNING' && now >= g.resultAt)
  const res = finished ? g.result : null
  const order = res?.order
  const urgent = phase === 'BETTING_OPEN' && msToClose <= g.timing.countdownSeconds * 1000
  const nextRace = phase === 'BETTING_OPEN' ? msToClose : phase === 'RESULT' ? g.endsAt - now + g.timing.bettingSeconds * 1000 : 0
  const poses = racePoses(g, now)
  const totalW = race.dogs.reduce((a, d) => a + d.weight, 0)
  const byTrap = new Map(race.dogs.map((d) => [d.trap, d]))

  const status =
    phase === 'BETTING_OPEN' ? { text: 'BETTING OPEN', cls: 'bg-[#1fb350] text-black' }
    : phase === 'BETTING_CLOSED' ? { text: 'BETTING CLOSED', cls: 'bg-[#e0332b] text-white' }
    : res ? { text: 'RESULT', cls: 'bg-[#f2b01e] text-black' }
    : { text: 'RACE IN PROGRESS', cls: 'bg-[#f2b01e] text-black' }

  const forecast = order ? race.odds[`FC:${order[0]}-${order[1]}`] : undefined

  return (
    <Shell>
      {!connected && <div className="blink absolute inset-x-0 top-0 z-30 bg-[#e0332b] py-[0.5rem] text-center text-[1.5rem] font-black tracking-[0.2em]">CONNECTION LOST · RECONNECTING TO GAME SERVER</div>}

      <header className="col-span-3 flex items-center justify-between px-[1.6rem]" style={{ background: 'linear-gradient(#0c3d1c, #082a14)' }}>
        <div className="flex items-center gap-[0.9rem]">
          <svg viewBox="0 0 48 48" className="h-[3.4rem] w-[3.4rem]" aria-hidden>
            <circle cx="24" cy="24" r="22" fill="#14161a" stroke="#e7c15a" strokeWidth="2" />
            <path d="M8 30 C12 16 24 12 34 16 L40 12 L40 20 C40 26 34 30 28 30 L26 40 L22 40 L22 32 L14 34 L12 40 L8 40 Z" fill="#e7c15a" />
          </svg>
          <div className="leading-none">
            <div className="text-[2.1rem] font-black tracking-[0.06em]">DOG RACE</div>
            <div className="mt-[0.2rem] text-[0.8rem] font-bold tracking-[0.3em] text-white/60">{state.company.toUpperCase()}</div>
          </div>
        </div>
        <div className={`rounded-[0.4rem] px-[1.6rem] py-[0.35rem] text-[1.7rem] font-black tracking-[0.15em] ${status.cls} ${phase === 'BETTING_OPEN' && urgent ? 'blink' : ''}`}>{status.text}</div>
        <div className="flex items-baseline gap-[0.9rem]">
          <span className="text-[1.15rem] font-extrabold tracking-[0.12em]">NEXT RACE</span>
          <span className={`text-[3rem] font-black leading-none tabular-nums ${urgent ? (msToClose <= 5000 ? 'blink text-[#ff5a4f]' : 'text-[#ffd34d]') : ''}`}>{mmss(nextRace)}</span>
        </div>
      </header>

      {/* Left: runners + pay table */}
      <aside className="flex min-h-0 flex-col gap-[0.8rem] p-[0.8rem]">
        <Panel title="RUNNERS" grow>
          <div className="p-[0.5rem]">
            <div className="grid grid-cols-[2.6rem_1fr_4.4rem_4.4rem] items-center gap-x-[0.5rem] px-[0.3rem] pb-[0.3rem] text-[0.75rem] font-extrabold tracking-[0.15em] text-white/60">
              <span>TRAP</span><span>DOG</span><span className="text-right">WIN</span><span className="text-right">PLACE</span>
            </div>
            {race.dogs.map((d) => (
              <div key={d.trap} className={`mb-[0.35rem] rounded-[0.3rem] px-[0.3rem] py-[0.3rem] ${order?.[0] === d.trap ? 'bg-white/25' : 'tv-cell'}`}>
                <div className="grid grid-cols-[2.6rem_1fr_4.4rem_4.4rem] items-center gap-x-[0.5rem]">
                  <span className="flex h-[2.2rem] w-[2.2rem] items-center justify-center rounded-[0.25rem] text-[1.3rem] font-black" style={{ background: d.jacket, color: inkOn(d.jacket), border: '1px solid rgba(255,255,255,0.4)' }}>{d.trap}</span>
                  <span className="truncate text-[1.15rem] font-bold">{d.name}</span>
                  <span className="text-right text-[1.2rem] font-black tabular-nums text-[#ffd34d]">{d.winOdds.toFixed(2)}</span>
                  <span className="text-right text-[1.05rem] font-bold tabular-nums">{d.placeOdds.toFixed(2)}</span>
                </div>
                <div className="mt-[0.25rem] h-[0.35rem] overflow-hidden rounded-full bg-black/40" title="Published strength">
                  <div className="h-full rounded-full bg-[#ffd34d]" style={{ width: `${(d.weight / totalW) * 100 * 2.2}%` }} />
                </div>
              </div>
            ))}
            <div className="mt-[0.4rem] px-[0.3rem] text-[0.78rem] leading-snug text-white/60">Odds are fixed for this race and follow the strength bars. Every price includes a {race.marginPercent}% margin.</div>
          </div>
        </Panel>
        <Panel title="BET TYPES">
          <div className="space-y-[0.28rem] p-[0.6rem] text-[0.95rem]">
            {ex?.payTable.map((row) => (
              <div key={row.name} className="flex items-center justify-between gap-[0.6rem]">
                <span className="font-bold tracking-wide">{row.name.toUpperCase()}</span>
                <span className="text-white/75">{row.text}</span>
              </div>
            ))}
          </div>
        </Panel>
      </aside>

      {/* Centre: track + result strip */}
      <section className="flex min-h-0 min-w-0 flex-col px-[0.6rem] pb-[0.4rem] pt-[0.9rem]">
        <div className="flex items-end justify-between px-[0.4rem] pb-[0.4rem] text-[1.05rem] font-extrabold tracking-[0.2em] text-white/80">
          <span>RACE {gameNo(g.id)}</span>
          <span>{race.distance} · {race.track.toUpperCase()}</span>
          <span>{phase === 'BETTING_OPEN' ? 'DOGS IN THE BOXES' : "AND THEY'RE OFF"}</span>
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-[0.5rem] border-[0.25rem] border-[#f4f4f4] shadow-[0_0.5rem_1.2rem_rgba(0,0,0,0.5)]">
          <div ref={trackRef} className="absolute inset-0 flex flex-col">
            {race.dogs.map((d, i) => {
              const pose = poses?.[i]
              return (
                <div key={d.trap} className="sand-lane relative flex-1 border-b border-white/70 last:border-b-0">
                  {/* starting box */}
                  <div className="absolute inset-y-0 left-0 flex w-[15%] items-center justify-center border-r-[0.2rem] border-[#5c3a14]/70 bg-black/25">
                    <span className="flex h-[2.4rem] w-[2.4rem] items-center justify-center rounded-[0.3rem] text-[1.5rem] font-black" style={{ background: d.jacket, color: inkOn(d.jacket) }}>{d.trap}</span>
                  </div>
                  <div ref={(el) => { dogRefs.current[i] = el }} className="absolute left-0 top-1/2 w-[15%] -translate-y-1/2 will-change-transform">
                    <Dog coat={d.coat} jacket={d.jacket} trap={d.trap} name={d.name} className="h-auto w-full drop-shadow-[0_0.3rem_0.2rem_rgba(0,0,0,0.35)]" />
                  </div>
                  {pose?.place && (
                    <div key={`${g.id}-${d.trap}`} className="place-badge absolute right-[0.4rem] top-1/2 -translate-y-1/2 rounded-[0.3rem] bg-black/75 px-[0.4rem] py-[0.1rem] text-[1.3rem] font-black" style={{ color: pose.place === 1 ? '#ffd34d' : '#fff' }}>{ordinal(pose.place)}</div>
                  )}
                </div>
              )
            })}
          </div>
          {/* finish line */}
          <div className="pointer-events-none absolute inset-y-0 left-[92%] w-[0.9rem]" style={{ background: 'repeating-conic-gradient(#f4f4f4 0% 25%, #141414 0% 50%) 0 0 / 0.9rem 0.9rem' }} />
          <div className="pointer-events-none absolute left-[92%] top-[-0.1rem] -translate-x-1/2 rounded-b-[0.3rem] bg-white px-[0.6rem] text-[0.85rem] font-black tracking-[0.2em] text-black">FINISH</div>
          {urgent && (
            <div className={`pointer-events-none absolute inset-0 flex items-center justify-center text-[18rem] font-black leading-none ${msToClose <= 5000 ? 'blink text-[#ff5a4f]' : 'text-[#ffd34d]'}`} style={{ textShadow: '0 0.4rem 1.2rem rgba(0,0,0,0.7)' }}>
              {Math.max(0, Math.ceil(msToClose / 1000))}
            </div>
          )}
        </div>
        <div className="mt-[0.5rem] flex h-[5.4rem] w-full items-center justify-between rounded-[0.5rem] px-[1.4rem]" style={{ background: 'rgba(0,0,0,0.32)' }}>
          <div>
            <div className="text-[0.85rem] font-bold tracking-[0.25em] text-white/60">TOTAL BET</div>
            <div className="text-[2rem] font-black leading-none tabular-nums">{num(state.totalBet ?? 0)} <span className="text-[1.1rem] text-white/60">ETB</span></div>
          </div>
          {order ? (
            <div key={g.id} className="pop-in flex items-center gap-[1.4rem]">
              {order.slice(0, 3).map((t, i) => {
                const d = byTrap.get(t)!
                return (
                  <div key={t} className="flex items-center gap-[0.5rem]">
                    <span className="text-[1.1rem] font-black" style={{ color: i === 0 ? '#ffd34d' : '#fff' }}>{ordinal(i + 1)}</span>
                    <span className="flex h-[3rem] w-[3rem] items-center justify-center rounded-[0.35rem] text-[1.9rem] font-black" style={{ background: d.jacket, color: inkOn(d.jacket), border: '2px solid #fff' }}>{t}</span>
                    <span className="text-[1.25rem] font-bold">{d.name}</span>
                  </div>
                )
              })}
              {forecast && <span className="ml-[0.4rem] text-[1.05rem] font-bold text-white/75">FORECAST x{(forecast / 100).toFixed(2)}</span>}
            </div>
          ) : (
            <div className="text-[1.6rem] font-black tracking-[0.15em] text-white/85">{phase === 'BETTING_OPEN' ? 'PLACE YOUR BETS' : phase === 'BETTING_CLOSED' ? 'NO MORE BETS' : "AND THEY'RE OFF!"}</div>
          )}
          <div className="text-right">
            <div className="text-[0.85rem] font-bold tracking-[0.25em] text-white/60">{res ? 'NEXT RACE' : 'RACE'}</div>
            <div className="text-[2rem] font-black leading-none tabular-nums">#{gameNo(res ? g.id + 1 : g.id)}</div>
          </div>
        </div>
      </section>

      {/* Right: history + statistics */}
      <aside className="flex min-h-0 flex-col gap-[0.8rem] p-[0.8rem]">
        <Panel title="HISTORY">
          <div className="space-y-[0.32rem] p-[0.6rem]">
            {state.recent.slice(0, 8).map((r: RecentResult) => (
              <div key={r.gameId} className="flex items-center gap-[0.6rem]">
                <span className="w-[4.6rem] text-[0.95rem] font-bold tabular-nums text-white/85">#{gameNo(r.gameId)}</span>
                <span className="flex h-[2.1rem] w-[2.1rem] items-center justify-center rounded-[0.25rem] text-[1.25rem] font-black" style={{ background: r.color, color: inkOn(r.color) }}>{r.number}</span>
                <span className="flex gap-[0.25rem]">
                  {(r.order ?? []).slice(0, 3).map((t, i) => (
                    <span key={i} className="flex h-[1.7rem] w-[1.7rem] items-center justify-center rounded-[0.2rem] text-[1rem] font-black" style={{ background: byTrap.get(t)?.jacket, color: inkOn(byTrap.get(t)?.jacket ?? '#000') }}>{t}</span>
                  ))}
                </span>
              </div>
            ))}
            {state.recent.length === 0 && <div className="py-[1rem] text-center text-white/60">No races yet</div>}
          </div>
        </Panel>
        <Panel title="STATISTICS" grow>
          <div className="p-[0.6rem]">
            {ex && <div className="pb-[0.3rem] text-center text-[0.75rem] font-bold tracking-[0.2em] text-white/55">LAST {ex.window} RACES</div>}
            <div className="grid grid-cols-[2.4rem_1fr_3.6rem_3.6rem] items-center gap-x-[0.5rem] pb-[0.2rem] text-[0.72rem] font-extrabold tracking-[0.15em] text-white/60">
              <span /><span>DOG</span><span className="text-center">WINS</span><span className="text-center">TOP 3</span>
            </div>
            {race.dogs.map((d) => (
              <div key={d.trap} className="tv-cell mb-[0.3rem] grid grid-cols-[2.4rem_1fr_3.6rem_3.6rem] items-center gap-x-[0.5rem] rounded-[0.25rem] px-[0.25rem] py-[0.2rem]">
                <span className="flex h-[1.7rem] w-[1.7rem] items-center justify-center rounded-[0.2rem] text-[1.05rem] font-black" style={{ background: d.jacket, color: inkOn(d.jacket) }}>{d.trap}</span>
                <span className="truncate text-[1rem] font-bold">{d.name}</span>
                <span className="text-center text-[1.05rem] font-bold tabular-nums">{ex?.wins[d.trap] ?? 0}</span>
                <span className="text-center text-[1.05rem] font-bold tabular-nums">{ex?.places[d.trap] ?? 0}</span>
              </div>
            ))}
          </div>
        </Panel>
      </aside>

      <footer className="col-span-3 flex items-center justify-between px-[1.6rem] text-[0.95rem] font-bold" style={{ background: 'linear-gradient(#082a14, #061d0e)' }}>
        <span className="flex items-center gap-[0.6rem] text-white/75"><span className="rounded-[0.25rem] border border-white/70 px-[0.4rem] font-black text-white">18+</span>{state.notice}</span>
        <span className="tracking-[0.2em]">CURRENT RACE {gameNo(g.id)}</span>
        <span className="tabular-nums text-white/85">{fmtTime(now)}</span>
      </footer>
    </Shell>
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
function Shell({ children }: { children: React.ReactNode }) {
  return <div className="felt relative grid h-screen w-screen grid-cols-[25rem_1fr_25rem] grid-rows-[5rem_1fr_2.4rem] overflow-hidden text-white">{children}</div>
}
function Centered({ big, sub }: { big: string; sub: string }) {
  return (
    <div className="col-span-3 row-span-3 flex flex-col items-center justify-center">
      <div className="text-[8rem] font-black tracking-[0.1em]">{big}</div>
      <div className="text-[2rem] text-white/70">{sub}</div>
    </div>
  )
}
