import { createHmac, randomInt } from 'node:crypto'
import { sha256 } from '../../server/util.ts'
import { DOGS, oddsTable } from '../shared/rules.ts'

export interface RaceDog {
  trap: number
  name: string
  /** Published strength. Odds are derived from these, so what players see is what the draw uses. */
  weight: number
}
export interface RaceSnapshot {
  dogs: RaceDog[]
  marginPercent: number
  /** bet code → odds in hundredths, fixed for the whole round */
  odds: Record<string, number>
  distance: string
  track: string
}

/** Strengths are drawn fresh each round from the OS CSPRNG. They never depend on ticket sales. */
export function makeRaceSnapshot(names: string[], marginPercent: number): RaceSnapshot {
  const dogs: RaceDog[] = Array.from({ length: DOGS }, (_, i) => ({ trap: i + 1, name: names[i] ?? `Dog ${i + 1}`, weight: randomInt(10, 41) }))
  return { dogs, marginPercent, odds: oddsTable(dogs.map((d) => d.weight), marginPercent), distance: '480m', track: 'Addis Park' }
}

/** The round's public commitment covers the seed AND the published strengths, so neither can be changed after betting opens. */
export const raceCommitment = (seedHex: string, weights: number[]) => sha256(`${seedHex}|${weights.join(',')}`)

/** Unbiased integer in [0, n): HMAC-SHA256 output with rejection sampling. */
function drawUniform(seedHex: string, label: string, n: number): number {
  const limit = Math.floor(2 ** 32 / n) * n
  const key = Buffer.from(seedHex, 'hex')
  for (let counter = 0; ; counter++) {
    const block = createHmac('sha256', key).update(`spinwheel:v1:dogs:${label}:${counter}`).digest()
    for (let off = 0; off + 4 <= block.length; off += 4) {
      const v = block.readUInt32BE(off)
      if (v < limit) return v % n
    }
  }
}

/** Finishing order (trap numbers, first to last), reproducible from the revealed seed and the published strengths. */
export function drawOrder(seedHex: string, gameId: number, weights: number[]): number[] {
  const remaining = weights.map((w, i) => ({ trap: i + 1, w }))
  const order: number[] = []
  for (let place = 0; remaining.length; place++) {
    const total = remaining.reduce((a, d) => a + d.w, 0)
    let r = drawUniform(seedHex, `${gameId}:${place}`, total)
    let pick = 0
    while (r >= remaining[pick].w) r -= remaining[pick++].w
    order.push(remaining[pick].trap)
    remaining.splice(pick, 1)
  }
  return order
}

export const raceResultHash = (gameId: number, order: number[], seedHex: string, generatedAt: number) =>
  sha256(`${gameId}|${order.join('-')}|${seedHex}|${generatedAt}`)
