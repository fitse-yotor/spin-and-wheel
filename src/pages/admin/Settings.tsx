import { useEffect, useState } from 'react'
import { Badge, Btn, Card, ErrorNote, Field, inp, PageHeader, useFetch } from '@/components/ui'
import { api } from '@/lib/api'
import { etb } from '@/lib/format'

type Cfg = Record<string, any>
const MONEY = new Set(['limits.minStake', 'limits.maxSelectionStake', 'limits.maxTicketStake', 'limits.maxPayout', 'compliance.largePayout'])

interface Def { key: string; label: string; hint?: string; kind?: 'text' | 'bool' | 'long' }
const SECTIONS: { title: string; note?: string; fields: Def[] }[] = [
  { title: 'Dog race', note: 'Own round cycle, running alongside the wheel. Odds come from each dog\'s published strength minus the margin below. Timings apply from the next race.', fields: [
    { key: 'dog.bettingSeconds', label: 'Betting open (seconds)' },
    { key: 'dog.closedSeconds', label: 'Betting closed before the off (seconds)' },
    { key: 'dog.raceSeconds', label: 'Race animation (seconds)' },
    { key: 'dog.resultSeconds', label: 'Result display (seconds)' },
    { key: 'dog.countdownSeconds', label: 'Big-digit countdown at the end of betting (seconds)' },
    { key: 'dog.marginPercent', label: 'House margin on every dog race price (%)', hint: 'A margin of 10 means every bet returns 90% of its fair value on average. Maximum 40.' },
    { key: 'dog.names', label: 'Dog names, traps 1 to 6 (comma separated)', kind: 'text' },
  ] },
  { title: 'Wheel round timing (seconds)', note: 'Applies from the next round.', fields: [
    { key: 'game.bettingSeconds', label: 'Betting open' },
    { key: 'game.closedSeconds', label: 'Betting closed before spin', hint: 'Pause between the cut-off and the wheel starting' },
    { key: 'game.spinSeconds', label: 'Wheel animation' },
    { key: 'game.resultSeconds', label: 'Result display' },
    { key: 'game.countdownSeconds', label: 'Big-digit countdown at the end of betting' },
  ] },
  { title: 'Stake and payout limits (ETB)', note: 'Enforced by the server on every ticket. Cashier screens cannot override them.', fields: [
    { key: 'limits.minStake', label: 'Minimum stake per bet' },
    { key: 'limits.maxSelectionStake', label: 'Maximum stake per bet' },
    { key: 'limits.maxTicketStake', label: 'Maximum stake per ticket' },
    { key: 'limits.maxPayout', label: 'Maximum payout per ticket' },
    { key: 'limits.maxSelections', label: 'Maximum bets per ticket' },
  ] },
  { title: 'Tickets and receipts', fields: [
    { key: 'ticket.expiryDays', label: 'Winning ticket valid for (days)' },
    { key: 'company.name', label: 'Company name', kind: 'text' },
    { key: 'receipt.footer', label: 'Receipt footer', kind: 'text' },
    { key: 'pos.autoPrint', label: 'Print automatically after booking', kind: 'bool' },
  ] },
  { title: 'Responsible gambling and compliance', note: 'Set these to match the licence conditions that apply to you before going live.', fields: [
    { key: 'compliance.minAge', label: 'Minimum age (cashier must confirm)' },
    { key: 'compliance.notice', label: 'Responsible gambling notice (display and receipts)', kind: 'long' },
    { key: 'compliance.largePayout', label: 'Raise an alert for payouts of (ETB) or more' },
    { key: 'compliance.cancelAlertCount', label: 'Alert after this many cancellations in one shift' },
  ] },
  { title: 'Sessions', fields: [
    { key: 'session.accessMinutes', label: 'Access token lifetime (minutes)' },
    { key: 'session.idleMinutes', label: 'Sign out after inactivity (minutes)' },
    { key: 'session.absoluteHours', label: 'Maximum session length (hours)' },
  ] },
]

export default function Settings() {
  const { data, error, reload } = useFetch<{ config: Cfg }>('/config')
  const [form, setForm] = useState<Record<string, string | boolean>>({})
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!data) return
    setForm(Object.fromEntries(Object.entries(data.config).filter(([k]) => k !== 'wheel.categoryColors').map(([k, v]) => [k, MONEY.has(k) ? String((v as number) / 100) : typeof v === 'boolean' ? v : Array.isArray(v) ? v.join(', ') : String(v)])))
  }, [data])
  const c = data?.config
  const total = c ? (Number(form['game.bettingSeconds']) || 0) + (Number(form['game.closedSeconds']) || 0) + (Number(form['game.spinSeconds']) || 0) + (Number(form['game.resultSeconds']) || 0) : 0

  async function save() {
    setErr('')
    setMsg('')
    const body: Cfg = {}
    for (const [k, v] of Object.entries(form)) {
      const orig = c![k]
      body[k] = Array.isArray(orig) ? String(v).split(',').map((x) => x.trim()) : typeof orig === 'boolean' ? v : typeof orig === 'number' ? (MONEY.has(k) ? Math.round(Number(v) * 100) : Number(v)) : v
    }
    try {
      await api('/config', { method: 'PUT', body })
      setMsg('Saved and recorded in the audit log.')
      reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    }
  }
  return (
    <>
      <PageHeader title="Game & limits" sub="Central controls. Every change is written to the audit log with the old and new value.">
        {c && (['WHEEL', 'DOGS'] as const).map((game) => {
          const key = game === 'DOGS' ? 'dog.paused' : 'game.paused'
          const name = game === 'DOGS' ? 'dog race' : 'wheel'
          return (
            <span key={game} className="flex items-center gap-2">
              <Badge tone={c[key] ? 'red' : 'green'}>{name} {c[key] ? 'paused' : 'running'}</Badge>
              <Btn onClick={async () => { if (c[key] || window.confirm(`Pause the ${name}? The current round will finish and no new round will start.`)) { await api(c[key] ? '/games/resume' : '/games/pause', { body: { game } }); reload() } }}>{c[key] ? `Resume ${name}` : `Pause ${name}`}</Btn>
            </span>
          )
        })}
        <Btn kind="primary" onClick={save}>Save changes</Btn>
      </PageHeader>
      <ErrorNote error={error || err} />
      {msg && <div className="mb-3 text-sm text-emerald-700">{msg}</div>}
      <div className="grid gap-4 lg:grid-cols-2">
        {SECTIONS.map((s) => (
          <Card key={s.title} title={s.title}>
            <div className="space-y-3 p-4">
              {s.note && <p className="text-xs text-soft">{s.note}</p>}
              {s.title.startsWith('Wheel round') && <p className="text-sm">Total round length: <b>{total} seconds</b></p>}
              {s.fields.map((f) => (
                <Field key={f.key} label={f.label} hint={f.hint ?? (MONEY.has(f.key) && form[f.key] !== undefined ? etb(Math.round(Number(form[f.key]) * 100)) : undefined)}>
                  {f.kind === 'bool' ? (
                    <input type="checkbox" checked={!!form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.checked })} />
                  ) : f.kind === 'long' ? (
                    <textarea className={inp} rows={3} value={String(form[f.key] ?? '')} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                  ) : (
                    <input className={inp} inputMode={f.kind === 'text' ? 'text' : 'decimal'} value={String(form[f.key] ?? '')} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                  )}
                </Field>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </>
  )
}
