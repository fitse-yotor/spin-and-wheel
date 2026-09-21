import { Badge, BarChart, Card, ErrorNote, PageHeader, Stat, Table, useFetch } from '@/components/ui'
import { etb, gameNo, num } from '@/lib/format'
import { useAuth } from '@/lib/auth'

interface Dash {
  scope: 'COMPANY' | 'SHOP'
  turnover: number
  payout: number
  ggr: number
  ticketsSold: number
  winningTickets: number
  activeShops: number
  onlineShops: number
  activeCashiers: number
  currentRound: { id: number; phase: string } | null
  rounds: { game: 'WHEEL' | 'DOGS'; id: number; phase: string }[]
  unpaidWinnings: number
  openAlerts: number | null
  hourly: { hour: number; turnover: number; tickets: number }[]
  days: { day: string; turnover: number; ggr: number }[]
}

export function Dashboard() {
  const { data: d, error } = useFetch<Dash>('/dashboard', 10_000)
  const hours = Array.from({ length: 24 }, (_, h) => ({ label: String(h), value: d?.hourly.find((x) => x.hour === h)?.turnover ?? 0 }))
  return (
    <>
      <PageHeader title="Dashboard" sub={d ? (d.scope === 'SHOP' ? 'Your shop, today (Africa/Addis_Ababa)' : 'All shops, today (Africa/Addis_Ababa). Refreshes every 10 seconds.') : ''} />
      <ErrorNote error={error} />
      {d && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Today's turnover" value={etb(d.turnover)} />
            <Stat label="Today's payout" value={etb(d.payout)} sub="paid to players" />
            <Stat label="Gross gaming revenue" value={etb(d.ggr)} tone={d.ggr >= 0 ? 'good' : 'bad'} sub="settled stakes − winnings" />
            <Stat label="Tickets sold" value={num(d.ticketsSold * 100)} />
            <Stat label="Winning tickets" value={num(d.winningTickets * 100)} />
            <Stat label={d.scope === 'SHOP' ? 'Shop status' : 'Active shops'} value={d.scope === 'SHOP' ? (d.onlineShops ? 'Online' : 'Offline') : `${d.activeShops}`} sub={d.scope === 'SHOP' ? undefined : `${d.onlineShops} connected now`} />
            <Stat label="Cashiers on shift" value={num(d.activeCashiers * 100)} />
            {(['WHEEL', 'DOGS'] as const).map((t) => {
              const r = d.rounds.find((x) => x.game === t)
              return <Stat key={t} label={t === 'WHEEL' ? 'Wheel round' : 'Dog race'} value={r ? `#${gameNo(r.id, 5)}` : 'Paused'} sub={r?.phase.replace('_', ' ')} />
            })}
          </div>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Unpaid winnings" value={etb(d.unpaidWinnings)} tone={d.unpaidWinnings > 0 ? 'warn' : undefined} sub="won, not yet collected" />
            {d.openAlerts !== null && <Stat label="Open alerts" value={d.openAlerts} tone={d.openAlerts ? 'bad' : 'good'} sub="suspicious activity" />}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Turnover by hour today"><div className="p-4"><BarChart data={hours} format={etb} /></div></Card>
            <Card title="Last 7 days — turnover and GGR">
              <div className="p-4">
                <BarChart data={last7(d.days)} format={etb} secondary="#b7791f" />
                <div className="mt-2 flex gap-4 text-xs text-soft"><span><i className="mr-1 inline-block h-2 w-2 bg-ink" />Turnover</span><span><i className="mr-1 inline-block h-2 w-2" style={{ background: '#b7791f' }} />GGR</span></div>
              </div>
            </Card>
          </div>
        </>
      )}
    </>
  )
}

function last7(days: Dash['days']) {
  const byDay = new Map(days.map((x) => [x.day, x]))
  return Array.from({ length: 7 }, (_, i) => {
    const key = new Date(Date.now() + 3 * 3600_000 - (6 - i) * 86_400_000).toISOString().slice(0, 10)
    const x = byDay.get(key)
    return { label: key.slice(5), value: x?.turnover ?? 0, value2: Math.max(0, x?.ggr ?? 0) }
  })
}

interface LiveShop { id: number; code: string; name: string; status: string; cashiers: number; tickets: number; turnover: number; payout: number; balance: number; online: boolean; posTerminals: number; displays: number }
interface Device { id: string; kind: string; shop: string | null; lastIp: string | null; lastSeen: number; status: string; userAgent: string }

export function Live() {
  const auth = useAuth()
  const { data, error } = useFetch<{ shops: LiveShop[]; rounds: { game: string; id: number; phase: string }[] }>('/live', 5000)
  const dev = useFetch<{ devices: Device[] }>(auth?.user.role === 'ADMIN' ? '/devices' : null, 15_000)
  return (
    <>
      <PageHeader title="Live monitoring" sub="Refreshes every 5 seconds. A shop is online while a cashier terminal or game display is connected.">
        {data?.rounds.map((r) => <Badge key={r.game} tone="amber">{r.game === 'DOGS' ? 'Race' : 'Round'} #{gameNo(r.id, 5)} · {r.phase.replace('_', ' ')}</Badge>)}
      </PageHeader>
      <ErrorNote error={error} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data?.shops.map((s) => (
          <Card key={s.id}>
            <div className="flex items-center justify-between border-b border-rule px-4 py-3">
              <div>
                <div className="font-bold">{s.name}</div>
                <div className="text-xs text-soft">{s.code}</div>
              </div>
              <div className="flex items-center gap-2">
                {s.status !== 'ACTIVE' && <Badge tone="amber">{s.status}</Badge>}
                <span className={`flex items-center gap-1.5 text-sm font-semibold ${s.online ? 'text-emerald-700' : 'text-zinc-500'}`}>
                  <i className={`inline-block h-2.5 w-2.5 rounded-full ${s.online ? 'bg-emerald-600' : 'bg-zinc-400'}`} />{s.online ? 'Online' : 'Offline'}
                </span>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 p-4 text-sm">
              <Row k="Cashiers on shift" v={s.cashiers} />
              <Row k="Tickets today" v={s.tickets} />
              <Row k="Turnover" v={etb(s.turnover)} />
              <Row k="Payout" v={etb(s.payout)} />
              <Row k="Cash in shop" v={etb(s.balance)} />
              <Row k="Terminals / displays" v={`${s.posTerminals} / ${s.displays}`} />
            </dl>
          </Card>
        ))}
      </div>
      {dev.data && (
        <Card className="mt-6" title="Known devices">
          <Table
            rows={dev.data.devices.slice(0, 30)}
            cols={[
              { key: 'id', label: 'Device', render: (d) => <span className="font-mono text-xs">{d.id.slice(0, 8)}</span> },
              { key: 'kind', label: 'Type' },
              { key: 'shop', label: 'Shop' },
              { key: 'lastIp', label: 'Last IP' },
              { key: 'lastSeen', label: 'Last seen', render: (d) => new Date(d.lastSeen).toLocaleString('en-GB') },
              { key: 'status', label: 'Status', render: (d) => <Badge tone={d.status === 'ACTIVE' ? 'green' : 'red'}>{d.status}</Badge> },
            ]}
          />
        </Card>
      )}
    </>
  )
}
const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div>
    <dt className="text-xs text-soft">{k}</dt>
    <dd className="font-semibold">{v}</dd>
  </div>
)
