import { useState } from 'react'
import { Modal } from '@/components/Modal'
import { Badge, Btn, Card, DateRange, ErrorNote, Field, inp, PageHeader, sel, Stat, statusTone, Table, useFetch, qs } from '@/components/ui'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { downloadCsv, etb, fmtDateTime, todayKey } from '@/lib/format'

interface Txn { id: number; ref: string; shop: string; shopId: number; type: string; amount: number; balanceAfter: number; user: string | null; note: string | null; reversesId: number | null; reversed: boolean; createdAt: number }
const TYPES = ['OPENING_BALANCE', 'TICKET_SALE', 'TICKET_CANCEL', 'PAYOUT', 'DEPOSIT', 'WITHDRAWAL', 'ADJUSTMENT', 'REVERSAL']

export function Ledger() {
  const auth = useAuth()
  const admin = auth?.user.role === 'ADMIN'
  const shops = useFetch<{ shops: { id: number; name: string }[] }>('/shops')
  const [shopId, setShopId] = useState('')
  const [from, setFrom] = useState(todayKey())
  const [to, setTo] = useState(todayKey())
  const [type, setType] = useState('')
  const [entry, setEntry] = useState(false)
  const [err, setErr] = useState('')
  const eff = shopId || (admin ? '' : String(auth?.user.shopId ?? ''))
  const { data, error, reload } = useFetch<{ rows: Txn[]; byType: { type: string; n: number; total: number }[]; balance: number }>(`/ledger${qs({ shopId: eff, from, to, type })}`)

  return (
    <>
      <PageHeader title="Shop ledger" sub="Append-only. Nothing is edited or deleted; corrections are posted as reversal entries.">
        <Btn onClick={() => downloadCsv(`ledger-${from}_${to}.csv`, (data?.rows ?? []).map((r) => ({ ref: r.ref, time: new Date(r.createdAt).toISOString(), shop: r.shop, type: r.type, amount_ETB: r.amount / 100, balance_after_ETB: r.balanceAfter / 100, user: r.user, note: r.note })))} disabled={!data?.rows.length}>Export CSV</Btn>
        <Btn kind="primary" disabled={!eff} onClick={() => setEntry(true)} title={eff ? '' : 'Choose a shop first'}>New entry</Btn>
      </PageHeader>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }} />
        {admin && <select className={sel + ' !w-auto'} value={shopId} onChange={(e) => setShopId(e.target.value)} aria-label="Shop"><option value="">All shops</option>{shops.data?.shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
        <select className={sel + ' !w-auto'} value={type} onChange={(e) => setType(e.target.value)} aria-label="Type"><option value="">All types</option>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
      </div>
      <ErrorNote error={error || err} />
      {data && (
        <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label={eff ? 'Current shop balance' : 'Balance, all shops'} value={etb(data.balance)} />
          {data.byType.filter((b) => ['TICKET_SALE', 'PAYOUT', 'DEPOSIT', 'WITHDRAWAL'].includes(b.type)).map((b) => <Stat key={b.type} label={b.type.replace('_', ' ')} value={etb(b.total)} sub={`${b.n} entries`} />)}
        </div>
      )}
      <Card>
        <Table
          rows={data?.rows ?? []}
          cols={[
            { key: 'ref', label: 'Reference', className: 'font-mono text-xs' },
            { key: 'createdAt', label: 'Time', render: (r) => fmtDateTime(r.createdAt) },
            { key: 'shop', label: 'Shop' },
            { key: 'type', label: 'Type', render: (r) => <>{r.type.replace('_', ' ')}{r.reversed && <span className="ml-1"><Badge tone="amber">REVERSED</Badge></span>}</> },
            { key: 'amount', label: 'Amount', align: 'right', render: (r) => <b className={r.amount < 0 ? 'text-red-700' : 'text-emerald-700'}>{r.amount > 0 ? '+' : ''}{etb(r.amount)}</b> },
            { key: 'balanceAfter', label: 'Balance after', align: 'right', render: (r) => etb(r.balanceAfter) },
            { key: 'user', label: 'By', render: (r) => r.user ?? 'System' },
            { key: 'note', label: 'Note', className: 'max-w-[18rem] truncate' },
            { key: 'act', label: '', render: (r) => admin && ['DEPOSIT', 'WITHDRAWAL', 'ADJUSTMENT'].includes(r.type) && !r.reversed ? <Btn kind="ghost" onClick={async () => { const note = window.prompt(`Reason for reversing ${r.ref}?`); if (note) { try { await api(`/ledger/${r.id}/reverse`, { body: { note } }); reload() } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } } }}>Reverse</Btn> : null },
          ]}
        />
      </Card>
      {entry && <EntryForm shopId={Number(eff)} admin={!!admin} onClose={() => setEntry(false)} onSaved={() => { setEntry(false); reload() }} />}
    </>
  )
}

function EntryForm({ shopId, admin, onClose, onSaved }: { shopId: number; admin: boolean; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState('DEPOSIT')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  return (
    <Modal onClose={onClose}>
      <div className="space-y-3 p-5">
        <h2 className="text-lg font-bold">New ledger entry</h2>
        <Field label="Type" hint={type === 'DEPOSIT' ? 'Cash added to the shop (float top-up)' : type === 'WITHDRAWAL' ? 'Cash removed from the shop (banking, collection)' : 'Correction. Use a negative amount to reduce the balance.'}>
          <select className={sel} value={type} onChange={(e) => setType(e.target.value)}><option>DEPOSIT</option><option>WITHDRAWAL</option>{admin && <option>ADJUSTMENT</option>}</select>
        </Field>
        <Field label="Amount (ETB)"><input className={inp} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(type === 'ADJUSTMENT' ? /[^\d.-]/g : /[^\d.]/g, ''))} /></Field>
        <Field label="Note (required)"><input className={inp} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <ErrorNote error={err} />
        <div className="flex justify-end gap-2"><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!amount || note.length < 3} onClick={async () => { try { await api('/ledger', { body: { shopId, type, amount: Math.round(Number(amount) * 100), note } }); onSaved() } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } }}>Post entry</Btn></div>
      </div>
    </Modal>
  )
}

interface ShiftRow { id: number; cashier: string; code: string | null; shop: string; openedAt: number; closedAt: number | null; status: string; openingFloat: number; expected: number | null; counted: number | null; difference: number | null; reconciledAt: number | null; reconcileNote: string | null; closeNote: string | null }

export function Shifts() {
  const auth = useAuth()
  const admin = auth?.user.role === 'ADMIN'
  const [from, setFrom] = useState(todayKey())
  const [to, setTo] = useState(todayKey())
  const shops = useFetch<{ shops: { id: number; name: string }[] }>(admin ? '/shops' : null)
  const [shopId, setShopId] = useState('')
  const { data, error, reload } = useFetch<{ rows: ShiftRow[] }>(`/shifts${qs({ from, to, shopId })}`, 15_000)
  const [rec, setRec] = useState<ShiftRow | null>(null)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  return (
    <>
      <PageHeader title="Shift reconciliation" sub="Compare each cashier's counted cash with the system's expected closing cash, then sign off." />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }} />
        {admin && <select className={sel + ' !w-auto'} value={shopId} onChange={(e) => setShopId(e.target.value)} aria-label="Shop"><option value="">All shops</option>{shops.data?.shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
      </div>
      <ErrorNote error={error} />
      <Card>
        <Table
          rows={data?.rows ?? []}
          cols={[
            { key: 'id', label: 'Shift', render: (r) => `#${r.id}` },
            { key: 'cashier', label: 'Cashier', render: (r) => <>{r.cashier}<div className="text-xs text-soft">{r.shop}</div></> },
            { key: 'openedAt', label: 'Opened', render: (r) => fmtDateTime(r.openedAt) },
            { key: 'closedAt', label: 'Closed', render: (r) => (r.closedAt ? fmtDateTime(r.closedAt) : <Badge tone="amber">OPEN</Badge>) },
            { key: 'openingFloat', label: 'Opening float', align: 'right', render: (r) => etb(r.openingFloat) },
            { key: 'expected', label: 'Expected cash', align: 'right', render: (r) => etb(r.expected) },
            { key: 'counted', label: 'Counted', align: 'right', render: (r) => etb(r.counted) },
            { key: 'difference', label: 'Difference', align: 'right', render: (r) => (r.difference === null ? '—' : <b className={r.difference ? 'text-red-700' : 'text-emerald-700'}>{r.difference > 0 ? '+' : ''}{etb(r.difference)}</b>) },
            { key: 'reconciledAt', label: 'Reconciled', render: (r) => (r.reconciledAt ? <Badge tone="green">DONE</Badge> : r.status === 'CLOSED' ? <Btn onClick={() => { setRec(r); setNote(''); setErr('') }}>Reconcile</Btn> : '—') },
            { key: 'closeNote', label: 'Cashier note', className: 'max-w-[14rem] truncate' },
          ]}
        />
      </Card>
      {rec && (
        <Modal onClose={() => setRec(null)}>
          <div className="space-y-3 p-5">
            <h2 className="text-lg font-bold">Reconcile shift #{rec.id}</h2>
            <p className="text-sm">{rec.cashier} · expected {etb(rec.expected)} · counted {etb(rec.counted)} · <b className={rec.difference ? 'text-red-700' : 'text-emerald-700'}>difference {etb(rec.difference)}</b></p>
            <Field label={rec.difference ? 'Explanation (required)' : 'Note (optional)'}><input className={inp} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <ErrorNote error={err} />
            <div className="flex justify-end gap-2"><Btn onClick={() => setRec(null)}>Cancel</Btn><Btn kind="primary" onClick={async () => { try { await api(`/shifts/${rec.id}/reconcile`, { body: { note } }); setRec(null); reload() } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } }}>Sign off</Btn></div>
          </div>
        </Modal>
      )}
    </>
  )
}
void statusTone
