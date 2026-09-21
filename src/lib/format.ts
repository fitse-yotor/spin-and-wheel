/** Money is held as integer santim (1 ETB = 100 santim). */
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function num(santim: number | null | undefined): string {
  if (santim === null || santim === undefined) return '—'
  return santim % 100 === 0 ? nf0.format(santim / 100) : nf2.format(santim / 100)
}
export const etb = (santim: number | null | undefined) => (santim === null || santim === undefined ? '—' : `${num(santim)} ETB`)
export const odds = (x100: number) => (x100 / 100).toFixed(2)
/** Wheel rounds are 000128; dog race rounds live in their own id range and read D00057. */
export const DOG_ID_BASE = 1_000_000_000
export const gameNo = (id: number | null | undefined, w = 6) => (id ? (id >= DOG_ID_BASE ? `D${String(id - DOG_ID_BASE).padStart(Math.max(5, w - 1), '0')}` : String(id).padStart(w, '0')) : '—')

const TZ = 'Africa/Addis_Ababa'
export const fmtTime = (ts: number | null | undefined, secs = true) =>
  ts ? new Date(ts).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', ...(secs ? { second: '2-digit' } : {}), hour12: false }) : '—'
export const fmtDate = (ts: number | null | undefined) =>
  ts ? new Date(ts).toLocaleDateString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }) : '—'
export const fmtDateTime = (ts: number | null | undefined) => (ts ? `${fmtDate(ts)} ${fmtTime(ts, false)}` : '—')
export const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
export const todayKey = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10)

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const esc = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v)
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s // stop spreadsheet formula injection
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
}
export function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}
