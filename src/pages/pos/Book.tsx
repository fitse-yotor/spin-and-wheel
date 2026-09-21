import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ReceiptData } from '@/components/Receipt'
import { api, ApiError } from '@/lib/api'
import { worstCase } from '@dog/shared/rules'
import { DogBets, type DogMarket } from '@dog/web/DogBets'
import { etb, gameNo, num, odds } from '@/lib/format'
import { ReceiptModal } from './ReceiptModal'
import { usePos } from './PosApp'

interface Opt { id: number; key: string; code: string; label: string; tone: string; numbers: number[]; dogs?: number[]; oddsX100: number }
interface Market { id: number; code: string; name: string; kind: string; options: Opt[] }
interface Line { key: string; stake: number } // stake in whole ETB; key identifies the bet (o<id> on the wheel, d:<code> on the race)

const CHIPS = [10, 20, 50, 100, 200, 500]
// Where each market sits on the cashier screen. Unknown (custom) markets go into "Extra Bet".
const SLOT: Record<string, 'sector' | 'exact' | 'row1' | 'row2' | 'extra'> = { SECTOR: 'sector', EXACT: 'exact', DOZEN: 'row1', PARITY: 'row2', COLORS: 'row2', HALF: 'row2', COMBO: 'extra', MIRROR: 'extra', TWINS: 'extra' }
const slotOf = (m: Market) => SLOT[m.code] ?? 'extra'

/** Opens the cashier's shift right where selling is blocked: count the drawer, enter it, start. */
function StartShift({ onStarted }: { onStarted: () => Promise<void> }) {
  const [float, setFloat] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function start() {
    setBusy(true)
    setErr('')
    try {
      await api('/pos/shift/start', { body: { openingFloat: Math.round(Number(float) * 100) } })
      await onStarted()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start the shift')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); start() }} className="mx-auto mt-4 max-w-xs space-y-3 text-left">
      <p className="text-sm text-[#555]">Count the cash in your drawer and enter it as your opening float to begin selling.</p>
      <label className="block text-xs font-bold tracking-widest text-[#666]">OPENING FLOAT (ETB)
        <input autoFocus inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value.replace(/[^\d.]/g, ''))} placeholder="10000" className="mt-1 w-full rounded border-2 border-[#333] px-3 py-2 text-2xl font-bold outline-none focus:border-[#a5262a]" />
      </label>
      {err && <div role="alert" className="text-sm font-semibold text-[#c62828]">{err}</div>}
      <button disabled={busy || float === ''} className="w-full rounded bg-[#a5262a] py-3 text-lg font-bold text-white disabled:opacity-40">{busy ? 'Starting…' : 'Start shift'}</button>
    </form>
  )
}

export default function Book() {
  const { gameType, info, state, blocked, reload } = usePos()
  const dogs = gameType === 'DOGS'
  const g = state?.game
  const [markets, setMarkets] = useState<Market[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [defaultStake, setDefaultStake] = useState(20)
  const [ageOk, setAgeOk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState<ReceiptData | null>(null)
  const [last, setLast] = useState<Line[]>([])
  const [quickOpen, setQuickOpen] = useState(false)
  const [quick, setQuick] = useState('')
  const typing = useRef(false)
  const attempt = useRef<{ sig: string; key: string } | null>(null)

  // Bet options for the round that is open (odds can differ per round)
  const gameId = g?.id
  useEffect(() => {
    if (!gameId) return
    api<{ markets: (Omit<Market, 'options'> & { options: Omit<Opt, 'key'>[] })[]; game: string }>(`/pos/markets?game=${gameType}`)
      .then((r) => {
        if (r.game !== gameType) return
        setMarkets(r.markets.map((m) => ({ ...m, options: m.options.map((o) => ({ ...o, key: gameType === 'DOGS' ? `d:${o.code}` : `o${o.id}` })) })))
      })
      .catch(() => {})
  }, [gameId, gameType])
  // Switching game starts a fresh ticket: bets from one game can never go onto the other's ticket.
  useEffect(() => {
    setMarkets([])
    setLines([])
    setActive(null)
    setAgeOk(false)
    setError('')
    setLast([])
    attempt.current = null
  }, [gameType])
  const opts = useMemo(() => new Map(markets.flatMap((m) => m.options.map((o) => [o.key, { o, m }] as const))), [markets])
  const liveLines = useMemo(() => (opts.size ? lines.filter((l) => opts.has(l.key)) : lines), [lines, opts])
  const inSlot = (s: string) => markets.filter((m) => slotOf(m) === s)

  // ── totals (same arithmetic as the server; the server re-validates everything) ──
  const limits = info?.limits
  const calc = useMemo(() => {
    const total = liveLines.reduce((a, l) => a + l.stake * 100, 0)
    const win = (l: Line) => Math.floor((l.stake * 100 * (opts.get(l.key)?.o.oddsX100 ?? 0)) / 100)
    // Worst case for the house: the single outcome that pays this ticket the most.
    const maxWin = !g
      ? 0
      : dogs
        ? worstCase(liveLines.map((l) => ({ rule: opts.get(l.key)?.o.code ?? '', payout: win(l) })))
        : Math.max(0, ...g.wheel.map((s) => liveLines.filter((l) => opts.get(l.key)?.o.numbers.includes(s.number)).reduce((a, l) => a + win(l), 0)))
    return { total, maxWin, win }
  }, [liveLines, opts, g, dogs])

  const problem = useMemo(() => {
    if (!limits) return null
    if (liveLines.length > limits.maxSelections) return `At most ${limits.maxSelections} bets per ticket`
    for (const l of liveLines) {
      const o = opts.get(l.key)!.o
      if (l.stake * 100 < limits.minStake) return `${o.label}: minimum stake is ${etb(limits.minStake)}`
      if (l.stake * 100 > limits.maxSelectionStake) return `${o.label}: maximum stake per bet is ${etb(limits.maxSelectionStake)}`
    }
    if (calc.total > limits.maxTicketStake) return `Ticket stake is over the ${etb(limits.maxTicketStake)} limit`
    if (calc.maxWin > limits.maxPayout) return `Possible win is over the ${etb(limits.maxPayout)} payout limit`
    return null
  }, [liveLines, limits, calc, opts])

  const canBook = !blocked && !busy && liveLines.length > 0 && !problem && (info?.minAge === 0 || ageOk)

  // ── editing the ticket ──
  const stakeCap = limits ? limits.maxSelectionStake / 100 : 5000
  const add = (o: Opt) => {
    if (blocked) return
    setError('')
    setActive(o.key)
    typing.current = false
    setLines((ls) => {
      const ex = ls.find((l) => l.key === o.key)
      if (ex) return ls.map((l) => (l.key === o.key ? { ...l, stake: Math.min(stakeCap, l.stake + defaultStake) } : l))
      return [...ls, { key: o.key, stake: defaultStake }]
    })
  }
  const addAll = (code: string) => markets.find((m) => m.code === code)?.options.forEach(add)
  const setStake = (id: string, stake: number) => setLines((ls) => ls.map((l) => (l.key === id ? { ...l, stake: Math.max(0, Math.min(stakeCap, stake)) } : l)))
  const remove = (id: string) => {
    setLines((ls) => ls.filter((l) => l.key !== id))
    setActive((a) => (a === id ? null : a))
  }
  const clear = () => {
    setLines([])
    setActive(null)
    setAgeOk(false)
    setError('')
    attempt.current = null
  }
  const target = () => active ?? liveLines[liveLines.length - 1]?.key
  const digit = (d: number) => {
    const id = target()
    if (id === undefined) return
    const cur = lines.find((l) => l.key === id)?.stake ?? 0
    setActive(id)
    setStake(id, typing.current ? cur * 10 + d : d)
    typing.current = true
  }
  const backspace = () => {
    const id = target()
    if (id === undefined) return
    setStake(id, Math.floor((lines.find((l) => l.key === id)?.stake ?? 0) / 10))
    typing.current = true
  }
  const chip = (v: number) => {
    setDefaultStake(v)
    const id = target()
    if (id !== undefined) setStake(id, v)
    typing.current = false
  }
  const stakeShown = (active !== null ? lines.find((l) => l.key === active)?.stake : undefined) ?? defaultStake
  const quickAdd = () => {
    const o = markets.find((m) => m.kind === 'EXACT')?.options.find((x) => x.label === quick.trim())
    if (o) add(o)
    else if (quick) setError(`No bet on "${quick}" on this wheel`)
    setQuick('')
  }

  // ── booking ──
  const book = useCallback(async () => {
    if (!canBook) return
    setBusy(true)
    setError('')
    const body = {
      game: gameType,
      selections: liveLines.map((l) => { const o = opts.get(l.key)!.o; return dogs ? { code: o.code, stake: l.stake * 100 } : { optionId: o.id, stake: l.stake * 100 } }),
      ageConfirmed: ageOk || info?.minAge === 0,
    }
    const sig = JSON.stringify(body)
    // The same cart keeps the same idempotency key, so a retry can never sell the ticket twice.
    if (attempt.current?.sig !== sig) attempt.current = { sig, key: crypto.randomUUID() }
    try {
      let out: { receipt: ReceiptData } | null = null
      for (let i = 0; i < 3 && !out; i++) {
        try {
          out = await api('/pos/tickets', { body, headers: { 'x-idempotency-key': attempt.current.key } })
        } catch (e) {
          if (!(e instanceof ApiError && e.code === 'NETWORK') || i === 2) throw e
          await new Promise((r) => setTimeout(r, 900))
        }
      }
      setLast(liveLines)
      setReceipt(out!.receipt)
      clear()
      reload()
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'NETWORK'
          ? 'The server could not be reached, so this ticket is NOT confirmed. Do not take cash. Check Results before trying again.'
          : e instanceof Error ? e.message : 'Booking failed',
      )
      if (e instanceof ApiError && e.code === 'BETTING_CLOSED') attempt.current = null
    } finally {
      setBusy(false)
    }
  }, [canBook, liveLines, ageOk, info?.minAge, reload, gameType, dogs, opts])

  // ── keyboard: digits set the stake, Enter books, Esc clears, ↑↓ change row, Del removes ──
  const kb = useRef({ book, digit, backspace, clear, remove, active, liveLines })
  kb.current = { book, digit, backspace, clear, remove, active, liveLines }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = kb.current
      const el = e.target as HTMLElement
      const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
      if (document.querySelector('[role=dialog]')) return
      if (e.key === 'Enter' && !(inField && el.dataset.quick)) { e.preventDefault(); k.book(); return }
      if (inField) return
      if (/^\d$/.test(e.key)) k.digit(Number(e.key))
      else if (e.key === 'Backspace') { e.preventDefault(); k.backspace() }
      else if (e.key === 'Escape') k.clear()
      else if (e.key === 'Delete' && k.active !== null) k.remove(k.active)
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const ids = k.liveLines.map((l) => l.key)
        const i = ids.indexOf(k.active ?? '')
        setActive(ids[Math.max(0, Math.min(ids.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))] ?? null)
        typing.current = false
      } else if (e.key === '/') { e.preventDefault(); setQuickOpen(true); setTimeout(() => document.getElementById('quick-number')?.focus(), 0) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Short ticket text for race bets so it fits the narrow tape: W3, P3, FC 3→5, QN 3+5
  const tip = (code: string, o: Opt) => {
    const d = o.dogs ?? []
    return code === 'WIN' ? `Win ${d[0]}` : code === 'PLACE' ? `Place ${d[0]}` : code === 'FC' ? `FC ${d[0]}→${d[1]}` : `QN ${d[0]}+${d[1]}`
  }

  // ── pieces ──
  const selected = (o: Opt) => liveLines.find((l) => l.key === o.key)
  const Btn = ({ o, className = '', style, children }: { o: Opt; className?: string; style?: React.CSSProperties; children?: ReactNode }) => {
    const line = selected(o)
    return (
      <button title={`${o.label} pays ${odds(o.oddsX100)}x`} onClick={() => add(o)} disabled={!!blocked} className={`relative h-11 rounded-sm text-base font-medium text-white transition disabled:opacity-50 ${line ? 'ring-[3px] ring-[#ffb300] ring-inset' : ''} ${className}`} style={style}>
        {children ?? o.label}
        {line && <span className="absolute right-0.5 top-0 rounded bg-black/75 px-1 text-[0.65rem] font-bold text-[#ffd34d]">{line.stake}</span>}
      </button>
    )
  }
  const grey = 'bg-[#5b5b5b] hover:bg-[#4a4a4a]'
  const Box = ({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) => (
    <fieldset className={`min-w-0 rounded border border-[#c9c9c9] px-2 pb-2 pt-0 ${className}`}>
      {title && <legend className="px-1 text-[0.72rem] text-[#555]">{title}</legend>}
      {children}
    </fieldset>
  )
  const exact = inSlot('exact')[0]
  const exactOpts = exact?.options ?? []
  const zeros = exactOpts.filter((o) => o.tone === 'GREEN' || o.label === '0')
  const rest = exactOpts.filter((o) => !zeros.includes(o)).sort((a, b) => Number(a.label) - Number(b.label))
  const cols = Math.ceil(rest.length / 4)
  const tileColor = (o: Opt) => (o.tone ? info?.categoryColors[o.tone] : undefined)
  const tile = (o: Opt) => ({ background: tileColor(o) === '#16181b' ? '#111' : tileColor(o) ?? '#5b5b5b' })
  const showTicketRows = liveLines

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_7.6rem_5.4rem_17rem] gap-2 p-2">
      {/* Bets */}
      <section className="relative flex min-h-0 flex-col gap-1.5 overflow-auto">
        {dogs && (
          <DogBets
            dogs={g?.race?.dogs ?? []}
            markets={markets as unknown as DogMarket[]}
            stakeOf={(key) => liveLines.find((l) => l.key === key)?.stake}
            onPick={(o) => add(o as unknown as Opt)}
            disabled={!!blocked}
          />
        )}
        {!dogs && inSlot('sector').map((m) => (
          <Box key={m.id} title={m.name.replace(/s$/, '')}>
            <div className="flex gap-2">{m.options.map((o) => <Btn key={o.id} o={o} className={`flex-1 ${grey}`} />)}</div>
          </Box>
        ))}
        {!dogs && exact && (
          <Box title="Exact Number">
            <div className="flex gap-1.5">
              {zeros.map((o) => <Btn key={o.id} o={o} className="w-[4.2rem] !h-auto text-2xl" style={tile(o)} />)}
              <div className="grid flex-1 gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gridTemplateRows: 'repeat(4, 2.6rem)' }}>
                {Array.from({ length: cols }, (_, c) => rest.slice(c * 4, c * 4 + 4).reverse().map((o, r) => (
                  <Btn key={o.id} o={o} className="!h-full text-lg" style={{ ...tile(o), gridColumn: c + 1, gridRow: r + 1 }} />
                )))}
              </div>
            </div>
          </Box>
        )}
        {!dogs && <Box>
          <div className="mt-1.5 grid gap-1.5">
            {inSlot('row1').map((m) => <div key={m.id} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${m.options.length}, minmax(0,1fr))` }}>{m.options.map((o) => <Btn key={o.id} o={o} className={grey} />)}</div>)}
            <div className="flex gap-2">{inSlot('row2').flatMap((m) => m.options).map((o) => <Btn key={o.id} o={o} className={`flex-1 ${grey}`} />)}</div>
          </div>
        </Box>}
        {!dogs && inSlot('extra').length > 0 && (
          <Box title="Extra Bet">
            <div className="mt-1 grid grid-cols-4 gap-1.5">{inSlot('extra').flatMap((m) => m.options).map((o) => <Btn key={o.id} o={o} className={grey} />)}</div>
          </Box>
        )}
        {!markets.length && <div className="p-6 text-[#666]">Loading bet options…</div>}
        {blocked && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/95 p-6 text-center">
            <div className="w-full max-w-md">
              <div className={`text-2xl font-bold tracking-wider ${blocked.startsWith('CONNECTION') ? 'text-[#c62828]' : 'text-[#a5262a]'}`}>{blocked}</div>
              {blocked.startsWith('START') && <StartShift onStarted={reload} />}
              {blocked === 'BETTING CLOSED' && <div className="mt-2 text-sm text-[#666]">Bets open again automatically when the next round starts.</div>}
            </div>
          </div>
        )}
      </section>

      {/* Quicktips */}
      <Box title="Quicktips" className="h-fit">
        <div className="mt-1 flex flex-col gap-1.5">
          {dogs ? (
            <>
              {(() => {
                const ranked = [...(g?.race?.dogs ?? [])].sort((a, b) => a.winOdds - b.winOdds)
                const pick = (code: string) => markets.flatMap((m) => m.options).find((o) => o.code === code)
                const [fav, second] = ranked
                const tip = (label: string, code: string | undefined) => {
                  const o = code ? pick(code) : undefined
                  return <button onClick={() => o && add(o)} disabled={!!blocked || !o} className={`h-11 rounded-sm text-xs font-medium leading-tight text-white ${grey} disabled:opacity-50`}>{label}</button>
                }
                return (
                  <>
                    {tip('Favourite to win', fav && `WIN:${fav.trap}`)}
                    {tip('Favourite top 3', fav && `PLACE:${fav.trap}`)}
                    {tip('Top two either order', fav && second && `QN:${Math.min(fav.trap, second.trap)}-${Math.max(fav.trap, second.trap)}`)}
                    {tip('Favourite then second', fav && second && `FC:${fav.trap}-${second.trap}`)}
                  </>
                )
              })()}
            </>
          ) : (
            <>
              <button onClick={() => { setQuickOpen((v) => !v); setTimeout(() => document.getElementById('quick-number')?.focus(), 0) }} disabled={!!blocked} className={`h-11 rounded-sm text-sm font-medium text-white ${grey} disabled:opacity-50`}>Exact Number</button>
              {quickOpen && <input id="quick-number" data-quick="1" value={quick} inputMode="numeric" placeholder="No. ↵" onChange={(e) => setQuick(e.target.value.replace(/\D/g, '').slice(0, 3))} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); quickAdd() } }} className="h-9 w-full min-w-0 rounded border border-[#999] px-2 text-center text-lg font-bold outline-none focus:border-[#0f2a5c]" />}
              {markets.some((m) => m.code === 'COLORS') && <button onClick={() => addAll('COLORS')} disabled={!!blocked} className={`h-11 rounded-sm text-sm font-medium text-white ${grey} disabled:opacity-50`}>Colors</button>}
              {markets.some((m) => m.code === 'DOZEN') && <button onClick={() => addAll('DOZEN')} disabled={!!blocked} className={`h-11 rounded-sm text-sm font-medium text-white ${grey} disabled:opacity-50`}>Dozens</button>}
              {markets.some((m) => m.code === 'PARITY') && <button onClick={() => addAll('PARITY')} disabled={!!blocked} className={`h-11 rounded-sm text-sm font-medium text-white ${grey} disabled:opacity-50`}>Even / Odd</button>}
            </>
          )}
          {last.length > 0 && <button onClick={() => { setLines(last); setActive(last[0].key) }} disabled={!!blocked} className="mt-2 h-11 rounded-sm border border-[#999] text-xs font-medium text-[#333] disabled:opacity-40">Repeat last ticket</button>}
        </div>
      </Box>

      {/* Stake */}
      <Box title="Stake" className="h-fit">
        <div className="mt-1 flex flex-col gap-1.5">
          {CHIPS.map((v) => <button key={v} onClick={() => chip(v)} className={`h-9 rounded-sm text-base font-medium text-white ${stakeShown === v ? 'bg-[#a5262a]' : grey}`}>{v}</button>)}
          <input aria-label="Stake" inputMode="numeric" value={stakeShown || ''} onChange={(e) => { const v = Number(e.target.value.replace(/\D/g, '') || 0); active !== null ? setStake(active, v) : setDefaultStake(v) }} className="h-9 w-full min-w-0 rounded border-2 border-[#333] text-center text-lg font-bold outline-none focus:border-[#a5262a]" />
          <button onClick={() => { const id = target(); if (id !== undefined) setStake(id, 0); else setDefaultStake(0); typing.current = false }} className="h-9 rounded-sm bg-[#8a8a8a] text-xs font-medium leading-tight text-white hover:bg-[#777]">Clear Stake</button>
        </div>
      </Box>

      {/* Ticket */}
      <Box title="Ticket" className="flex min-h-0 flex-col">
        <div className="flex min-h-0 flex-1 flex-col rounded-sm border border-[#333]">
          <div className="grid grid-cols-[3.2rem_1fr_2.8rem_3.6rem_1.2rem] border-b border-[#999] px-1 py-0.5 text-[0.7rem] font-bold">
            <span>Stake</span><span>| Tip</span><span>| Odds</span><span>| Win</span><span />
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {showTicketRows.map((l) => {
              const { o, m } = opts.get(l.key)!
              const bad = l.stake * 100 < (limits?.minStake ?? 0) || l.stake * 100 > (limits?.maxSelectionStake ?? Infinity)
              return (
                <div key={l.key} onClick={() => { setActive(l.key); typing.current = false }} className={`grid cursor-pointer grid-cols-[3.2rem_1fr_2.8rem_3.6rem_1.2rem] items-center px-1 py-1 text-sm ${active === l.key ? 'bg-[#fff3c4]' : ''}`}>
                  <b className={bad ? 'text-[#c62828]' : ''}>{l.stake}</b>
                  <span className="truncate" title={dogs ? `${m.name} ${o.label}` : o.label}>{dogs ? tip(m.code, o) : o.label}</span>
                  <span>{odds(o.oddsX100)}</span>
                  <span>{num(calc.win(l))}</span>
                  <button aria-label={`Remove ${o.label}`} onClick={(e) => { e.stopPropagation(); remove(l.key) }} className="text-[#a5262a]">×</button>
                </div>
              )
            })}
            {!showTicketRows.length && <div className="p-3 text-center text-xs text-[#888]">Choose a bet, then type or tap the stake.</div>}
          </div>
          <div className="border-t border-[#333] px-1 py-1 text-sm">
            <div className="flex justify-between"><span>Total Stake</span><b className="tabular-nums">{(calc.total / 100).toFixed(2)}</b></div>
            <div className="flex justify-between"><span>Potential Return</span><b className="tabular-nums">{(calc.maxWin / 100).toFixed(2)}</b></div>
          </div>
        </div>
        <div className="mt-1 min-h-[2.2rem] text-xs font-semibold text-[#c62828]" role="alert">{error || problem || ''}</div>
        {(info?.minAge ?? 0) > 0 && (
          <label className="mb-1.5 flex cursor-pointer items-center gap-2 rounded border border-[#c9c9c9] px-2 py-1.5 text-xs">
            <input type="checkbox" checked={ageOk} onChange={(e) => setAgeOk(e.target.checked)} className="h-4 w-4" /> Player is {info?.minAge}+ (ID checked if in doubt)
          </label>
        )}
        <button onClick={clear} disabled={!lines.length} className="mb-1.5 h-11 rounded-sm bg-[#e4e4e4] text-base font-medium text-[#555] disabled:opacity-60">Clear Ticket</button>
        <button onClick={book} disabled={!canBook} className="h-12 rounded-sm bg-[#7d1b1f] text-lg font-medium text-white disabled:bg-[#8a94a6]">{busy ? 'Printing…' : 'Print Ticket'}</button>
        <div className="mt-1 text-center text-[0.65rem] text-[#777]">{dogs ? 'Race' : 'Game'} #{gameNo(g?.id)} · Enter = print</div>
      </Box>

      {receipt && <ReceiptModal receipt={receipt} autoPrint={!!info?.autoPrint} onClose={() => setReceipt(null)} />}
    </div>
  )
}
