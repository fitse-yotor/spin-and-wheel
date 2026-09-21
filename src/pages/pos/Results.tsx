import { useCallback, useEffect, useState } from 'react'
import type { ReceiptData } from '@/components/Receipt'
import { PinModal } from '@/components/Modal'
import { api } from '@/lib/api'
import { etb, fmtTime, gameNo } from '@/lib/format'
import { ReceiptModal } from './ReceiptModal'
import { usePos } from './PosApp'

interface Recent { ticketNumber: string; gameId: number; status: string; outcome: string; totalStake: number; winAmount: number | null; createdAt: number }
const STYLE: Record<string, string> = { WON: 'bg-[#1f9d4d] text-white', LOST: 'bg-[#bdbdbd] text-[#333]', PENDING: 'bg-[#f0a500] text-black', CANCELLED: 'bg-[#bdbdbd] text-[#333] line-through', ALREADY_PAID: 'bg-[#1e6fb3] text-white', EXPIRED: 'bg-[#c62828] text-white' }
const chip = (c: string) => (c === 'RED' ? 'bg-[#c8161d]' : c === 'GREEN' ? 'bg-[#25a244]' : 'bg-[#14161a]')

/** Latest draws, plus this cashier's tickets today (reprint / cancel). */
export default function Results() {
  const { gameType, info, state, now, reload } = usePos()
  const g = state?.game
  const [tickets, setTickets] = useState<Recent[]>([])
  const [pinFor, setPinFor] = useState<{ kind: 'cancel' | 'reprint'; t: Recent } | null>(null)
  const [receipt, setReceipt] = useState<ReceiptData | null>(null)
  const load = useCallback(() => api<{ tickets: Recent[] }>('/pos/tickets/recent', { background: true }).then((r) => setTickets(r.tickets)).catch(() => {}), [])
  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load])
  const cancelOpen = g?.phase === 'BETTING_OPEN' && now < g.closesAt

  return (
    <div className="grid h-full grid-cols-[18rem_1fr] gap-4 p-4">
      <section>
        <h2 className="mb-2 text-sm font-bold tracking-widest text-[#555]">{gameType === 'DOGS' ? 'LATEST RACES' : 'LATEST DRAWS'}</h2>
        <div className="space-y-1">
          {state?.recent.slice(0, 12).map((r) => (
            <div key={r.gameId} className="flex items-center gap-2">
              <span className="w-16 text-sm tabular-nums text-[#555]">#{gameNo(r.gameId, 3)}</span>
              <span className={`flex h-8 w-14 items-center justify-center rounded-sm text-lg font-bold ${r.order ? '' : chip(r.category)}`} style={r.order ? { background: r.color, color: r.color === '#f4f4f4' || r.color === '#f59e0b' ? '#141414' : '#fff', border: '1px solid rgba(0,0,0,0.3)' } : { color: '#fff' }}>{r.number}</span>
              <span className="text-xs text-[#666]">{r.order ? r.order.slice(0, 3).join(' – ') : `${r.category} · x${r.multiplier}`}</span>
            </div>
          ))}
          {!state?.recent.length && <div className="text-sm text-[#888]">No draws yet.</div>}
        </div>
      </section>
      <section className="min-w-0">
        <h2 className="mb-2 text-sm font-bold tracking-widest text-[#555]">MY TICKETS TODAY</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-[#bbb] text-left text-xs text-[#666]"><th className="py-1">Ticket</th><th>Time</th><th>Game</th><th className="text-right">Stake</th><th className="text-right">Win</th><th className="pl-4">Status</th><th /></tr></thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.ticketNumber} className="border-b border-[#e2e2e2]">
                <td className="py-1.5 font-mono">{t.ticketNumber}</td>
                <td>{fmtTime(t.createdAt, false)}</td>
                <td>#{gameNo(t.gameId, 3)}</td>
                <td className="text-right">{etb(t.totalStake)}</td>
                <td className="text-right">{t.outcome === 'WON' || t.outcome === 'ALREADY_PAID' ? etb(t.winAmount) : '—'}</td>
                <td className="pl-4"><span className={`rounded px-1.5 py-0.5 text-[0.7rem] font-bold ${STYLE[t.outcome]}`}>{t.outcome.replace('_', ' ')}</span></td>
                <td className="space-x-3 text-right">
                  <button onClick={() => setPinFor({ kind: 'reprint', t })} className="font-semibold underline">Reprint</button>
                  {t.status === 'ACTIVE' && cancelOpen && g?.id === t.gameId && <button onClick={() => setPinFor({ kind: 'cancel', t })} className="font-semibold text-[#c62828] underline">Cancel</button>}
                </td>
              </tr>
            ))}
            {!tickets.length && <tr><td colSpan={7} className="py-8 text-center text-[#888]">No tickets yet today.</td></tr>}
          </tbody>
        </table>
      </section>

      {pinFor && (
        <PinModal
          title={pinFor.kind === 'cancel' ? 'Cancel ticket' : 'Reprint ticket'}
          detail={<>{pinFor.t.ticketNumber}<br />{pinFor.kind === 'cancel' ? `Refund ${etb(pinFor.t.totalStake)} to the player.` : 'A copy marked DUPLICATE will be printed and logged.'}</>}
          confirmLabel={pinFor.kind === 'cancel' ? 'CANCEL TICKET' : 'REPRINT'}
          onClose={() => setPinFor(null)}
          onConfirm={async (pin) => {
            if (pinFor.kind === 'cancel') await api('/pos/tickets/cancel', { body: { ticketNumber: pinFor.t.ticketNumber, pin } })
            else setReceipt((await api<{ receipt: ReceiptData }>('/pos/tickets/reprint', { body: { ticketNumber: pinFor.t.ticketNumber, pin } })).receipt)
            setPinFor(null)
            reload()
            load()
          }}
        />
      )}
      {receipt && <ReceiptModal receipt={receipt} autoPrint={!!info?.autoPrint} onClose={() => setReceipt(null)} />}
    </div>
  )
}
