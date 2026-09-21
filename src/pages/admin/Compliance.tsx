import { useState } from 'react'
import { Badge, Btn, Card, DateRange, ErrorNote, inp, PageHeader, sel, Stat, statusTone, Table, useFetch, qs } from '@/components/ui'
import { api } from '@/lib/api'
import { downloadCsv, etb, fmtDateTime, todayKey } from '@/lib/format'

interface Alert { id: number; ts: number; severity: string; kind: string; message: string; shop: string | null; user: string | null; status: string; reviewedAt: number | null; note: string | null }

export default function Compliance() {
  const [status, setStatus] = useState('OPEN')
  const { data, error, reload } = useFetch<{ rows: Alert[] }>(`/alerts${qs({ status })}`, 15_000)
  const cfg = useFetch<{ config: Record<string, any> }>('/config')
  const integ = useFetch<{ audit: { ok: boolean; checked: number; brokenAt: number | null }; ledger: { ok: boolean; problems: string[] } }>('/integrity')
  const [err, setErr] = useState('')
  const c = cfg.data?.config
  async function mark(a: Alert, next: string) {
    const note = window.prompt(`${next === 'REPORTED' ? 'Reference / note for the regulatory report' : 'Note'} (optional)`) ?? ''
    try {
      await api(`/alerts/${a.id}`, { method: 'PUT', body: { status: next, note } })
      reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    }
  }
  return (
    <>
      <PageHeader title="Compliance & alerts" sub="Suspicious-activity monitoring, integrity checks and regulatory exports.">
        <Btn onClick={() => downloadCsv(`suspicious-activity-${todayKey()}.csv`, (data?.rows ?? []).map((a) => ({ id: a.id, time: new Date(a.ts).toISOString(), severity: a.severity, kind: a.kind, shop: a.shop, staff: a.user, message: a.message, status: a.status, review_note: a.note })))} disabled={!data?.rows.length}>Export alerts (CSV)</Btn>
      </PageHeader>
      <ErrorNote error={error || err} />
      <div className="mb-4 grid gap-3 lg:grid-cols-4">
        <Stat label="Audit trail integrity" value={integ.data ? (integ.data.audit.ok ? 'Intact' : 'BROKEN') : '…'} tone={integ.data?.audit.ok ? 'good' : 'bad'} sub={integ.data ? `${integ.data.audit.checked} entries hash-verified` : ''} />
        <Stat label="Ledger integrity" value={integ.data ? (integ.data.ledger.ok ? 'Balanced' : 'MISMATCH') : '…'} tone={integ.data?.ledger.ok ? 'good' : 'bad'} sub="wallets equal ledger totals" />
        <Stat label="Minimum age" value={c ? `${c['compliance.minAge']}+` : '…'} sub="cashier confirms on every ticket" />
        <Stat label="Max payout / ticket" value={c ? etb(c['limits.maxPayout']) : '…'} sub={c ? `large-payout alert at ${etb(c['compliance.largePayout'])}` : ''} />
      </div>
      {integ.data && !integ.data.ledger.ok && <div className="mb-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{integ.data.ledger.problems.join(' · ')}</div>}
      <Card title="Suspicious activity" actions={<div className="flex items-center gap-2"><select className={sel + ' !w-auto'} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All</option><option>OPEN</option><option>REVIEWED</option><option>REPORTED</option><option>DISMISSED</option></select><Btn onClick={() => integ.reload()}>Re-verify integrity</Btn></div>}>
        <Table
          rows={data?.rows ?? []}
          empty="No alerts. Rules: repeated failed sign-ins or PINs, large payouts, frequent cancellations, guessed ticket numbers, shift cash differences, device IP changes."
          cols={[
            { key: 'ts', label: 'Time', render: (a) => fmtDateTime(a.ts) },
            { key: 'severity', label: 'Severity', render: (a) => <Badge tone={statusTone(a.severity)}>{a.severity}</Badge> },
            { key: 'kind', label: 'Type', className: 'font-mono text-xs' },
            { key: 'message', label: 'Details', className: 'max-w-[26rem]' },
            { key: 'shop', label: 'Shop', render: (a) => a.shop ?? '—' },
            { key: 'status', label: 'Status', render: (a) => <Badge tone={statusTone(a.status)}>{a.status}</Badge> },
            { key: 'act', label: '', render: (a) => (a.status === 'OPEN' ? <span className="flex gap-1"><Btn onClick={() => mark(a, 'REVIEWED')}>Reviewed</Btn><Btn onClick={() => mark(a, 'REPORTED')}>Reported</Btn><Btn kind="ghost" onClick={() => mark(a, 'DISMISSED')}>Dismiss</Btn></span> : a.note ?? '') },
          ]}
        />
      </Card>
      <Card className="mt-4" title="Before production">
        <ul className="list-disc space-y-1 p-4 pl-8 text-sm">
          <li>Confirm minimum age, stake limits, payout limits, ticket validity, return-to-player levels and reporting duties with the Ethiopian licensing authority, and set them under Game &amp; limits.</li>
          <li>Suspicious-transaction alerts here are a monitoring aid; filing to the regulator remains a manual, human decision. Use “Reported” to record that it was done.</li>
          <li>Self-exclusion needs player registration, which this first version deliberately does not have.</li>
        </ul>
      </Card>
    </>
  )
}

export function AuditLog() {
  const [from, setFrom] = useState(todayKey())
  const [to, setTo] = useState(todayKey())
  const [action, setAction] = useState('')
  const [q, setQ] = useState('')
  const { data, error } = useFetch<{ rows: any[]; actions: string[] }>(`/audit${qs({ from, to, action, q })}`, 15_000)
  return (
    <>
      <PageHeader title="Audit log" sub="Every entry is chained to the previous one by hash, so removing or editing history is detectable. Showing the latest 500." />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }} />
        <select className={sel + ' !w-auto'} value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action"><option value="">All actions</option>{data?.actions.map((a) => <option key={a}>{a}</option>)}</select>
        <input className={inp + ' !w-56'} placeholder="Search id or details" value={q} onChange={(e) => setQ(e.target.value)} />
        <Btn onClick={() => downloadCsv(`audit-${from}_${to}.csv`, (data?.rows ?? []).map((r) => ({ id: r.id, time: new Date(r.ts).toISOString(), action: r.action, entity: r.entity, entity_id: r.entity_id, actor: r.username, role: r.actor_role, shop: r.shop, ip: r.ip, device: r.device_id, details: r.details })))} disabled={!data?.rows.length}>Export CSV</Btn>
      </div>
      <ErrorNote error={error} />
      <Card>
        <Table
          rows={data?.rows ?? []}
          cols={[
            { key: 'id', label: '#', className: 'text-soft' },
            { key: 'ts', label: 'Time', render: (r) => new Date(r.ts).toLocaleString('en-GB', { timeZone: 'Africa/Addis_Ababa' }) },
            { key: 'action', label: 'Action', render: (r) => <b>{r.action}</b> },
            { key: 'entity', label: 'Entity', render: (r) => `${r.entity}${r.entity_id ? ' ' + r.entity_id : ''}`, className: 'font-mono text-xs' },
            { key: 'username', label: 'By', render: (r) => r.username ?? r.actor_role },
            { key: 'shop', label: 'Shop', render: (r) => r.shop ?? '—' },
            { key: 'ip', label: 'IP / device', render: (r) => <span className="text-xs text-soft">{r.ip ?? '—'}{r.device_id ? ` · ${r.device_id.slice(0, 6)}` : ''}</span> },
            { key: 'details', label: 'Details', render: (r) => <span className="block max-w-[22rem] truncate font-mono text-xs text-soft" title={r.details}>{r.details}</span> },
          ]}
        />
      </Card>
    </>
  )
}
