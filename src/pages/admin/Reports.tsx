import { useState } from 'react'
import { Badge, Btn, Card, DateRange, ErrorNote, PageHeader, sel, Stat, statusTone, Table, useFetch, qs, type Col } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { downloadCsv, etb, fmtDateTime, gameNo, todayKey } from '@/lib/format'

const TABS = [
  ['sales', 'Sales'],
  ['payouts', 'Payouts'],
  ['games', 'Games'],
  ['cashiers', 'Cashiers'],
  ['shops', 'Shops'],
] as const
type Tab = (typeof TABS)[number][0]
const m = (v: number | null | undefined) => (v === null || v === undefined ? '' : v / 100)

export default function Reports() {
  const auth = useAuth()
  const admin = auth?.user.role === 'ADMIN'
  const [tab, setTab] = useState<Tab>('sales')
  const [from, setFrom] = useState(todayKey())
  const [to, setTo] = useState(todayKey())
  const [shopId, setShopId] = useState('')
  const [groupBy, setGroupBy] = useState('date')
  const [status, setStatus] = useState('')
  const shops = useFetch<{ shops: { id: number; name: string }[] }>(admin ? '/shops' : null)
  const { data, error } = useFetch<any>(`/reports/${tab}${qs({ from, to, shopId, groupBy: tab === 'sales' ? groupBy : undefined, status: tab === 'payouts' ? status : undefined })}`)
  const rows: any[] = data?.rows ?? []

  const money = (k: string): Partial<Col<any>> => ({ align: 'right', render: (r) => etb(r[k]) })
  let cols: Col<any>[] = []
  let csv: Record<string, unknown>[] = []
  let foot: React.ReactNode = null
  const sum = (k: string) => rows.reduce((a, r) => a + (r[k] ?? 0), 0)
  const totalRow = (items: [string, string][]) => (
    <tr className="border-t-2 border-ink bg-paper font-bold"><td className="px-3 py-2">Total</td>{items.map(([, v], i) => <td key={i} className="px-3 py-2 text-right">{v}</td>)}</tr>
  )

  if (tab === 'sales') {
    cols = [
      { key: 'group', label: groupBy[0].toUpperCase() + groupBy.slice(1) },
      { key: 'tickets', label: 'Tickets', align: 'right' },
      { key: 'turnover', label: 'Turnover', ...money('turnover') },
      { key: 'cancelled', label: 'Cancelled', align: 'right', render: (r) => `${r.cancelled} (${etb(r.cancelledAmount)})` },
      { key: 'winnings', label: 'Winnings', ...money('winnings') },
      { key: 'paid', label: 'Paid out', ...money('paid') },
      { key: 'ggr', label: 'GGR', align: 'right', render: (r) => <b className={r.ggr < 0 ? 'text-red-700' : ''}>{etb(r.ggr)}</b> },
    ]
    csv = rows.map((r) => ({ [groupBy]: r.group, tickets: r.tickets, turnover_ETB: m(r.turnover), cancelled: r.cancelled, cancelled_ETB: m(r.cancelledAmount), winnings_ETB: m(r.winnings), paid_ETB: m(r.paid), ggr_ETB: m(r.ggr) }))
    foot = rows.length ? totalRow([['', String(sum('tickets'))], ['', etb(sum('turnover'))], ['', `${sum('cancelled')}`], ['', etb(sum('winnings'))], ['', etb(sum('paid'))], ['', etb(sum('ggr'))]]) : null
  } else if (tab === 'payouts') {
    cols = [
      { key: 'ticketNumber', label: 'Ticket', className: 'font-mono' },
      { key: 'gameId', label: 'Game', render: (r) => `#${gameNo(r.gameId)}` },
      { key: 'shop', label: 'Shop' },
      { key: 'issuedBy', label: 'Issued by' },
      { key: 'stake', label: 'Stake', ...money('stake') },
      { key: 'winAmount', label: 'Win', ...money('winAmount') },
      { key: 'status', label: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status === 'WON' ? 'UNPAID' : r.status}</Badge> },
      { key: 'paidBy', label: 'Paid by', render: (r) => r.paidBy ?? '—' },
      { key: 'paidAt', label: 'Paid at', render: (r) => fmtDateTime(r.paidAt) },
    ]
    csv = rows.map((r) => ({ ticket: r.ticketNumber, game: r.gameId, shop: r.shop, issued_by: r.issuedBy, stake_ETB: m(r.stake), win_ETB: m(r.winAmount), status: r.status, paid_by: r.paidBy, paid_at: r.paidAt ? new Date(r.paidAt).toISOString() : '' }))
  } else if (tab === 'games') {
    cols = [
      { key: 'gameId', label: 'Game', render: (r) => <><b>#{gameNo(r.gameId)}</b><div className="text-xs text-soft">{r.game === 'DOGS' ? 'Dog race' : 'Wheel'}</div></> },
      { key: 'startTime', label: 'Start', render: (r) => fmtDateTime(r.startTime) },
      { key: 'closeTime', label: 'Betting closed', render: (r) => fmtDateTime(r.closeTime) },
      { key: 'resultNumber', label: 'Result', render: (r) => (r.resultNumber === null ? <span className="text-soft">{r.status.replace('_', ' ')}</span> : r.finishingOrder ? `Order ${r.finishingOrder.join(' – ')}` : `${r.resultNumber} · ${r.category} · ${r.multiplier.toFixed(2)}x`) },
      { key: 'tickets', label: 'Tickets', align: 'right' },
      { key: 'stakes', label: 'Total stakes', ...money('stakes') },
      { key: 'winnings', label: 'Total winnings', ...money('winnings') },
      { key: 'companyResult', label: 'Company result', align: 'right', render: (r) => <b className={r.companyResult < 0 ? 'text-red-700' : ''}>{etb(r.companyResult)}</b> },
    ]
    csv = rows.map((r) => ({ game: r.gameId, type: r.game, order: r.finishingOrder?.join('-') ?? '', start: new Date(r.startTime).toISOString(), closed: new Date(r.closeTime).toISOString(), result: r.resultNumber, category: r.category, tickets: r.tickets, stakes_ETB: m(r.stakes), winnings_ETB: m(r.winnings), company_result_ETB: m(r.companyResult) }))
    foot = rows.length ? totalRow([['', ''], ['', ''], ['', ''], ['', String(sum('tickets'))], ['', etb(sum('stakes'))], ['', etb(sum('winnings'))], ['', etb(sum('companyResult'))]]) : null
  } else if (tab === 'cashiers') {
    cols = [
      { key: 'shiftId', label: 'Shift', render: (r) => `#${r.shiftId}` },
      { key: 'cashier', label: 'Cashier', render: (r) => <>{r.cashier}<div className="text-xs text-soft">{r.shop}</div></> },
      { key: 'openedAt', label: 'Opened', render: (r) => fmtDateTime(r.openedAt) },
      { key: 'openingCash', label: 'Opening cash', ...money('openingCash') },
      { key: 'sales', label: 'Sales', ...money('sales') },
      { key: 'payouts', label: 'Payouts', ...money('payouts') },
      { key: 'adjustments', label: 'Adjustments', ...money('adjustments') },
      { key: 'expected', label: 'Closing balance', ...money('expected') },
      { key: 'difference', label: 'Difference', align: 'right', render: (r) => (r.status === 'OPEN' ? <Badge tone="amber">OPEN</Badge> : <b className={r.difference ? 'text-red-700' : 'text-emerald-700'}>{etb(r.difference)}</b>) },
    ]
    csv = rows.map((r) => ({ shift: r.shiftId, cashier: r.cashier, shop: r.shop, opened: new Date(r.openedAt).toISOString(), opening_ETB: m(r.openingCash), sales_ETB: m(r.sales), payouts_ETB: m(r.payouts), adjustments_ETB: m(r.adjustments), expected_ETB: m(r.expected), counted_ETB: m(r.counted), difference_ETB: m(r.difference) }))
  } else {
    cols = [
      { key: 'shop', label: 'Shop', render: (r) => <><b>{r.shop}</b><div className="text-xs text-soft">{r.region}</div></> },
      { key: 'tickets', label: 'Tickets', align: 'right' },
      { key: 'turnover', label: 'Total turnover', ...money('turnover') },
      { key: 'payouts', label: 'Total payouts', ...money('payouts') },
      { key: 'ggr', label: 'Gross gaming revenue', align: 'right', render: (r) => <b className={r.ggr < 0 ? 'text-red-700' : ''}>{etb(r.ggr)}</b> },
      { key: 'averageStake', label: 'Average stake', ...money('averageStake') },
      { key: 'walletBalance', label: 'Wallet balance', ...money('walletBalance') },
    ]
    csv = rows.map((r) => ({ shop: r.shop, region: r.region, tickets: r.tickets, turnover_ETB: m(r.turnover), payouts_ETB: m(r.payouts), ggr_ETB: m(r.ggr), average_stake_ETB: m(r.averageStake), wallet_ETB: m(r.walletBalance) }))
    foot = rows.length ? totalRow([['', String(sum('tickets'))], ['', etb(sum('turnover'))], ['', etb(sum('payouts'))], ['', etb(sum('ggr'))], ['', ''], ['', etb(sum('walletBalance'))]]) : null
  }

  return (
    <>
      <PageHeader title="Reports" sub="Dates are Africa/Addis_Ababa. Turnover excludes cancelled tickets. GGR = stakes on settled tickets − winnings.">
        <Btn onClick={() => downloadCsv(`${tab}-${from}_${to}.csv`, csv)} disabled={!rows.length}>Export CSV</Btn>
      </PageHeader>
      <div className="mb-3 flex gap-1 border-b border-rule">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === k ? 'border-ink' : 'border-transparent text-soft hover:text-ink'}`}>{label}</button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }} />
        {admin && <select className={sel + ' !w-auto'} value={shopId} onChange={(e) => setShopId(e.target.value)} aria-label="Shop"><option value="">All shops</option>{shops.data?.shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
        {tab === 'sales' && <select className={sel + ' !w-auto'} value={groupBy} onChange={(e) => setGroupBy(e.target.value)} aria-label="Group by">{['date', 'shop', 'cashier', 'game', 'region'].map((g) => <option key={g} value={g}>By {g}</option>)}</select>}
        {tab === 'payouts' && <select className={sel + ' !w-auto'} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All winning tickets</option><option value="PAID">Paid</option><option value="WON">Unpaid</option><option value="EXPIRED">Expired</option></select>}
      </div>
      <ErrorNote error={error} />
      {tab === 'payouts' && data?.summary && (
        <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Winning tickets" value={data.summary.winningTickets} />
          <Stat label="Paid tickets" value={data.summary.paidTickets} />
          <Stat label="Paid amount" value={etb(data.summary.paidAmount)} />
          <Stat label="Unpaid winnings" value={etb(data.summary.unpaidWinnings)} tone={data.summary.unpaidWinnings ? 'warn' : undefined} />
          <Stat label="Expired (forfeited)" value={etb(data.summary.expiredWinnings)} />
        </div>
      )}
      <Card><Table cols={cols} rows={rows} foot={foot} /></Card>
    </>
  )
}
