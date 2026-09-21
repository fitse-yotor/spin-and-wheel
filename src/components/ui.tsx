import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '@/lib/api'
import { todayKey } from '@/lib/format'

// ── data loading ────────────────────────────────────────────────────────────
export function useFetch<T>(path: string | null, refreshMs = 0) {
  // Remember which path the data belongs to, so switching queries never shows the previous query's rows.
  const [stored, setStored] = useState<{ path: string; value: T } | null>(null)
  const data = stored && stored.path === path ? stored.value : null
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)
  const load = useCallback(async () => {
    if (!path) return
    const my = ++seq.current
    try {
      const r = await api<T>(path, { background: refreshMs > 0 })
      if (my === seq.current) {
        setStored({ path, value: r })
        setError('')
      }
    } catch (e) {
      if (my === seq.current) setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [path])
  useEffect(() => {
    setLoading(true)
    load()
    if (!refreshMs) return
    const t = setInterval(load, refreshMs)
    return () => clearInterval(t)
  }, [load, refreshMs])
  return { data, error, loading, reload: load }
}

export const qs = (o: Record<string, string | number | null | undefined>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

// ── layout bits ─────────────────────────────────────────────────────────────
export const inp = 'w-full rounded border border-rule bg-white px-2.5 py-1.5 text-sm outline-none focus:border-ink'
export const sel = inp

export function PageHeader({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-soft">{sub}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

export const Card = ({ children, className = '', title, actions }: { children: ReactNode; className?: string; title?: string; actions?: ReactNode }) => (
  <section className={`rounded-md border border-rule bg-card ${className}`}>
    {title && (
      <div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
        <h2 className="text-xs font-bold uppercase tracking-widest text-soft">{title}</h2>
        {actions}
      </div>
    )}
    {children}
  </section>
)

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' | 'warn' }) {
  const c = tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : ''
  return (
    <div className="rounded-md border border-rule bg-card px-4 py-3">
      <div className="text-[0.7rem] font-bold uppercase tracking-widest text-soft">{label}</div>
      <div className={`mt-1 text-2xl font-bold leading-tight ${c}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-soft">{sub}</div>}
    </div>
  )
}

const btnBase = 'inline-flex items-center justify-center rounded px-3 py-1.5 text-sm font-semibold disabled:opacity-40'
export const Btn = ({ kind = 'default', className = '', ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'default' | 'primary' | 'danger' | 'ghost' }) => (
  <button
    {...p}
    className={`${btnBase} ${kind === 'primary' ? 'bg-ink text-white hover:bg-black' : kind === 'danger' ? 'bg-red-700 text-white hover:bg-red-800' : kind === 'ghost' ? 'text-soft hover:bg-paper hover:text-ink' : 'border border-rule bg-white hover:bg-paper'} ${className}`}
  />
)

export const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <label className="block">
    <span className="mb-1 block text-xs font-semibold text-soft">{label}</span>
    {children}
    {hint && <span className="mt-0.5 block text-xs text-soft">{hint}</span>}
  </label>
)

const TONES: Record<string, string> = {
  green: 'bg-emerald-100 text-emerald-800', red: 'bg-red-100 text-red-800', amber: 'bg-amber-100 text-amber-900', gray: 'bg-zinc-200 text-zinc-700', blue: 'bg-sky-100 text-sky-800',
}
export const Badge = ({ tone = 'gray', children }: { tone?: keyof typeof TONES; children: ReactNode }) => (
  <span className={`inline-block rounded px-1.5 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide ${TONES[tone]}`}>{children}</span>
)
export const statusTone = (s: string): keyof typeof TONES =>
  ({ ACTIVE: 'green', WON: 'green', PAID: 'blue', LOST: 'gray', CANCELLED: 'gray', EXPIRED: 'red', SUSPENDED: 'amber', CLOSED: 'red', DISABLED: 'red', OPEN: 'amber', HIGH: 'red', MEDIUM: 'amber', LOW: 'gray', REVIEWED: 'blue', REPORTED: 'green', DISMISSED: 'gray', PENDING_RESULT: 'amber', BETTING_CLOSED: 'amber' })[s] ?? 'gray'

export const ErrorNote = ({ error }: { error: string }) => (error ? <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null)

// ── table ───────────────────────────────────────────────────────────────────
export interface Col<T> {
  key: string
  label: string
  render?: (row: T) => ReactNode
  align?: 'right' | 'left'
  className?: string
}
export function Table<T>({ cols, rows, onRow, empty = 'No records for this filter.', foot }: { cols: Col<T>[]; rows: T[]; onRow?: (r: T) => void; empty?: string; foot?: ReactNode }) {
  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="sticky top-0 border-b border-rule bg-paper text-left">
            {cols.map((c) => (
              <th key={c.key} className={`whitespace-nowrap px-3 py-2 text-[0.7rem] font-bold uppercase tracking-wider text-soft ${c.align === 'right' ? 'text-right' : ''}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} onClick={onRow ? () => onRow(r) : undefined} className={`border-b border-rule/70 ${onRow ? 'cursor-pointer hover:bg-amber-50' : 'hover:bg-paper'}`}>
              {cols.map((c) => (
                <td key={c.key} className={`px-3 py-2 ${c.align === 'right' ? 'text-right' : ''} ${c.className ?? ''}`}>{c.render ? c.render(r) : String((r as any)[c.key] ?? '—')}</td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={cols.length} className="px-3 py-10 text-center text-soft">{empty}</td></tr>
          )}
        </tbody>
        {foot && <tfoot>{foot}</tfoot>}
      </table>
    </div>
  )
}

// ── filters ─────────────────────────────────────────────────────────────────
export function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (f: string, t: string) => void }) {
  const t = todayKey()
  const shift = (days: number) => new Date(Date.parse(t + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="date" value={from} max={to} onChange={(e) => onChange(e.target.value, to)} className={inp + ' !w-auto'} aria-label="From date" />
      <span className="text-soft">to</span>
      <input type="date" value={to} min={from} onChange={(e) => onChange(from, e.target.value)} className={inp + ' !w-auto'} aria-label="To date" />
      <Btn kind="ghost" onClick={() => onChange(t, t)}>Today</Btn>
      <Btn kind="ghost" onClick={() => onChange(shift(-6), t)}>7 days</Btn>
      <Btn kind="ghost" onClick={() => onChange(shift(-29), t)}>30 days</Btn>
    </div>
  )
}

// ── charts (plain SVG) ──────────────────────────────────────────────────────
export function BarChart({ data, format, height = 150, color = '#16191e', secondary }: { data: { label: string; value: number; value2?: number }[]; format: (v: number) => string; height?: number; color?: string; secondary?: string }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.value, d.value2 ?? 0]))
  const w = 100 / Math.max(1, data.length)
  return (
    <div>
      <svg viewBox={`0 0 100 ${height / 4}`} preserveAspectRatio="none" style={{ height }} className="w-full" role="img" aria-label="Bar chart">
        <line x1="0" x2="100" y1={height / 4 - 0.3} y2={height / 4 - 0.3} stroke="#dadde1" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        {data.map((d, i) => {
          const h = Math.max(0, (d.value / max) * (height / 4 - 3))
          const h2 = Math.max(0, ((d.value2 ?? 0) / max) * (height / 4 - 3))
          return (
            <g key={i}>
              <title>{`${d.label}: ${format(d.value)}${d.value2 !== undefined ? ` / ${format(d.value2)}` : ''}`}</title>
              <rect x={i * w + w * 0.14} width={w * (secondary ? 0.36 : 0.72)} y={height / 4 - 0.3 - h} height={h} fill={color} />
              {secondary && d.value2 !== undefined && <rect x={i * w + w * 0.5} width={w * 0.36} y={height / 4 - 0.3 - h2} height={h2} fill={secondary} />}
            </g>
          )
        })}
      </svg>
      <div className="mt-1 flex text-[0.65rem] text-soft">
        {data.map((d, i) => (
          <div key={i} className="flex-1 truncate text-center">{d.label}</div>
        ))}
      </div>
    </div>
  )
}
