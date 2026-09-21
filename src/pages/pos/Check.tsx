import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, ApiError } from '@/lib/api'
import { etb, fmtDateTime, gameNo, odds } from '@/lib/format'
import { usePos } from './PosApp'

interface Sel { market: string; label: string; stake: number; oddsX100: number; possibleWin: number; isWin: boolean | null; winAmount: number | null }
interface Ticket {
  ticketNumber: string
  status: string
  outcome: 'WON' | 'LOST' | 'PENDING' | 'CANCELLED' | 'ALREADY_PAID' | 'EXPIRED'
  gameId: number
  gameType?: 'WHEEL' | 'DOGS'
  shop: { name: string; code: string }
  foreignShop: boolean
  verified: boolean
  createdAt?: number
  cashier?: string
  totalStake?: number
  maxWin?: number
  winAmount?: number | null
  expiresAt?: number | null
  paidAt?: number | null
  paidAmount?: number | null
  paidBy?: string | null
  cancelledAt?: number | null
  result?: { number: number; category: string; order?: number[] } | null
  selections?: Sel[]
}

const HEAD: Record<string, { title: string; cls: string }> = {
  WON: { title: 'WINNER', cls: 'bg-go text-white' },
  LOST: { title: 'NOT A WINNER', cls: 'bg-[#8a8a8a] text-white' },
  PENDING: { title: 'PENDING — RESULT NOT DRAWN YET', cls: 'bg-amber text-white' },
  CANCELLED: { title: 'TICKET CANCELLED', cls: 'bg-[#8a8a8a] text-white' },
  ALREADY_PAID: { title: 'ALREADY PAID', cls: 'bg-info text-white' },
  EXPIRED: { title: 'TICKET EXPIRED', cls: 'bg-stop text-white' },
}

export default function Check() {
  const { info, reload, connected } = usePos()
  const [query, setQuery] = useState('')
  const [scan, setScan] = useState('')
  const [t, setT] = useState<Ticket | null>(null)
  const [notFound, setNotFound] = useState('')
  const [code, setCode] = useState('')
  const [pin, setPin] = useState('')
  const [apUser, setApUser] = useState('')
  const [apPin, setApPin] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [paid, setPaid] = useState<{ amount: number; ref: string } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  async function lookup(e?: FormEvent, q = query) {
    e?.preventDefault()
    const text = q.trim()
    if (!text) return
    setBusy(true)
    setErr('')
    setNotFound('')
    setPaid(null)
    try {
      const r = await api<Ticket>('/pos/tickets/lookup', { body: { query: text } })
      setT(r)
      setScan(/^SW1:/i.test(text) || /^[A-Z2-9]{16}$/i.test(text) ? text : '')
      setCode('')
      setPin('')
    } catch (er) {
      setT(null)
      setNotFound(er instanceof ApiError ? (er.code === 'NETWORK' ? 'Cannot reach the server. Try again.' : er.message) : 'Lookup failed')
    } finally {
      setBusy(false)
      setQuery('')
      input.current?.focus()
    }
  }

  const needsApproval = !!t && t.outcome === 'WON' && (t.winAmount ?? 0) > (info?.user.payoutLimit ?? Infinity)
  async function pay() {
    if (!t) return
    setBusy(true)
    setErr('')
    try {
      const r = await api<{ amount: number; ref: string }>('/pos/tickets/pay', {
        body: { ticketNumber: t.ticketNumber, code: code || undefined, scan: scan || undefined, pin, approverUsername: needsApproval ? apUser : undefined, approverPin: needsApproval ? apPin : undefined },
      })
      setPaid(r)
      setT({ ...t, outcome: 'ALREADY_PAID', status: 'PAID', paidAmount: r.amount, paidAt: Date.now(), paidBy: info?.user.cashierCode })
      reload()
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Payout failed')
      setPin('')
      setApPin('')
      if (er instanceof ApiError && er.code === 'ALREADY_PAID') lookup(undefined, t.ticketNumber)
    } finally {
      setBusy(false)
    }
  }
  const reset = () => {
    setT(null)
    setPaid(null)
    setErr('')
    setNotFound('')
    input.current?.focus()
  }
  const head = t ? (t.foreignShop ? { title: 'TICKET FROM ANOTHER SHOP', cls: 'bg-amber text-white' } : HEAD[t.outcome]) : null
  const ready = pin.length >= 4 && (t?.verified || code.length >= 4) && (!needsApproval || (apUser && apPin.length >= 4))

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-5">
      <form onSubmit={lookup} className="flex gap-3">
        <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} disabled={!connected} placeholder="Scan the QR code or barcode, or type the ticket number, then press Enter" autoComplete="off" spellCheck={false} className="flex-1 rounded border-2 border-line bg-panel px-4 py-4 font-mono text-2xl outline-none focus:border-amber disabled:opacity-40" />
        <button disabled={busy || !query.trim() || !connected} className="rounded bg-[#a5262a] px-8 text-xl font-black text-white disabled:opacity-40">CHECK</button>
      </form>
      <div className="-mt-2 text-xs text-mute">Barcode scanners work like a keyboard: click the box and scan. You can type only the last digits (e.g. 001238) for today’s tickets.</div>

      {notFound && <div role="alert" className="rounded bg-stop py-8 text-center text-3xl font-black text-white">{notFound.toUpperCase()}</div>}

      {t && head && (
        <div className="overflow-hidden rounded border border-line bg-panel">
          <div className={`px-6 py-4 text-center text-4xl font-black tracking-wider ${head.cls}`}>{head.title}</div>
          <div className="grid grid-cols-2 gap-x-10 gap-y-0 px-6 py-3 text-base">
            <Info k="Ticket" v={t.ticketNumber} mono />
            <Info k={t.gameType === 'DOGS' ? 'Dog race' : 'Game'} v={`#${gameNo(t.gameId)}`} />
            <Info k="Shop" v={`${t.shop.name} (${t.shop.code})`} />
            {t.foreignShop ? <Info k="Status" v={t.status.replace('_', ' ')} /> : <Info k="Issued" v={`${fmtDateTime(t.createdAt)} · ${t.cashier}`} />}
            {!t.foreignShop && (
              <>
                <Info k="Stake" v={etb(t.totalStake)} />
                {t.outcome === 'WON' && <Info k="Winning amount" v={etb(t.winAmount)} big />}
                {t.outcome === 'LOST' && <Info k="Ticket status" v="LOST" />}
                {t.outcome === 'PENDING' && <Info k="Possible win" v={etb(t.maxWin)} />}
                {t.outcome === 'ALREADY_PAID' && (
                  <>
                    <Info k="Paid" v={etb(t.paidAmount)} big />
                    <Info k="Paid by" v={t.paidBy ?? '—'} />
                    <Info k="Payment time" v={fmtDateTime(t.paidAt)} />
                  </>
                )}
                {t.outcome === 'EXPIRED' && <Info k="Expired on" v={fmtDateTime(t.expiresAt)} />}
                {t.result && <Info k="Result" v={t.result.order ? t.result.order.slice(0, 3).map((x, i) => `${['1st', '2nd', '3rd'][i]} ${x}`).join(' · ') : `${t.result.number} · ${t.result.category}`} />}
                {t.outcome === 'WON' && <Info k="Payment status" v="UNPAID" />}
                {t.outcome === 'WON' && t.expiresAt && <Info k="Collect before" v={fmtDateTime(t.expiresAt)} />}
              </>
            )}
          </div>
          {t.foreignShop && <div className="px-6 pb-6 text-mute">Prizes can only be paid at the shop that issued the ticket. Send the player to {t.shop.name}.</div>}

          {t.outcome === 'WON' && !t.foreignShop && (
            <div className="space-y-3 border-t border-line bg-panel2 p-6">
              <div className="grid grid-cols-3 gap-3">
                {!t.verified && (
                  <label className="block text-xs font-bold tracking-widest text-mute">VERIFICATION CODE (PRINTED ON TICKET)
                    <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={8} autoComplete="off" className="mt-1 w-full rounded border border-line bg-night px-3 py-3 font-mono text-xl tracking-[0.3em] text-ink outline-none focus:border-amber" />
                  </label>
                )}
                <label className="block text-xs font-bold tracking-widest text-mute">YOUR PIN
                  <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} maxLength={8} autoComplete="off" className="mt-1 w-full rounded border border-line bg-night px-3 py-3 text-center text-xl tracking-[0.4em] text-ink outline-none focus:border-amber" />
                </label>
                {t.verified && <div className="self-end pb-3 text-sm font-bold text-go">QR verified ✓</div>}
              </div>
              {needsApproval && (
                <div className="rounded border border-amber/60 bg-amber/10 p-3">
                  <div className="mb-2 text-sm font-bold text-amber">This payout is above your limit of {etb(info?.user.payoutLimit)}. A shop manager must approve it.</div>
                  <div className="grid grid-cols-2 gap-3">
                    <input placeholder="Manager username" value={apUser} onChange={(e) => setApUser(e.target.value)} autoComplete="off" className="rounded border border-line bg-night px-3 py-2 outline-none focus:border-amber" />
                    <input type="password" inputMode="numeric" placeholder="Manager PIN" value={apPin} onChange={(e) => setApPin(e.target.value.replace(/\D/g, ''))} maxLength={8} autoComplete="off" className="rounded border border-line bg-night px-3 py-2 outline-none focus:border-amber" />
                  </div>
                </div>
              )}
              {err && <div role="alert" className="text-lg font-bold text-stop">{err}</div>}
              <button onClick={pay} disabled={busy || !ready} className="w-full rounded bg-go py-5 text-3xl font-black tracking-wider text-white disabled:bg-[#cfcfcf] disabled:text-[#888]">
                {busy ? 'PROCESSING…' : `PAYOUT ${etb(t.winAmount)}`}
              </button>
            </div>
          )}
          {paid && (
            <div className="border-t border-line bg-go/15 p-6 text-center">
              <div className="text-3xl font-black text-go">PAID {etb(paid.amount)}</div>
              <div className="mt-1 font-mono text-sm text-mute">Reference {paid.ref}</div>
            </div>
          )}
          {!t.foreignShop && t.selections && (
            <div className="border-t border-line px-6 py-3">
              {t.selections.map((s, i) => (
                <div key={i} className="flex items-center justify-between py-1 text-base">
                  <span><span className="mr-2 text-mute">{s.market}</span><b>{s.label}</b> <span className="text-mute">@ {odds(s.oddsX100)}</span></span>
                  <span className="flex items-center gap-4">
                    <span className="text-mute">{etb(s.stake)}</span>
                    {s.isWin === null ? <span className="text-mute">—</span> : s.isWin ? <b className="text-go">WIN {etb(s.winAmount)}</b> : <span className="text-mute">lost</span>}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-line p-4 text-right">
            <button onClick={reset} className="rounded border border-line px-6 py-2 font-black tracking-widest text-mute hover:text-ink">NEXT TICKET</button>
          </div>
        </div>
      )}
    </div>
  )
}

const Info = ({ k, v, mono, big }: { k: string; v: string; mono?: boolean; big?: boolean }) => (
  <div className="flex items-baseline justify-between border-b border-line/60 py-1.5">
    <span className="text-sm font-bold tracking-widest text-mute">{k.toUpperCase()}</span>
    <span className={`${mono ? 'font-mono' : ''} ${big ? 'text-3xl font-black text-go' : 'font-bold'}`}>{v}</span>
  </div>
)
