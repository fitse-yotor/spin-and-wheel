import type { GameInfo } from './realtime'

const mod = (a: number, n: number) => ((a % n) + n) % n
/** Small deterministic landing offset derived from the result hash, so every screen agrees on it. */
const jitter = (hash: string | null | undefined) => (hash ? (parseInt(hash.slice(0, 6), 16) / 0xffffff - 0.5) * 0.6 : 0)

const restAngle = (wheelNumbers: number[], number: number | null, hash: string | null) => {
  const idx = number === null ? -1 : wheelNumbers.indexOf(number)
  if (idx < 0) return 0
  return mod(-(idx + 0.5 + jitter(hash)) * (360 / wheelNumbers.length), 360)
}
// Starts from zero speed and eases out gently, so a screen that joins a few ms late never sees a jump.
const ease = (t: number) => {
  const u = 1 - Math.pow(1 - t, 1.9)
  return u * u * (3 - 2 * u)
}

/**
 * Wheel rotation in degrees at server time `now`. It depends only on data every display receives
 * (previous result, this round's result, server timestamps), so all screens show the identical spin.
 */
export function wheelAngle(game: GameInfo, previousNumber: number | null, previousHash: string | null, now: number): number {
  const numbers = game.wheel.map((s) => s.number)
  const start = restAngle(numbers, previousNumber, previousHash)
  if (!game.result || now < game.spinAt) return start
  const seg = 360 / numbers.length
  const final = mod(-(game.result.index + 0.5 + jitter(game.result.resultHash)) * seg, 360)
  const turns = Math.max(4, Math.round(game.timing.spinSeconds * 0.6))
  const delta = 360 * turns + mod(final - start, 360)
  const t = Math.min(1, Math.max(0, (now - game.spinAt) / (game.resultAt - game.spinAt)))
  return start + delta * ease(t)
}
