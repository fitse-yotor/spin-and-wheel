import type { ReactNode } from 'react'
import type { RaceDog } from '@/lib/realtime'

export interface DogOpt {
  key: string
  code: string
  label: string
  oddsX100: number
  dogs: number[]
}
export interface DogMarket {
  code: string
  name: string
  options: DogOpt[]
}

const inkOn = (jacket: string) => (jacket === '#f4f4f4' || jacket === '#f59e0b' ? '#141414' : '#ffffff')
const odds = (x100: number) => (x100 / 100).toFixed(2)

/** Cashier bet buttons for the dog race: Win, Place, Forecast grid and Quinella. Stakes show on picked bets. */
export function DogBets({ dogs, markets, stakeOf, onPick, disabled }: { dogs: RaceDog[]; markets: DogMarket[]; stakeOf: (key: string) => number | undefined; onPick: (o: DogOpt) => void; disabled: boolean }) {
  const byCode = new Map(markets.flatMap((m) => m.options.map((o) => [o.code, o] as const)))
  const jacket = (t: number) => dogs.find((d) => d.trap === t)?.jacket ?? '#555'
  const Chip = ({ t, size = 'h-7 w-7 text-sm' }: { t: number; size?: string }) => (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-[0.2rem] font-black ${size}`} style={{ background: jacket(t), color: inkOn(jacket(t)), border: '1px solid rgba(0,0,0,0.35)' }}>{t}</span>
  )
  const ring = (o?: DogOpt) => (o && stakeOf(o.key) ? 'ring-[3px] ring-[#ffb300] ring-inset' : '')
  const badge = (o?: DogOpt) => (o && stakeOf(o.key) ? <span className="absolute right-0.5 top-0 rounded bg-black/75 px-1 text-[0.65rem] font-bold text-[#ffd34d]">{stakeOf(o.key)}</span> : null)
  const Box = ({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) => (
    <fieldset className={`min-w-0 rounded border border-[#c9c9c9] px-2 pb-2 pt-0 ${className}`}>
      <legend className="px-1 text-[0.72rem] text-[#555]">{title}</legend>
      {children}
    </fieldset>
  )
  const runnerRow = (prefix: 'WIN' | 'PLACE') => (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
      {dogs.map((d) => {
        const o = byCode.get(`${prefix}:${d.trap}`)
        return (
          <button key={d.trap} disabled={disabled || !o} onClick={() => o && onPick(o)} title={`${d.name} — ${prefix === 'WIN' ? 'wins' : 'finishes in the top 3'} pays ${o ? odds(o.oddsX100) : '—'}x`} className={`relative flex items-center gap-1.5 rounded-sm bg-[#5b5b5b] px-1.5 py-1.5 text-left text-white hover:bg-[#4a4a4a] disabled:opacity-50 ${ring(o)}`}>
            <Chip t={d.trap} size="h-8 w-8 text-lg" />
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[0.8rem] font-medium">{d.name}</span>
              <span className="block text-sm font-bold tabular-nums text-[#ffd34d]">{o ? odds(o.oddsX100) : '—'}</span>
            </span>
            {badge(o)}
          </button>
        )
      })}
    </div>
  )
  const traps = dogs.map((d) => d.trap)
  const pairs = traps.flatMap((a) => traps.filter((b) => a < b).map((b) => [a, b] as const))
  return (
    <div className="flex flex-col gap-1.5">
      <Box title="Win — finishes 1st">{runnerRow('WIN')}</Box>
      <Box title="Place — finishes in the top 3">{runnerRow('PLACE')}</Box>
      <div className="grid grid-cols-[auto_1fr] gap-1.5">
        <Box title="Forecast — 1st, then 2nd">
          <table className="border-separate border-spacing-[3px] text-center">
            <thead>
              <tr>
                <th className="text-[0.62rem] font-normal text-[#777]">1st ↓ 2nd →</th>
                {traps.map((t) => <th key={t}><Chip t={t} size="h-6 w-full min-w-[2.4rem] text-xs" /></th>)}
              </tr>
            </thead>
            <tbody>
              {traps.map((a) => (
                <tr key={a}>
                  <th><Chip t={a} size="h-8 w-8 text-sm" /></th>
                  {traps.map((b) => {
                    const o = a === b ? undefined : byCode.get(`FC:${a}-${b}`)
                    return (
                      <td key={b} className="p-0">
                        {o ? (
                          <button disabled={disabled} onClick={() => onPick(o)} title={`${a} first, ${b} second — pays ${odds(o.oddsX100)}x`} className={`relative h-8 w-full min-w-[2.4rem] rounded-sm bg-[#5b5b5b] text-[0.68rem] font-semibold tabular-nums text-white hover:bg-[#4a4a4a] disabled:opacity-50 ${ring(o)}`}>
                            {odds(o.oddsX100)}
                            {badge(o)}
                          </button>
                        ) : (
                          <span className="block h-8 rounded-sm bg-[#ececec]" />
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
        <Box title="Quinella — 1st and 2nd, either order">
          <div className="grid grid-cols-3 gap-1.5">
            {pairs.map(([a, b]) => {
              const o = byCode.get(`QN:${a}-${b}`)
              return (
                <button key={`${a}-${b}`} disabled={disabled || !o} onClick={() => o && onPick(o)} title={`${a} and ${b} first two, any order — pays ${o ? odds(o.oddsX100) : '—'}x`} className={`relative flex flex-col items-center rounded-sm bg-[#5b5b5b] py-1 text-white hover:bg-[#4a4a4a] disabled:opacity-50 ${ring(o)}`}>
                  <span className="flex items-center gap-0.5"><Chip t={a} size="h-5 w-5 text-[0.7rem]" /><Chip t={b} size="h-5 w-5 text-[0.7rem]" /></span>
                  <span className="text-[0.7rem] font-semibold tabular-nums text-[#ffd34d]">{o ? odds(o.oddsX100) : '—'}</span>
                  {badge(o)}
                </button>
              )
            })}
          </div>
        </Box>
      </div>
    </div>
  )
}
