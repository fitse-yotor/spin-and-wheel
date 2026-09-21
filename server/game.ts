import { createHmac, randomBytes } from 'node:crypto'
import { hostname } from 'node:os'
import { audit } from './audit.ts'
import { cfg } from './config.ts'
import { all, get, run, tx } from './db.ts'
import { COATS, ruleWins, TRAP_JACKETS } from '../dog race/shared/rules.ts'
import { drawOrder, makeRaceSnapshot, raceCommitment, raceResultHash, type RaceSnapshot } from '../dog race/server/race.ts'
import { ApiError, DAY_MS, payoutFor, sha256 } from './util.ts'

/** When DISPLAY_KEY is set, only screens that present it may receive the early result feed. */
export const displayAllowed = (key: unknown) => !process.env.DISPLAY_KEY || key === process.env.DISPLAY_KEY

export const SERVER_ID = process.env.SERVER_ID ?? `srv-${hostname().split('.')[0]}`

export interface SnapSeg {
  number: number
  name: string
  category: string
  multiplierX100: number
  color: string
}
export type Phase = 'BETTING_OPEN' | 'BETTING_CLOSED' | 'SPINNING' | 'RESULT'
export type GameType = 'WHEEL' | 'DOGS'
export const GAME_TYPES: GameType[] = ['WHEEL', 'DOGS']
/** Each game numbers its own rounds. Dog race rounds live in a separate id range so both games can run side by side. */
export const DOG_ID_BASE = 1_000_000_000
export const isDogId = (id: number) => id >= DOG_ID_BASE
const pausedKey = (t: GameType) => (t === 'DOGS' ? 'dog.paused' : 'game.paused') as 'dog.paused' | 'game.paused'

// ─── Random number generation ───────────────────────────────────────────────
// Each round gets a 32-byte seed from the OS CSPRNG. sha256(seed) is published
// (the "commitment") the moment the round opens; the seed itself is revealed
// once the round is settled. Anyone can then re-derive the winning segment with
// drawIndex() and check it against the commitment. Every segment has exactly
// equal probability — nothing about ticket sales, cashiers or shops feeds in.
export function newSeed(): string {
  return randomBytes(32).toString('hex')
}
export const commitmentOf = (seedHex: string) => sha256(seedHex)

/** Unbiased uniform index in [0, n) via HMAC-SHA256 output + rejection sampling. */
export function drawIndex(seedHex: string, gameId: number, n: number): number {
  if (!Number.isInteger(n) || n < 1) throw new Error('wheel must have at least one segment')
  const limit = Math.floor(2 ** 32 / n) * n
  const key = Buffer.from(seedHex, 'hex')
  for (let counter = 0; ; counter++) {
    const block = createHmac('sha256', key).update(`spinwheel:v1:${gameId}:${counter}`).digest()
    for (let off = 0; off + 4 <= block.length; off += 4) {
      const v = block.readUInt32BE(off)
      if (v < limit) return v % n
    }
  }
}
export const resultHashOf = (gameId: number, segmentNumber: number, seedHex: string, generatedAt: number) =>
  sha256(`${gameId}|${segmentNumber}|${seedHex}|${generatedAt}`)

// ─── Game rows ──────────────────────────────────────────────────────────────
export interface GameRow {
  id: number
  game_type: GameType
  status: 'BETTING_OPEN' | 'BETTING_CLOSED' | 'SPINNING' | 'RESULT' | 'COMPLETED'
  created_at: number
  opens_at: number
  closes_at: number
  spin_at: number
  result_at: number
  ends_at: number
  wheel_snapshot: string
  timing_snapshot: string
  seed: string
  seed_commitment: string
  settled_at: number | null
  completed_at: number | null
}

export const currentGame = (type: GameType = 'WHEEL') =>
  get<GameRow>("SELECT * FROM games WHERE game_type = ? AND status != 'COMPLETED' ORDER BY id DESC LIMIT 1", type)

export function wheelSnapshot(): SnapSeg[] {
  const colors = cfg()['wheel.categoryColors']
  const wheel = get<{ id: number }>('SELECT id FROM wheels WHERE active = 1 ORDER BY id LIMIT 1')
  if (!wheel) return []
  return all('SELECT * FROM wheel_segments WHERE wheel_id = ? AND active = 1 ORDER BY sort_order, number', wheel.id).map((s) => ({
    number: s.number,
    name: s.name,
    category: s.category,
    multiplierX100: s.multiplier_x100,
    color: colors[s.category] ?? '#555555',
  }))
}

function createGame(at: number, type: GameType): GameRow {
  const c = cfg()
  const dog = type === 'DOGS'
  const timing = dog
    ? { bettingSeconds: c['dog.bettingSeconds'], closedSeconds: c['dog.closedSeconds'], spinSeconds: c['dog.raceSeconds'], resultSeconds: c['dog.resultSeconds'], countdownSeconds: c['dog.countdownSeconds'] }
    : { bettingSeconds: c['game.bettingSeconds'], closedSeconds: c['game.closedSeconds'], spinSeconds: c['game.spinSeconds'], resultSeconds: c['game.resultSeconds'], countdownSeconds: c['game.countdownSeconds'] }
  const closes = at + timing.bettingSeconds * 1000
  const spin = closes + timing.closedSeconds * 1000
  const resultAt = spin + timing.spinSeconds * 1000
  const ends = resultAt + timing.resultSeconds * 1000
  const seed = newSeed()
  // The snapshot (wheel segments, or the race's published dog strengths and odds) is frozen for the whole round.
  let snapshot: unknown
  let commitment: string
  if (dog) {
    const snap = makeRaceSnapshot(c['dog.names'], c['dog.marginPercent'])
    snapshot = snap
    commitment = raceCommitment(seed, snap.dogs.map((d) => d.weight))
  } else {
    const segs = wheelSnapshot()
    if (segs.length < 2) throw new ApiError(500, 'NO_WHEEL', 'The wheel needs at least two active segments')
    snapshot = segs
    commitment = commitmentOf(seed)
  }
  const id = dog
    ? (get<{ m: number | null }>('SELECT MAX(id) AS m FROM games WHERE id >= ?', DOG_ID_BASE)?.m ?? DOG_ID_BASE) + 1
    : (get<{ m: number | null }>('SELECT MAX(id) AS m FROM games WHERE id < ?', DOG_ID_BASE)?.m ?? 0) + 1
  run(
    `INSERT INTO games (id, game_type, status, created_at, opens_at, closes_at, spin_at, result_at, ends_at, wheel_snapshot, timing_snapshot, seed, seed_commitment)
     VALUES (?, ?, 'BETTING_OPEN', ?,?,?,?,?,?,?,?,?,?)`,
    id, type, Date.now(), at, closes, spin, resultAt, ends, JSON.stringify(snapshot), JSON.stringify(timing), seed, commitment,
  )
  audit('GAME_CREATED', 'game', id, { type, commitment, timing, ...(dog ? { strengths: (snapshot as RaceSnapshot).dogs.map((d) => d.weight), margin: c['dog.marginPercent'] } : { segments: (snapshot as SnapSeg[]).length }) })
  return get<GameRow>('SELECT * FROM games WHERE id = ?', id)!
}

// ─── Lifecycle transitions (each is atomic and idempotent) ──────────────────
function closeBetting(g: GameRow, now: number) {
  tx(() => {
    const fresh = get<GameRow>('SELECT * FROM games WHERE id = ?', g.id)!
    if (fresh.status !== 'BETTING_OPEN') return
    // The result is drawn only now, after the last ticket was accepted, from the seed committed when the round opened.
    let winner: number, index: number, category: string, multiplierX100: number, hash: string, orderJson: string | null = null
    if (fresh.game_type === 'DOGS') {
      const snap = JSON.parse(fresh.wheel_snapshot) as RaceSnapshot
      const order = drawOrder(fresh.seed, fresh.id, snap.dogs.map((d) => d.weight))
      winner = order[0]
      index = winner - 1
      category = 'DOG'
      multiplierX100 = snap.odds[`WIN:${winner}`]
      hash = raceResultHash(fresh.id, order, fresh.seed, now)
      orderJson = JSON.stringify(order)
    } else {
      const segs = JSON.parse(fresh.wheel_snapshot) as SnapSeg[]
      index = drawIndex(fresh.seed, fresh.id, segs.length)
      winner = segs[index].number
      category = segs[index].category
      multiplierX100 = segs[index].multiplierX100
      hash = resultHashOf(fresh.id, winner, fresh.seed, now)
    }
    run("UPDATE games SET status = 'BETTING_CLOSED' WHERE id = ?", fresh.id)
    const closed = run("UPDATE tickets SET status = 'BETTING_CLOSED' WHERE game_id = ? AND status = 'ACTIVE'", fresh.id).changes
    const ref = audit('RESULT_GENERATED', 'game', fresh.id, { type: fresh.game_type, commitment: fresh.seed_commitment, resultHash: hash, serverId: SERVER_ID, ticketsClosed: closed })
    run(
      'INSERT INTO game_results (game_id, segment_number, segment_index, category, multiplier_x100, generated_at, result_hash, server_id, audit_ref, result_json) VALUES (?,?,?,?,?,?,?,?,?,?)',
      fresh.id, winner, index, category, multiplierX100, now, hash, SERVER_ID, ref, orderJson,
    )
    audit('BETTING_CLOSED', 'game', fresh.id, { ticketsClosed: closed })
  })
}

function startSpin(g: GameRow) {
  tx(() => {
    if (get<GameRow>('SELECT * FROM games WHERE id = ?', g.id)!.status !== 'BETTING_CLOSED') return
    run("UPDATE games SET status = 'SPINNING' WHERE id = ?", g.id)
    run("UPDATE tickets SET status = 'PENDING_RESULT' WHERE game_id = ? AND status = 'BETTING_CLOSED'", g.id)
  })
}

/** Result is on screen: settle every ticket for the round in one transaction. */
export function settleGame(g: GameRow, now: number) {
  tx(() => {
    const fresh = get<GameRow>('SELECT * FROM games WHERE id = ?', g.id)!
    if (fresh.status !== 'SPINNING') return
    const result = get<{ segment_number: number; result_json: string | null }>('SELECT segment_number, result_json FROM game_results WHERE game_id = ?', fresh.id)!
    const order = result.result_json ? (JSON.parse(result.result_json) as number[]) : null
    const expiryMs = cfg()['ticket.expiryDays'] * DAY_MS
    let count = 0
    let stake = 0
    let winnings = 0
    for (const t of all("SELECT * FROM tickets WHERE game_id = ? AND status IN ('PENDING_RESULT','BETTING_CLOSED','ACTIVE')", fresh.id)) {
      let win = 0
      for (const s of all('SELECT * FROM ticket_selections WHERE ticket_id = ?', t.id)) {
        const hit = s.rule ? ruleWins(s.rule, order ?? []) : (JSON.parse(s.segment_numbers) as number[]).includes(result.segment_number)
        const amt = hit ? payoutFor(s.stake, s.odds_x100) : 0
        run('UPDATE ticket_selections SET is_win = ?, win_amount = ? WHERE id = ?', hit ? 1 : 0, amt, s.id)
        win += amt
      }
      const outcome = win > 0 ? 'WON' : 'LOST'
      const ref = audit('TICKET_SETTLED', 'ticket', t.ticket_number, { game: fresh.id, result: order ?? result.segment_number, outcome, win }, { shopId: t.shop_id })
      run('UPDATE tickets SET status = ?, actual_win = ?, settled_at = ?, expires_at = ? WHERE id = ?', outcome, win, now, win > 0 ? now + expiryMs : null, t.id)
      run('INSERT INTO ticket_settlements (ticket_id, game_id, result_number, outcome, win_amount, settled_at, audit_ref) VALUES (?,?,?,?,?,?,?)', t.id, fresh.id, result.segment_number, outcome, win, now, ref)
      count++
      stake += t.total_stake
      winnings += win
    }
    run("UPDATE games SET status = 'RESULT', settled_at = ?, ticket_count = ?, total_stake = ?, total_winnings = ? WHERE id = ?", now, count, stake, winnings, fresh.id)
    audit('GAME_SETTLED', 'game', fresh.id, { tickets: count, stake, winnings, result: order ?? result.segment_number })
  })
}

function completeGame(g: GameRow, now: number) {
  tx(() => {
    if (get<GameRow>('SELECT * FROM games WHERE id = ?', g.id)!.status !== 'RESULT') return
    run("UPDATE games SET status = 'COMPLETED', completed_at = ? WHERE id = ?", now, g.id)
    audit('GAME_COMPLETED', 'game', g.id, {})
    if (!cfg()[pausedKey(g.game_type)]) {
      // Keep the cadence exact unless we were down for a while.
      createGame(now - g.ends_at < 2000 ? g.ends_at : now, g.game_type)
    }
  })
}

let lastExpirySweep = 0
function expireTickets(now: number) {
  if (now - lastExpirySweep < 30_000) return
  lastExpirySweep = now
  tx(() => {
    for (const t of all("SELECT id, ticket_number, shop_id, actual_win FROM tickets WHERE status = 'WON' AND expires_at IS NOT NULL AND expires_at <= ?", now)) {
      run("UPDATE tickets SET status = 'EXPIRED' WHERE id = ? AND status = 'WON'", t.id)
      audit('TICKET_EXPIRED', 'ticket', t.ticket_number, { forfeited: t.actual_win }, { shopId: t.shop_id })
    }
  })
}

/** Advances every game's round state machine against the server clock. Safe to call repeatedly. */
export function tick(now = Date.now()): boolean {
  let changed = false
  for (const type of GAME_TYPES) {
    for (let guard = 0; guard < 10; guard++) {
      const g = currentGame(type)
      if (!g) {
        if (cfg()[pausedKey(type)]) break
        tx(() => {
          if (!currentGame(type)) createGame(now, type)
        })
        changed = true
        continue
      }
      if (g.status === 'BETTING_OPEN' && now >= g.closes_at) closeBetting(g, now)
      else if (g.status === 'BETTING_CLOSED' && now >= g.spin_at) startSpin(g)
      else if (g.status === 'SPINNING' && now >= g.result_at) settleGame(g, now)
      else if (g.status === 'RESULT' && now >= g.ends_at) completeGame(g, now)
      else break
      changed = true
    }
  }
  expireTickets(now)
  return changed
}

// ─── Public state (what displays and POS terminals receive) ─────────────────
export function phaseOf(g: GameRow): Phase {
  return g.status === 'COMPLETED' ? 'RESULT' : (g.status as Phase)
}

function recentResults(type: GameType, limit: number, includeGameId: number | null) {
  const colors = cfg()['wheel.categoryColors']
  return all(
    `SELECT r.game_id, r.segment_number AS number, r.category, r.multiplier_x100, r.result_json FROM game_results r
     JOIN games g ON g.id = r.game_id WHERE g.game_type = ? AND (g.status IN ('RESULT','COMPLETED') OR g.id = ?)
     ORDER BY r.game_id DESC LIMIT ?`,
    type,
    includeGameId ?? -1,
    limit,
  ).map((r: any) => ({
    gameId: r.game_id as number,
    number: r.number as number,
    category: r.category as string,
    multiplier: r.multiplier_x100 / 100,
    color: type === 'DOGS' ? TRAP_JACKETS[r.number - 1] : (colors[r.category] ?? '#555'),
    order: r.result_json ? (JSON.parse(r.result_json) as number[]) : undefined,
  }))
}

const lastSettledId = (type: GameType) =>
  get<{ id: number }>("SELECT COALESCE(MAX(r.game_id),0) AS id FROM game_results r JOIN games g ON g.id = r.game_id WHERE g.game_type = ? AND g.status IN ('RESULT','COMPLETED')", type)!.id

// ── Display extras: hit statistics, pay table and wheel sectors (cached briefly) ──
const STATS_WINDOW = 100
const extrasCache = new Map<string, { at: number; key: string; data: unknown }>()

function displayExtras(segs: SnapSeg[], lastGameId: number) {
  const key = `${lastGameId}:${segs.map((s) => s.number).join(',')}`
  const hit = extrasCache.get('WHEEL')
  if (hit && hit.key === key && Date.now() - hit.at < 5000) return hit.data
  const idx = new Map(segs.map((s, i) => [s.number, i]))
  const draws = all<{ n: number }>("SELECT r.segment_number AS n FROM game_results r JOIN games g ON g.id = r.game_id WHERE g.game_type = 'WHEEL' AND g.status IN ('RESULT','COMPLETED') ORDER BY r.game_id DESC LIMIT ?", STATS_WINDOW).map((r) => r.n)
  const numbers: Record<string, number> = {}
  for (const n of draws) numbers[n] = (numbers[n] ?? 0) + 1
  interface Opt { label: string; tone: string; odds_x100: number; odds_source: string; nums: number[] }
  interface Mkt { code: string; name: string; kind: string; options: Opt[] }
  const markets: Mkt[] = all('SELECT * FROM bet_markets WHERE active = 1 ORDER BY sort_order, id')
    .map((m: any) => ({
      code: m.code, name: m.name, kind: m.kind,
      options: all('SELECT * FROM bet_options WHERE market_id = ? AND active = 1 ORDER BY sort_order, id', m.id).map((o: any) => ({ label: o.label, tone: o.tone, odds_x100: o.odds_x100, odds_source: o.odds_source, nums: JSON.parse(o.segment_numbers) as number[] })),
    }))
    .filter((m) => m.options.length)
  const sectors: { label: string; start: number; count: number }[] = []
  for (const o of markets.find((m) => m.code === 'SECTOR')?.options ?? []) {
    const ix = o.nums.map((n) => idx.get(n)).filter((v): v is number => v !== undefined).sort((a, b) => a - b)
    if (ix.length && ix[ix.length - 1] - ix[0] === ix.length - 1) sectors.push({ label: o.label, start: ix[0], count: ix.length })
  }
  const mult = new Map(segs.map((s) => [s.number, s.multiplierX100]))
  const oddsOf = (o: Opt) => (o.odds_source === 'SEGMENT' ? Math.min(...o.nums.map((n) => mult.get(n) ?? o.odds_x100)) : o.odds_x100) / 100
  const data = {
    window: draws.length,
    numbers,
    groups: markets.filter((m) => m.kind !== 'EXACT').map((m) => ({ name: m.name, items: m.options.map((o) => ({ label: o.label, count: draws.filter((n) => o.nums.includes(n)).length })) })),
    payTable: markets.map((m) => {
      const odds = m.options.map(oddsOf)
      return { name: m.name, odds: odds.every((x) => x === odds[0]) ? odds[0] : null, options: m.options.map((o, i) => ({ label: o.label, tone: o.tone, odds: odds[i] })) }
    }),
    sectors,
  }
  extrasCache.set('WHEEL', { at: Date.now(), key, data })
  return data
}

/** Dog race statistics: how often each trap won / placed over the last draws. */
function dogExtras(lastGameId: number) {
  const key = String(lastGameId)
  const hit = extrasCache.get('DOGS')
  if (hit && hit.key === key && Date.now() - hit.at < 5000) return hit.data
  const orders = all<{ j: string }>("SELECT r.result_json AS j FROM game_results r JOIN games g ON g.id = r.game_id WHERE g.game_type = 'DOGS' AND g.status IN ('RESULT','COMPLETED') ORDER BY r.game_id DESC LIMIT ?", STATS_WINDOW).map((r) => JSON.parse(r.j) as number[])
  const wins: Record<string, number> = {}
  const places: Record<string, number> = {}
  for (const o of orders) {
    wins[o[0]] = (wins[o[0]] ?? 0) + 1
    for (const t of o.slice(0, 3)) places[t] = (places[t] ?? 0) + 1
  }
  const data = {
    window: orders.length,
    wins,
    places,
    payTable: [
      { name: 'Win', text: 'Finishes 1st' },
      { name: 'Place', text: 'Finishes in the top 3' },
      { name: 'Forecast', text: '1st and 2nd, in order' },
      { name: 'Quinella', text: '1st and 2nd, any order' },
    ],
  }
  extrasCache.set('DOGS', { at: Date.now(), key, data })
  return data
}

function gameView(type: GameType, now: number, forDisplay: boolean) {
  const c = cfg()
  const paused = c[pausedKey(type)]
  const g = currentGame(type)
  if (!g) return { paused, game: null, recent: recentResults(type, 12, null), previousNumber: null, previousHash: null, extras: null, totalBet: 0, nextGameId: null }
  const phase = phaseOf(g)
  const timing = JSON.parse(g.timing_snapshot)
  const settled = g.status === 'RESULT'
  // Displays receive the (already-final) outcome once betting has closed so the animation can start exactly
  // on time and stay identical on every screen. Every other client (POS terminals) only learns it once the
  // result is on screen. Bets are closed by then, so nothing can be influenced.
  const showResult = forDisplay ? g.status !== 'BETTING_OPEN' : settled
  const res = showResult ? get('SELECT * FROM game_results WHERE game_id = ?', g.id) : undefined
  const snap = JSON.parse(g.wheel_snapshot)
  const totalBet = get<{ v: number }>("SELECT COALESCE(SUM(total_stake),0) AS v FROM tickets WHERE game_id = ? AND status != 'CANCELLED'", g.id)!.v
  const dog = type === 'DOGS'
  const segs: SnapSeg[] = dog ? [] : snap
  const race = dog
    ? {
        marginPercent: (snap as RaceSnapshot).marginPercent,
        distance: (snap as RaceSnapshot).distance,
        track: (snap as RaceSnapshot).track,
        odds: (snap as RaceSnapshot).odds,
        dogs: (snap as RaceSnapshot).dogs.map((d) => ({
          trap: d.trap, name: d.name, weight: d.weight,
          winOdds: (snap as RaceSnapshot).odds[`WIN:${d.trap}`] / 100,
          placeOdds: (snap as RaceSnapshot).odds[`PLACE:${d.trap}`] / 100,
          jacket: TRAP_JACKETS[d.trap - 1], coat: COATS[d.trap - 1],
        })),
      }
    : undefined
  const prev = dog ? undefined : get<{ segment_number: number; result_hash: string }>("SELECT r.segment_number, r.result_hash FROM game_results r WHERE r.game_id < ? AND r.game_id IN (SELECT id FROM games WHERE game_type = 'WHEEL') ORDER BY r.game_id DESC LIMIT 1", g.id)
  return {
    paused,
    extras: dog ? dogExtras(lastSettledId(type)) : displayExtras(segs, lastSettledId(type)),
    totalBet,
    game: {
      id: g.id,
      type,
      phase,
      countdownActive: phase === 'BETTING_OPEN' && g.closes_at - now <= timing.countdownSeconds * 1000,
      opensAt: g.opens_at,
      closesAt: g.closes_at,
      spinAt: g.spin_at,
      resultAt: g.result_at,
      endsAt: g.ends_at,
      commitment: g.seed_commitment,
      timing,
      wheel: segs,
      race,
      result: res
        ? {
            number: res.segment_number, index: res.segment_index, category: res.category, multiplier: res.multiplier_x100 / 100,
            color: dog ? TRAP_JACKETS[res.segment_number - 1] : segs[res.segment_index]?.color, resultHash: res.result_hash,
            order: res.result_json ? (JSON.parse(res.result_json) as number[]) : undefined,
          }
        : null,
    },
    nextGameId: g.id + 1,
    previousNumber: prev?.segment_number ?? null,
    previousHash: prev?.result_hash ?? null,
    recent: recentResults(type, 12, settled ? g.id : null),
  }
}

/** One message carries both games; each client reads the view it is showing. */
export function buildState(now: number, forDisplay: boolean) {
  const c = cfg()
  return {
    type: 'state' as const,
    serverTime: now,
    serverId: SERVER_ID,
    notice: c['compliance.notice'],
    company: c['company.name'],
    games: { WHEEL: gameView('WHEEL', now, forDisplay), DOGS: gameView('DOGS', now, forDisplay) },
  }
}

/** Audit helper: re-derive a settled round's result from its revealed seed. */
export function verifyGame(id: number) {
  const g = get<GameRow>('SELECT * FROM games WHERE id = ?', id)
  if (!g) throw new ApiError(404, 'NOT_FOUND', 'Game not found')
  const res = get('SELECT * FROM game_results WHERE game_id = ?', id)
  const revealed = g.status === 'RESULT' || g.status === 'COMPLETED'
  if (!revealed || !res) return { gameId: id, gameType: g.game_type, status: g.status, commitment: g.seed_commitment, revealed: false }
  const common = { gameId: id, gameType: g.game_type, status: g.status, revealed: true, commitment: g.seed_commitment, seed: g.seed, resultHash: res.result_hash, generatedAt: res.generated_at, serverId: res.server_id, auditRef: res.audit_ref }
  if (g.game_type === 'DOGS') {
    const snap = JSON.parse(g.wheel_snapshot) as RaceSnapshot
    const weights = snap.dogs.map((d) => d.weight)
    const order = JSON.parse(res.result_json) as number[]
    return {
      ...common,
      strengths: weights,
      finishingOrder: order,
      checks: {
        commitmentMatchesSeedAndStrengths: raceCommitment(g.seed, weights) === g.seed_commitment,
        resultReproducible: drawOrder(g.seed, id, weights).join('-') === order.join('-'),
        hashMatches: raceResultHash(id, order, g.seed, res.generated_at) === res.result_hash,
      },
    }
  }
  const segs = JSON.parse(g.wheel_snapshot) as SnapSeg[]
  const idx = drawIndex(g.seed, id, segs.length)
  return {
    ...common,
    segments: segs.length,
    resultNumber: res.segment_number,
    checks: {
      commitmentMatchesSeed: commitmentOf(g.seed) === g.seed_commitment,
      resultReproducible: segs[idx]?.number === res.segment_number,
      hashMatches: resultHashOf(id, res.segment_number, g.seed, res.generated_at) === res.result_hash,
    },
  }
}
