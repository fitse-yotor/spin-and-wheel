import { useState } from 'react'
import { Modal } from '@/components/Modal'
import { Badge, Btn, Card, DateRange, ErrorNote, inp, PageHeader, sel, statusTone, Table, useFetch, qs } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { etb, fmtDateTime, gameNo, odds, todayKey } from '@/lib/format'

interface Row { ticketNumber: string; gameId: number; status: string; stake: number; winAmount: number | null; createdAt: number; shop: string; cashier: string }
const STATUSES = ['ACTIVE', 'BETTING_CLOSED', 'PENDING_RESULT', 'WON', 'LOST', 'PAID', 'CANCELLED', 'EXPIRED']

export default function Tickets() {
  const auth = useAuth()
  const admin = auth?.user.role === 'ADMIN'
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState(todayKey())
  const [to, setTo] = useState(todayKey())
  const [shopId, setShopId] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const shops = useFetch<{ shops: { id: number; name: string }[] }>(admin ? '/shops' : null)
  const { data, error } = useFetch<{ rows: Row[] }>(`/tickets${qs({ q, status, from, to, shopId })}`, 10_000)
  return (
    <>
      <PageHeader title="Tickets" sub="Ticket history. Confirmed tickets cannot be edited; open a ticket to see every step recorded against it." />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input className={inp + ' !w-56'} placeholder="Search ticket number" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={sel + ' !w-auto'} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>
        {admin && <select className={sel + ' !w-auto'} value={shopId} onChange={(e) => setShopId(e.target.value)} aria-label="Shop"><option value="">All shops</option>{shops.data?.shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
        <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }} />
      </div>
      <ErrorNote error={error} />
      <Card>
        <Table
          rows={data?.rows ?? []}
          onRow={(r) => setOpen(r.ticketNumber)}
          cols={[
            { key: 'ticketNumber', label: 'Ticket', className: 'font-mono' },
            { key: 'createdAt', label: 'Time', render: (r) => fmtDateTime(r.createdAt) },
            { key: 'gameId', label: 'Game', render: (r) => `#${gameNo(r.gameId)}` },
            { key: 'shop', label: 'Shop' },
            { key: 'cashier', label: 'Cashier' },
            { key: 'stake', label: 'Stake', align: 'right', render: (r) => etb(r.stake) },
            { key: 'winAmount', label: 'Win', align: 'right', render: (r) => (r.winAmount ? etb(r.winAmount) : '—') },
            { key: 'status', label: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status.replace('_', ' ')}</Badge> },
          ]}
        />
      </Card>
      {open && <Detail number={open} onClose={() => setOpen(null)} />}
    </>
  )
}

function Detail({ number, onClose }: { number: string; onClose: () => void }) {
  const { data, error } = useFetch<any>(`/tickets/${number}`)
  const t = data?.ticket
  return (
    <Modal onClose={onClose} wide>
      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-mono text-lg font-bold">{number}</h2>
            {t && <div className="text-sm text-soft">{t.shop} · {t.cashier} · game #{gameNo(t.gameId)} · {fmtDateTime(t.createdAt)}</div>}
          </div>
          {t && <Badge tone={statusTone(t.status)}>{t.status.replace('_', ' ')}</Badge>}
        </div>
        <ErrorNote error={error} />
        {t && (
          <>
            <div className="grid grid-cols-4 gap-3 text-sm">
              <Fact k="Total stake" v={etb(t.stake)} />
              <Fact k="Possible win" v={etb(t.maxWin)} />
              <Fact k="Winning amount" v={etb(t.winAmount)} />
              <Fact k="Paid" v={t.paidAt ? `${etb(t.paidAmount)} · ${fmtDateTime(t.paidAt)}` : '—'} />
              <Fact k="Printed" v={`${t.printCount}×`} />
              <Fact k="Age confirmed" v={t.ageConfirmed ? 'Yes' : 'No'} />
              <Fact k="Device" v={t.deviceId ? t.deviceId.slice(0, 8) : '—'} />
              <Fact k="IP" v={t.ip ?? '—'} />
            </div>
            <Table
              rows={data.selections}
              cols={[
                { key: 'market', label: 'Market' },
                { key: 'label', label: 'Selection', render: (s: any) => <b>{s.label}</b> },
                { key: 'oddsX100', label: 'Odds', align: 'right', render: (s: any) => odds(s.oddsX100) },
                { key: 'stake', label: 'Stake', align: 'right', render: (s: any) => etb(s.stake) },
                { key: 'possibleWin', label: 'Possible win', align: 'right', render: (s: any) => etb(s.possibleWin) },
                { key: 'isWin', label: 'Outcome', render: (s: any) => (s.isWin === null ? '—' : s.isWin ? <Badge tone="green">WIN {etb(s.winAmount)}</Badge> : <Badge>LOST</Badge>) },
              ]}
            />
            <div>
              <div className="mb-1 text-xs font-bold uppercase tracking-widest text-soft">Ledger entries</div>
              {data.transactions.map((x: any) => <div key={x.ref} className="flex justify-between border-b border-rule/60 py-1 text-sm"><span className="font-mono">{x.ref} · {x.type}</span><b className={x.amount < 0 ? 'text-red-700' : 'text-emerald-700'}>{etb(x.amount)}</b></div>)}
            </div>
            <div>
              <div className="mb-1 text-xs font-bold uppercase tracking-widest text-soft">Audit trail</div>
              {data.audit.map((a: any, i: number) => <div key={i} className="flex gap-3 border-b border-rule/60 py-1 text-sm"><span className="w-36 shrink-0 text-soft">{fmtDateTime(a.ts)}</span><b className="w-40 shrink-0">{a.action}</b><span className="truncate font-mono text-xs text-soft" title={a.details}>{a.details}</span></div>)}
            </div>
          </>
        )}
        <div className="flex justify-end"><Btn onClick={onClose}>Close</Btn></div>
      </div>
    </Modal>
  )
}
const Fact = ({ k, v }: { k: string; v: string }) => (
  <div><div className="text-[0.7rem] font-bold uppercase tracking-widest text-soft">{k}</div><div className="font-semibold">{v}</div></div>
)
