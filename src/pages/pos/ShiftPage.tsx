import { useState, type FormEvent } from 'react'
import { api } from '@/lib/api'
import { etb, fmtDateTime } from '@/lib/format'
import { usePos, type Shift } from './PosApp'

export default function ShiftPage() {
  const { info, reload, connected } = usePos()
  const shift = info?.shift
  const [float, setFloat] = useState('')
  const [counted, setCounted] = useState('')
  const [pin, setPin] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [closed, setClosed] = useState<Shift | null>(null)

  async function start(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await api('/pos/shift/start', { body: { openingFloat: Math.round(Number(float) * 100) } })
      setFloat('')
      setClosed(null)
      await reload()
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }
  async function close(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      const r = await api<{ shift: Shift }>('/pos/shift/close', { body: { countedCash: Math.round(Number(counted) * 100), pin, note } })
      setClosed(r.shift)
      setCounted('')
      setPin('')
      setNote('')
      await reload()
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Failed')
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-5">
      {closed && (
        <div className="rounded border border-line bg-panel p-6">
          <div className="text-2xl font-black">Shift closed</div>
          <p className="mt-1 text-mute">Hand the counted cash and this summary to your shop manager for reconciliation.</p>
          <Summary s={closed} />
          <div className={`mt-4 rounded p-4 text-center text-2xl font-black ${closed.difference === 0 ? 'bg-go/20 text-go' : 'bg-stop/20 text-stop'}`}>
            {closed.difference === 0 ? 'CASH MATCHES' : `${(closed.difference ?? 0) > 0 ? 'OVER' : 'SHORT'} BY ${etb(Math.abs(closed.difference ?? 0))}`}
          </div>
        </div>
      )}

      {!shift ? (
        <form onSubmit={start} className="space-y-4 rounded border border-line bg-panel p-6">
          <div className="text-2xl font-black">Start shift</div>
          <p className="text-mute">Count the cash in your drawer and enter it as the opening float. You cannot sell or pay tickets without an open shift.</p>
          <label className="block text-xs font-bold tracking-widest text-mute">OPENING FLOAT (ETB)
            <input autoFocus inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value.replace(/[^\d.]/g, ''))} className="mt-1 w-full rounded border border-line bg-night px-3 py-3 text-3xl font-black text-ink outline-none focus:border-amber" placeholder="10000" />
          </label>
          {err && <div role="alert" className="font-bold text-stop">{err}</div>}
          <button disabled={busy || float === '' || !connected} className="w-full rounded bg-[#a5262a] py-4 text-xl font-black text-white disabled:opacity-40">START SHIFT</button>
        </form>
      ) : (
        <>
          <div className="rounded border border-line bg-panel p-6">
            <div className="flex items-baseline justify-between">
              <div className="text-2xl font-black">Current shift <span className="text-mute">#{shift.id}</span></div>
              <div className="text-sm text-mute">opened {fmtDateTime(shift.openedAt)}</div>
            </div>
            <Summary s={shift} />
          </div>
          <form onSubmit={close} className="space-y-4 rounded border border-line bg-panel p-6">
            <div className="text-2xl font-black">Close shift</div>
            <p className="text-mute">Count all cash in the drawer. The system compares it with the expected closing cash of <b className="text-ink">{etb(shift.expectedCash)}</b>.</p>
            <div className="grid grid-cols-2 gap-4">
              <label className="block text-xs font-bold tracking-widest text-mute">COUNTED CASH (ETB)
                <input inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value.replace(/[^\d.]/g, ''))} className="mt-1 w-full rounded border border-line bg-night px-3 py-3 text-2xl font-black text-ink outline-none focus:border-amber" />
              </label>
              <label className="block text-xs font-bold tracking-widest text-mute">YOUR PIN
                <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} maxLength={8} className="mt-1 w-full rounded border border-line bg-night px-3 py-3 text-center text-2xl tracking-[0.4em] text-ink outline-none focus:border-amber" />
              </label>
            </div>
            <label className="block text-xs font-bold tracking-widest text-mute">NOTE (OPTIONAL)
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className="mt-1 w-full rounded border border-line bg-night px-3 py-2 text-ink outline-none focus:border-amber" />
            </label>
            {err && <div role="alert" className="font-bold text-stop">{err}</div>}
            <button disabled={busy || counted === '' || pin.length < 4 || !connected} className="w-full rounded bg-stop py-4 text-xl font-black text-white disabled:opacity-40">CLOSE SHIFT AND SUBMIT SETTLEMENT</button>
          </form>
        </>
      )}
    </div>
  )
}

function Summary({ s }: { s: Shift }) {
  const rows: [string, string, boolean?][] = [
    ['Opening float', etb(s.openingFloat)],
    ['Ticket sales', etb(s.sales)],
    ['Cancellations (refunds)', `− ${etb(s.cancellations)}`],
    ['Payouts', `− ${etb(s.payouts)}`],
    ['Expected closing cash', etb(s.expectedCash), true],
    ['Tickets sold', String(s.ticketCount - s.cancelledCount)],
    ['Tickets paid', String(s.paidCount)],
  ]
  return (
    <div className="mt-4 divide-y divide-line">
      {rows.map(([k, v, bold]) => (
        <div key={k} className={`flex justify-between py-2 ${bold ? 'text-xl font-black' : ''}`}>
          <span className={bold ? '' : 'text-mute'}>{k}</span>
          <span className={bold ? 'text-amber' : 'font-bold'}>{v}</span>
        </div>
      ))}
    </div>
  )
}
