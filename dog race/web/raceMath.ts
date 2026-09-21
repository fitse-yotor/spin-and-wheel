import type { GameInfo } from '@/lib/realtime'

export interface DogPose {
  trap: number
  /** 0 at the start line, 1 at the finish line, slightly above 1 in the run-out */
  p: number
  finished: boolean
  place: number | null
  running: boolean
}

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))
/** Deterministic pseudo-random 0..1 from the result hash, so every screen draws the identical race. */
const hex = (hash: string, i: number) => parseInt(hash.slice((i * 2) % 62, ((i * 2) % 62) + 2), 16) / 255

/**
 * Where each dog is at server time `now`. The server already fixed the finishing order; this only chooses a
 * believable way to get there. Each dog crosses the line at a time set by its finishing position, with
 * small speed surges along the way so the lead changes, but position is monotonic and the order at the line
 * is exactly the drawn order. Depends only on data every display receives, so all screens match.
 */
export function racePoses(game: GameInfo, now: number): DogPose[] | null {
  const order = game.result?.order
  if (!game.race || !order) return null
  const hash = game.result!.resultHash
  const raceMs = game.resultAt - game.spinAt
  const u = clamp((now - game.spinAt) / raceMs)
  const raceSecs = raceMs / 1000

  // finish times as a fraction of the race window; winner near 80%, others 1–3% of the window behind each other
  const taus: number[] = []
  order.forEach((_, r) => taus.push(r === 0 ? 0.78 + 0.03 * hex(hash, 0) : taus[r - 1] + 0.01 + 0.022 * hex(hash, r)))

  const A = 0.06 // share of the run spent accelerating out of the box
  return game.race.dogs.map((d) => {
    const rank = order.indexOf(d.trap)
    const tau = taus[rank]
    const x = clamp(u / tau)
    const xe = (x < A ? (x * x) / (2 * A) : x - A / 2) / (1 - A / 2)
    const amp = 0.04 + 0.04 * hex(hash, 6 + d.trap)
    const waves = 2 + Math.floor(hex(hash, 12 + d.trap) * 3)
    const phase = hex(hash, 18 + d.trap) * Math.PI * 2
    let p = Math.max(0, xe + amp * Math.sin(2 * Math.PI * waves * xe + phase) * xe * (1 - xe))
    const finished = u >= tau
    let after = 0
    if (finished) {
      after = (u - tau) * raceSecs
      p = 1 + 0.028 * (1 - Math.exp(-1.3 * after)) // eases to a stop past the line
    }
    return { trap: d.trap, p, finished, place: finished ? rank + 1 : null, running: u > 0 && (!finished || after < 1.6) }
  })
}
