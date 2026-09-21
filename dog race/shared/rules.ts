// Pure dog-race rules shared by the server (settlement, odds) and the browser (cashier maths).
// No Node or DOM imports here: it must run in both.

export const DOGS = 6
export type RuleKind = 'WIN' | 'PLACE' | 'FC' | 'QN'
export interface ParsedRule {
  kind: RuleKind
  dogs: number[]
}

const inRange = (n: number) => Number.isInteger(n) && n >= 1 && n <= DOGS

/**
 * A bet is a short code:  WIN:3  PLACE:3  FC:3-5 (3 first, 5 second)  QN:3-5 (3 and 5 first two, either order, low trap first)
 */
export function parseRule(rule: unknown): ParsedRule | null {
  if (typeof rule !== 'string') return null
  const m = /^(WIN|PLACE|FC|QN):(\d)(?:-(\d))?$/.exec(rule)
  if (!m) return null
  const kind = m[1] as RuleKind
  const a = Number(m[2])
  const b = m[3] === undefined ? null : Number(m[3])
  if (kind === 'WIN' || kind === 'PLACE') return b === null && inRange(a) ? { kind, dogs: [a] } : null
  if (b === null || !inRange(a) || !inRange(b) || a === b) return null
  if (kind === 'QN' && a > b) return null // canonical: lower trap first, so the same bet has one code
  return { kind, dogs: [a, b] }
}

/** `order` lists trap numbers from first to last past the post. */
export function ruleWins(rule: string, order: number[]): boolean {
  const p = parseRule(rule)
  if (!p) return false
  switch (p.kind) {
    case 'WIN': return order[0] === p.dogs[0]
    case 'PLACE': return order.slice(0, 3).includes(p.dogs[0])
    case 'FC': return order[0] === p.dogs[0] && order[1] === p.dogs[1]
    case 'QN': return (order[0] === p.dogs[0] && order[1] === p.dogs[1]) || (order[0] === p.dogs[1] && order[1] === p.dogs[0])
  }
}

export const KIND_NAME: Record<RuleKind, string> = { WIN: 'Win', PLACE: 'Place (top 3)', FC: 'Forecast', QN: 'Quinella' }

export function ruleLabel(rule: string, names: string[]): string {
  const p = parseRule(rule)
  if (!p) return rule
  const n = (t: number) => names[t - 1] ?? `Trap ${t}`
  switch (p.kind) {
    case 'WIN': return `Trap ${p.dogs[0]} ${n(p.dogs[0])}`
    case 'PLACE': return `Trap ${p.dogs[0]} ${n(p.dogs[0])}`
    case 'FC': return `${p.dogs[0]} → ${p.dogs[1]}`
    case 'QN': return `${p.dogs[0]} + ${p.dogs[1]}`
  }
}

export function allRules(): string[] {
  const traps = Array.from({ length: DOGS }, (_, i) => i + 1)
  const out: string[] = []
  for (const t of traps) out.push(`WIN:${t}`)
  for (const t of traps) out.push(`PLACE:${t}`)
  for (const a of traps) for (const b of traps) if (a !== b) out.push(`FC:${a}-${b}`)
  for (const a of traps) for (const b of traps) if (a < b) out.push(`QN:${a}-${b}`)
  return out
}

let permCache: number[][] | null = null
/** Every possible finishing order (720 for six dogs). */
export function permutations(): number[][] {
  if (permCache) return permCache
  const out: number[][] = []
  const walk = (rest: number[], acc: number[]) => {
    if (!rest.length) return void out.push(acc)
    for (let i = 0; i < rest.length; i++) walk([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, rest[i]])
  }
  walk(Array.from({ length: DOGS }, (_, i) => i + 1), [])
  return (permCache = out)
}

/**
 * Probability of each finishing order when every dog has a published strength.
 * Each place goes to a remaining dog with probability strength / (sum of remaining strengths).
 */
export function permProbabilities(weights: number[]): number[] {
  return permutations().map((perm) => {
    let left = weights.reduce((a, b) => a + b, 0)
    let p = 1
    for (const trap of perm) {
      const w = weights[trap - 1]
      p *= w / left
      left -= w
    }
    return p
  })
}

const MIN_ODDS_X100 = 101
const MAX_ODDS_X100 = 50_000

/**
 * Honest odds: exact win probability of each bet from the published strengths, paid at (100 − margin)% of fair.
 * Returns integer hundredths (2.50x = 250) for every possible bet code.
 */
export function oddsTable(weights: number[], marginPercent: number): Record<string, number> {
  const probs = new Map<string, number>()
  const add = (k: string, p: number) => probs.set(k, (probs.get(k) ?? 0) + p)
  const perms = permutations()
  const pp = permProbabilities(weights)
  perms.forEach((o, i) => {
    const p = pp[i]
    add(`WIN:${o[0]}`, p)
    for (const t of o.slice(0, 3)) add(`PLACE:${t}`, p)
    add(`FC:${o[0]}-${o[1]}`, p)
    add(`QN:${Math.min(o[0], o[1])}-${Math.max(o[0], o[1])}`, p)
  })
  const table: Record<string, number> = {}
  for (const rule of allRules()) {
    const p = probs.get(rule) ?? 0
    table[rule] = p > 0 ? Math.min(MAX_ODDS_X100, Math.max(MIN_ODDS_X100, Math.floor((100 - marginPercent) / p + 1e-6))) : MIN_ODDS_X100
  }
  return table
}

/** The most the house could owe on a ticket: the best single finishing order for the player. */
export function worstCase(items: { rule: string; payout: number }[]): number {
  let best = 0
  for (const perm of permutations()) {
    let sum = 0
    for (const it of items) if (ruleWins(it.rule, perm)) sum += it.payout
    if (sum > best) best = sum
  }
  return best
}

export const TRAP_JACKETS = ['#d62828', '#1d5fd6', '#f4f4f4', '#141414', '#f59e0b', '#141414']
export const COATS = ['#c99a5b', '#7a5230', '#232323', '#d8d8d8', '#6f8092', '#b2632c']
