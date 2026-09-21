import { audit, raiseAlert, type Ctx } from './audit.ts'
import { checkPin, type AuthUser } from './auth.ts'
import { cfg } from './config.ts'
import { KIND_NAME, parseRule, ruleLabel, worstCase } from '../dog race/shared/rules.ts'
import type { RaceSnapshot } from '../dog race/server/race.ts'
import { currentGame, type GameType, type SnapSeg } from './game.ts'
import { all, get, nextCounter, run, tx } from './db.ts'
import { postTxn } from './ledger.ts'
import { ApiError, dayKey, pad, payoutFor, randomCode, safeEqual } from './util.ts'

export const OUTCOMES = ['WON', 'LOST', 'PENDING', 'CANCELLED', 'ALREADY_PAID', 'EXPIRED'] as const
export type Outcome = (typeof OUTCOMES)[number]

// ─── Shifts ─────────────────────────────────────────────────────────────────
export function shiftSummary(shiftId: number) {
  const s = get('SELECT * FROM cashier_shifts WHERE id = ?', shiftId)!
  const sum = (types: string[]) =>
    get<{ v: number }>(`SELECT COALESCE(SUM(amount),0) AS v FROM financial_transactions WHERE shift_id = ? AND type IN (${types.map(() => '?').join(',')})`, shiftId, ...types)!.v
  const sales = sum(['TICKET_SALE'])
  const cancellations = -sum(['TICKET_CANCEL'])
  const payouts = -sum(['PAYOUT'])
  const adjustments = sum(['ADJUSTMENT', 'REVERSAL'])
  const counts = get<{ tickets: number; cancelled: number; paid: number }>(
    "SELECT COUNT(*) AS tickets, SUM(status='CANCELLED') AS cancelled, SUM(status='PAID') AS paid FROM tickets WHERE shift_id = ?",
    shiftId,
  )!
  return {
    id: s.id as number,
    openedAt: s.opened_at as number,
    closedAt: s.closed_at as number | null,
    status: s.status as string,
    openingFloat: s.opening_float as number,
    sales,
    cancellations,
    payouts,
    adjustments,
    expectedCash: s.opening_float + sales - cancellations - payouts + adjustments,
    ticketCount: counts.tickets,
    cancelledCount: counts.cancelled ?? 0,
    paidCount: counts.paid ?? 0,
    countedCash: s.counted_cash as number | null,
    difference: s.difference as number | null,
  }
}

export const openShift = (userId: number) => get('SELECT * FROM cashier_shifts WHERE user_id = ? AND status = ?', userId, 'OPEN')

export function startShift(u: AuthUser, openingFloat: number, ctx: Ctx) {
  if (!u.shopId) throw new ApiError(403, 'NO_SHOP', 'Cashier is not assigned to a shop')
  if (!Number.isSafeInteger(openingFloat) || openingFloat < 0) throw new ApiError(400, 'BAD_AMOUNT', 'Opening float must be zero or more')
  return tx(() => {
    if (openShift(u.id)) throw new ApiError(409, 'SHIFT_OPEN', 'You already have an open shift')
    const shop = get('SELECT status FROM shops WHERE id = ?', u.shopId)
    if (shop?.status !== 'ACTIVE') throw new ApiError(403, 'SHOP_INACTIVE', 'Shop is not active')
    const r = run('INSERT INTO cashier_shifts (user_id, shop_id, opened_at, opening_float) VALUES (?,?,?,?)', u.id, u.shopId, Date.now(), openingFloat)
    const id = Number(r.lastInsertRowid)
    audit('SHIFT_STARTED', 'shift', id, { openingFloat }, ctx)
    return shiftSummary(id)
  })
}

export function closeShift(u: AuthUser, body: { countedCash: number; pin: string; note?: string }, ctx: Ctx) {
  checkPin(u.id, body.pin, ctx)
  if (!Number.isSafeInteger(body.countedCash) || body.countedCash < 0) throw new ApiError(400, 'BAD_AMOUNT', 'Counted cash must be zero or more')
  return tx(() => {
    const shift = openShift(u.id)
    if (!shift) throw new ApiError(409, 'NO_SHIFT', 'You have no open shift')
    const s = shiftSummary(shift.id)
    const diff = body.countedCash - s.expectedCash
    run(
      "UPDATE cashier_shifts SET status='CLOSED', closed_at=?, counted_cash=?, expected_cash=?, difference=?, sales=?, cancellations=?, payouts=?, adjustments=?, close_note=? WHERE id=?",
      Date.now(), body.countedCash, s.expectedCash, diff, s.sales, s.cancellations, s.payouts, s.adjustments, (body.note ?? '').slice(0, 500), shift.id,
    )
    audit('SHIFT_CLOSED', 'shift', shift.id, { expected: s.expectedCash, counted: body.countedCash, difference: diff }, ctx)
    if (diff !== 0) {
      raiseAlert('SHIFT_DIFFERENCE', Math.abs(diff) >= 10_000 ? 'MEDIUM' : 'LOW', `${u.fullName} closed shift #${shift.id} with a difference of ${diff / 100} ETB`, { shopId: u.shopId, userId: u.id, details: { shiftId: shift.id, diff } })
    }
    return shiftSummary(shift.id)
  })
}

// ─── Markets shown on the POS ───────────────────────────────────────────────
function dogMarkets(g: { wheel_snapshot: string }) {
  const snap = JSON.parse(g.wheel_snapshot) as RaceSnapshot
  const names = snap.dogs.map((d) => d.name)
  const codes = Object.keys(snap.odds)
  const option = (code: string) => {
    const p = parseRule(code)!
    return { id: 0, code, label: ruleLabel(code, names), tone: '', numbers: [] as number[], dogs: p.dogs, oddsX100: snap.odds[code] }
  }
  const market = (id: number, kind: keyof typeof KIND_NAME) => ({ id, code: kind, name: KIND_NAME[kind], kind: 'DOG', options: codes.filter((c) => c.startsWith(`${kind}:`)).map(option) })
  return { dogs: snap.dogs, markets: [market(1, 'WIN'), market(2, 'PLACE'), market(3, 'FC'), market(4, 'QN')] }
}

export function posMarkets(type: GameType = 'WHEEL') {
  const g = currentGame(type)
  if (!g) return { gameId: null, game: type, markets: [] as any[] }
  if (type === 'DOGS') return { gameId: g.id, game: type, ...dogMarkets(g) }
  const segs = JSON.parse(g.wheel_snapshot) as SnapSeg[]
  const nums = new Set(segs.map((s) => s.number))
  const mult = new Map(segs.map((s) => [s.number, s.multiplierX100]))
  const markets = all('SELECT * FROM bet_markets WHERE active = 1 ORDER BY sort_order, id').map((m) => ({
    id: m.id,
    code: m.code,
    name: m.name,
    kind: m.kind,
    options: all('SELECT * FROM bet_options WHERE market_id = ? AND active = 1 ORDER BY sort_order, id', m.id)
      .map((o) => {
        const numbers = (JSON.parse(o.segment_numbers) as number[]).filter((n) => nums.has(n))
        return { id: o.id, code: o.code, label: o.label, tone: o.tone, numbers, oddsX100: resolveOdds(o, mult) }
      })
      .filter((o) => o.numbers.length > 0),
  }))
  return { gameId: g.id, game: type, markets: markets.filter((m) => m.options.length > 0) }
}

function resolveOdds(o: { odds_source: string; odds_x100: number; segment_numbers: string }, mult: Map<number, number>): number {
  if (o.odds_source !== 'SEGMENT') return o.odds_x100
  const ms = (JSON.parse(o.segment_numbers) as number[]).map((n) => mult.get(n)).filter((v): v is number => v !== undefined)
  return ms.length ? Math.min(...ms) : o.odds_x100
}

// ─── Booking ────────────────────────────────────────────────────────────────
export interface BookInput {
  /** Which game the ticket is for. Defaults to the wheel. */
  game?: GameType
  /** Wheel bets carry an optionId; dog race bets carry a bet code such as WIN:3 or FC:3-5. */
  selections: { optionId?: number; code?: string; stake: number }[]
  ageConfirmed: boolean
}

export function bookTicket(u: AuthUser, input: BookInput, ctx: Ctx, idemKey?: string) {
  const c = cfg()
  const sel = input?.selections
  if (!Array.isArray(sel) || sel.length === 0) throw new ApiError(400, 'NO_SELECTIONS', 'Add at least one bet')
  if (sel.length > c['limits.maxSelections']) throw new ApiError(400, 'TOO_MANY_SELECTIONS', `A ticket can hold at most ${c['limits.maxSelections']} bets`)

  return tx(() => {
    // A retried request (same key) returns the ticket that was already created instead of a second one.
    if (idemKey) {
      const dup = get('SELECT id FROM tickets WHERE cashier_id = ? AND idem_key = ?', u.id, idemKey)
      if (dup) return { receipt: receiptOf(dup.id, false), balance: null as number | null, replayed: true }
    }
    // 1. Round must still be open according to the SERVER clock, evaluated inside the write lock.
    const now = Date.now()
    const g = currentGame(input.game === 'DOGS' ? 'DOGS' : 'WHEEL')
    if (!g || g.status !== 'BETTING_OPEN' || now >= g.closes_at || now < g.opens_at) {
      throw new ApiError(409, 'BETTING_CLOSED', 'Betting is closed for this round')
    }
    // 2. Cashier / shop / shift
    if (!u.shopId) throw new ApiError(403, 'NO_SHOP', 'Cashier is not assigned to a shop')
    const shop = get('SELECT * FROM shops WHERE id = ?', u.shopId)!
    if (shop.status !== 'ACTIVE') throw new ApiError(403, 'SHOP_INACTIVE', 'Shop is not active')
    const shift = openShift(u.id)
    if (!shift) throw new ApiError(409, 'NO_SHIFT', 'Start your shift before booking tickets')
    if (c['compliance.minAge'] > 0 && input.ageConfirmed !== true) {
      throw new ApiError(400, 'AGE_NOT_CONFIRMED', `Confirm the player is ${c['compliance.minAge']} or older`)
    }
    // 3. Validate each selection against the live configuration and this round's wheel / race
    interface Line { optionId: number; marketName: string; label: string; numbers: number[]; rule: string | null; stake: number; odds: number; possible: number }
    let total = 0
    const checkStake = (stake: unknown): number => {
      if (!Number.isSafeInteger(stake)) throw new ApiError(400, 'BAD_SELECTION', 'Invalid bet')
      const v = stake as number
      if (v % 100 !== 0) throw new ApiError(400, 'BAD_STAKE', 'Stakes must be whole ETB amounts')
      if (v < c['limits.minStake']) throw new ApiError(400, 'STAKE_TOO_LOW', `Minimum stake is ${c['limits.minStake'] / 100} ETB`)
      if (v > c['limits.maxSelectionStake']) throw new ApiError(400, 'STAKE_TOO_HIGH', `Maximum stake per bet is ${c['limits.maxSelectionStake'] / 100} ETB`)
      total += v
      return v
    }
    let lines: Line[]
    let maxWin: number
    if (g.game_type === 'DOGS') {
      const snap = JSON.parse(g.wheel_snapshot) as RaceSnapshot
      const names = snap.dogs.map((d) => d.name)
      const seen = new Set<string>()
      lines = sel.map((s) => {
        const p = parseRule(s.code)
        if (!p) throw new ApiError(400, 'OPTION_UNAVAILABLE', 'A selected bet is not available')
        const rule = s.code as string
        if (seen.has(rule)) throw new ApiError(400, 'DUPLICATE_SELECTION', 'The same bet appears twice; combine the stakes')
        seen.add(rule)
        const stake = checkStake(s.stake)
        const odds = snap.odds[rule] // fixed for the round: derived from the published strengths
        return { optionId: 0, marketName: KIND_NAME[p.kind], label: ruleLabel(rule, names), numbers: [], rule, stake, odds, possible: payoutFor(stake, odds) }
      })
      // Worst case = the single finishing order that pays this ticket the most.
      maxWin = worstCase(lines.map((l) => ({ rule: l.rule!, payout: l.possible })))
    } else {
      const segs = JSON.parse(g.wheel_snapshot) as SnapSeg[]
      const nums = new Set(segs.map((s) => s.number))
      const mult = new Map(segs.map((s) => [s.number, s.multiplierX100]))
      const seen = new Set<number>()
      lines = sel.map((s) => {
        if (!Number.isInteger(s.optionId)) throw new ApiError(400, 'BAD_SELECTION', 'Invalid bet')
        const optionId = s.optionId as number
        if (seen.has(optionId)) throw new ApiError(400, 'DUPLICATE_SELECTION', 'The same bet appears twice; combine the stakes')
        seen.add(optionId)
        const o = get('SELECT o.*, m.name AS market_name, m.active AS market_active FROM bet_options o JOIN bet_markets m ON m.id = o.market_id WHERE o.id = ?', optionId)
        if (!o || !o.active || !o.market_active) throw new ApiError(400, 'OPTION_UNAVAILABLE', 'A selected bet is no longer available')
        const numbers = (JSON.parse(o.segment_numbers) as number[]).filter((n) => nums.has(n))
        if (numbers.length === 0) throw new ApiError(400, 'OPTION_UNAVAILABLE', `${o.label} cannot win in this round`)
        const stake = checkStake(s.stake)
        const odds = resolveOdds(o, mult)
        return { optionId: o.id, marketName: o.market_name, label: o.label, numbers, rule: null, stake, odds, possible: payoutFor(stake, odds) }
      })
      // True worst case for the house = the outcome that pays the most across all selections.
      maxWin = Math.max(...segs.map((sg) => lines.filter((l) => l.numbers.includes(sg.number)).reduce((a, l) => a + l.possible, 0)))
    }
    if (total > c['limits.maxTicketStake']) throw new ApiError(400, 'TICKET_STAKE_TOO_HIGH', `Maximum ticket stake is ${c['limits.maxTicketStake'] / 100} ETB`)
    if (maxWin > c['limits.maxPayout']) throw new ApiError(400, 'PAYOUT_LIMIT', `Possible win exceeds the maximum payout of ${c['limits.maxPayout'] / 100} ETB`)

    // 4. Create ticket, selections, ledger entry, audit — all in this one transaction.
    const dk = dayKey(now).replaceAll('-', '')
    const ticketNumber = `SW-${dk}-${pad(nextCounter(`ticket:${dk}`), 6)}`
    const secureRef = randomCode(16)
    const verifyCode = randomCode(6)
    const r = run(
      `INSERT INTO tickets (ticket_number, secure_ref, verify_code, game_id, shop_id, cashier_id, shift_id, status, total_stake, max_win, age_confirmed, device_id, ip, created_at, idem_key)
       VALUES (?,?,?,?,?,?,?,'ACTIVE',?,?,?,?,?,?,?)`,
      ticketNumber, secureRef, verifyCode, g.id, shop.id, u.id, shift.id, total, maxWin, input.ageConfirmed ? 1 : 0, ctx.deviceId ?? null, ctx.ip ?? null, now, idemKey ?? null,
    )
    const ticketId = Number(r.lastInsertRowid)
    for (const l of lines) {
      run(
        'INSERT INTO ticket_selections (ticket_id, option_id, market_name, option_label, segment_numbers, rule, stake, odds_x100, possible_win) VALUES (?,?,?,?,?,?,?,?,?)',
        ticketId, l.optionId, l.marketName, l.label, JSON.stringify(l.numbers), l.rule, l.stake, l.odds, l.possible,
      )
    }
    const txn = postTxn({ shopId: shop.id, type: 'TICKET_SALE', amount: total, userId: u.id, shiftId: shift.id, ticketId, gameId: g.id, note: ticketNumber })
    audit('TICKET_BOOKED', 'ticket', ticketNumber, { game: g.id, type: g.game_type, total, maxWin, selections: lines.length, txn: txn.ref }, ctx)
    return { receipt: receiptOf(ticketId, false), balance: txn.balanceAfter as number | null, replayed: false }
  })
}

export function receiptOf(ticketId: number, duplicate: boolean) {
  const t = get('SELECT * FROM tickets WHERE id = ?', ticketId)!
  const shop = get('SELECT * FROM shops WHERE id = ?', t.shop_id)!
  const cashier = get('SELECT cashier_code, full_name FROM users WHERE id = ?', t.cashier_id)!
  const c = cfg()
  const gameType = (get<{ game_type: GameType }>('SELECT game_type FROM games WHERE id = ?', t.game_id)?.game_type ?? 'WHEEL') as GameType
  return {
    company: c['company.name'],
    gameType,
    gameName: gameType === 'DOGS' ? 'DOG RACE' : 'SPIN & WHEEL',
    shop: { name: shop.name, code: shop.code, address: shop.address, phone: shop.phone },
    ticketNumber: t.ticket_number as string,
    gameId: t.game_id as number,
    createdAt: t.created_at as number,
    cashier: (cashier.cashier_code ?? cashier.full_name) as string,
    selections: all('SELECT * FROM ticket_selections WHERE ticket_id = ? ORDER BY id', ticketId).map((s) => ({
      market: s.market_name as string,
      label: s.option_label as string,
      stake: s.stake as number,
      oddsX100: s.odds_x100 as number,
      possibleWin: s.possible_win as number,
    })),
    totalStake: t.total_stake as number,
    maxWin: t.max_win as number,
    qrPayload: `SW1:${t.secure_ref}`,
    barcode: t.ticket_number as string,
    verifyCode: t.verify_code as string,
    expiryDays: c['ticket.expiryDays'],
    footer: c['receipt.footer'],
    notice: c['compliance.notice'],
    duplicate,
  }
}

// ─── Cancel (only while betting is still open) ──────────────────────────────
export function cancelTicket(u: AuthUser, body: { ticketNumber: string; pin?: string; reason?: string }, ctx: Ctx) {
  if (u.role === 'CASHIER') checkPin(u.id, body.pin, ctx)
  return tx(() => {
    const t = get('SELECT * FROM tickets WHERE ticket_number = ?', String(body.ticketNumber))
    if (!t) throw new ApiError(404, 'NOT_FOUND', 'Ticket not found')
    if (u.role !== 'ADMIN' && t.shop_id !== u.shopId) throw new ApiError(403, 'FORBIDDEN', 'Ticket belongs to another shop')
    if (u.role === 'CASHIER' && t.cashier_id !== u.id) throw new ApiError(403, 'FORBIDDEN', 'You can only cancel tickets you issued')
    const g = get('SELECT * FROM games WHERE id = ?', t.game_id)!
    const now = Date.now()
    if (t.status !== 'ACTIVE' || g.status !== 'BETTING_OPEN' || now >= g.closes_at) {
      throw new ApiError(409, 'CANNOT_CANCEL', 'Tickets can only be cancelled while betting is open')
    }
    const sale = get('SELECT id FROM financial_transactions WHERE ticket_id = ? AND type = ?', t.id, 'TICKET_SALE')!
    run("UPDATE tickets SET status = 'CANCELLED', cancelled_at = ?, cancelled_by = ? WHERE id = ?", now, u.id, t.id)
    const txn = postTxn({ shopId: t.shop_id, type: 'TICKET_CANCEL', amount: -t.total_stake, userId: u.id, shiftId: t.shift_id, ticketId: t.id, gameId: t.game_id, reversesId: sale.id, note: (body.reason ?? '').slice(0, 200) || 'Ticket cancelled' })
    audit('TICKET_CANCELLED', 'ticket', t.ticket_number, { refund: t.total_stake, txn: txn.ref, reason: body.reason ?? '' }, ctx)
    const cancels = get<{ n: number }>("SELECT COUNT(*) AS n FROM tickets WHERE cancelled_by = ? AND shift_id = ?", u.id, t.shift_id)!.n
    if (cancels === cfg()['compliance.cancelAlertCount']) {
      raiseAlert('FREQUENT_CANCELLATIONS', 'MEDIUM', `${u.fullName} has cancelled ${cancels} tickets in one shift`, { shopId: t.shop_id, userId: u.id })
    }
    return { ticketNumber: t.ticket_number, refunded: t.total_stake }
  })
}

// ─── Lookup / check ─────────────────────────────────────────────────────────
function findTicket(raw: string) {
  const q = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '')
  if (!q) return { row: undefined, viaRef: false }
  const ref = q.startsWith('SW1:') ? q.slice(4) : /^[A-Z2-9]{16}$/.test(q) ? q : null
  if (ref) return { row: get('SELECT * FROM tickets WHERE secure_ref = ?', ref), viaRef: true }
  if (/^\d{1,6}$/.test(q)) {
    return { row: get('SELECT * FROM tickets WHERE ticket_number = ?', `SW-${dayKey(Date.now()).replaceAll('-', '')}-${pad(Number(q), 6)}`), viaRef: false }
  }
  return { row: get('SELECT * FROM tickets WHERE ticket_number = ?', q), viaRef: false }
}

export function outcomeOf(status: string): Outcome {
  switch (status) {
    case 'WON': return 'WON'
    case 'LOST': return 'LOST'
    case 'PAID': return 'ALREADY_PAID'
    case 'CANCELLED': return 'CANCELLED'
    case 'EXPIRED': return 'EXPIRED'
    default: return 'PENDING'
  }
}

export function lookupTicket(u: AuthUser, query: string, ctx: Ctx) {
  const { row, viaRef } = findTicket(query)
  if (!row) {
    audit('TICKET_LOOKUP_MISS', 'ticket', null, { query: String(query).slice(0, 40) }, ctx)
    const misses = get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'TICKET_LOOKUP_MISS' AND actor_id = ? AND ts > ?", u.id, Date.now() - 10 * 60_000)!.n
    if (misses === 5) raiseAlert('TICKET_GUESSING', 'MEDIUM', `${u.fullName} entered 5 unknown ticket numbers in 10 minutes`, { shopId: u.shopId, userId: u.id })
    throw new ApiError(404, 'TICKET_NOT_FOUND', 'No ticket found with that number')
  }
  // Lazy expiry so the answer is right even between sweeps.
  if (row.status === 'WON' && row.expires_at && row.expires_at <= Date.now()) {
    tx(() => {
      run("UPDATE tickets SET status = 'EXPIRED' WHERE id = ? AND status = 'WON'", row.id)
      audit('TICKET_EXPIRED', 'ticket', row.ticket_number, { forfeited: row.actual_win }, { shopId: row.shop_id })
    })
    row.status = 'EXPIRED'
  }
  audit('TICKET_CHECKED', 'ticket', row.ticket_number, { viaRef }, ctx)
  const shop = get('SELECT name, code FROM shops WHERE id = ?', row.shop_id)!
  const foreign = u.shopId !== row.shop_id
  const base = { ticketNumber: row.ticket_number as string, status: row.status as string, outcome: outcomeOf(row.status), gameId: row.game_id as number, gameType: (get<{ game_type: string }>('SELECT game_type FROM games WHERE id = ?', row.game_id)?.game_type ?? 'WHEEL') as GameType, shop: { name: shop.name, code: shop.code } }
  if (foreign) return { ...base, foreignShop: true, verified: viaRef }
  const cashier = get('SELECT cashier_code, full_name FROM users WHERE id = ?', row.cashier_id)!
  const paidBy = row.paid_by ? get('SELECT cashier_code, full_name FROM users WHERE id = ?', row.paid_by) : null
  const result = get("SELECT r.segment_number, r.category, r.result_json FROM game_results r JOIN games g ON g.id = r.game_id WHERE r.game_id = ? AND g.status IN ('RESULT','COMPLETED')", row.game_id)
  return {
    ...base,
    foreignShop: false,
    verified: viaRef,
    createdAt: row.created_at as number,
    cashier: (cashier.cashier_code ?? cashier.full_name) as string,
    totalStake: row.total_stake as number,
    maxWin: row.max_win as number,
    winAmount: row.actual_win as number | null,
    expiresAt: row.expires_at as number | null,
    paidAt: row.paid_at as number | null,
    paidAmount: row.paid_amount as number | null,
    paidBy: paidBy ? ((paidBy.cashier_code ?? paidBy.full_name) as string) : null,
    cancelledAt: row.cancelled_at as number | null,
    result: result ? { number: result.segment_number as number, category: result.category as string, order: result.result_json ? (JSON.parse(result.result_json) as number[]) : undefined } : null,
    selections: all('SELECT * FROM ticket_selections WHERE ticket_id = ? ORDER BY id', row.id).map((s) => ({
      market: s.market_name as string,
      label: s.option_label as string,
      stake: s.stake as number,
      oddsX100: s.odds_x100 as number,
      possibleWin: s.possible_win as number,
      isWin: s.is_win === null ? null : s.is_win === 1,
      winAmount: s.win_amount as number | null,
    })),
  }
}

// ─── Payout ─────────────────────────────────────────────────────────────────
export interface PayInput {
  ticketNumber: string
  code?: string
  scan?: string
  pin: string
  approverUsername?: string
  approverPin?: string
}

export function payTicket(u: AuthUser, body: PayInput, ctx: Ctx) {
  checkPin(u.id, body.pin, ctx)
  const pre = get('SELECT actual_win AS amt FROM tickets WHERE ticket_number = ?', String(body.ticketNumber))
  // A payout above the cashier's limit needs a manager/admin to enter their own PIN.
  let approverId: number | null = null
  if (pre && pre.amt > u.payoutLimit) {
    const ap = get('SELECT * FROM users WHERE username = ? AND status = ?', String(body.approverUsername ?? '').trim().toLowerCase(), 'ACTIVE')
    const eligible = ap && (ap.role === 'ADMIN' || (ap.role === 'MANAGER' && ap.shop_id === u.shopId))
    if (!eligible) throw new ApiError(403, 'APPROVAL_REQUIRED', `This payout exceeds your limit of ${u.payoutLimit / 100} ETB. A shop manager must approve it.`, { needsApproval: true })
    checkPin(ap.id, body.approverPin, ctx)
    approverId = ap.id
  }
  return tx(() => {
    const t = get('SELECT * FROM tickets WHERE ticket_number = ?', String(body.ticketNumber))
    if (!t) throw new ApiError(404, 'TICKET_NOT_FOUND', 'Ticket not found')
    if (t.shop_id !== u.shopId) throw new ApiError(403, 'OTHER_SHOP', 'This ticket must be paid at the shop that issued it')
    // The ticket holder must present the ticket: either the scanned QR reference or the printed verification code.
    const scanRef = String(body.scan ?? '').toUpperCase().replace(/^SW1:/, '')
    const okRef = scanRef !== '' && safeEqual(scanRef, t.secure_ref)
    const okCode = !!body.code && safeEqual(String(body.code).trim().toUpperCase(), t.verify_code)
    if (!okRef && !okCode) {
      audit('PAYOUT_REJECTED', 'ticket', t.ticket_number, { reason: 'bad verification' }, ctx)
      throw new ApiError(403, 'BAD_VERIFICATION', 'Verification code does not match the ticket')
    }
    if (t.status === 'PAID') throw new ApiError(409, 'ALREADY_PAID', 'This ticket has already been paid')
    if (t.status === 'WON' && t.expires_at && t.expires_at <= Date.now()) throw new ApiError(409, 'EXPIRED', 'This ticket has expired')
    if (t.status !== 'WON') throw new ApiError(409, 'NOT_PAYABLE', `Ticket is ${t.status.replace('_', ' ')} and cannot be paid`)
    const shift = openShift(u.id)
    if (!shift) throw new ApiError(409, 'NO_SHIFT', 'Start your shift before paying tickets')
    const now = Date.now()
    const txn = postTxn({ shopId: t.shop_id, type: 'PAYOUT', amount: -t.actual_win, userId: u.id, shiftId: shift.id, ticketId: t.id, gameId: t.game_id, note: t.ticket_number })
    run('INSERT INTO payouts (ref, ticket_id, shop_id, cashier_id, shift_id, amount, approved_by, created_at) VALUES (?,?,?,?,?,?,?,?)', txn.ref, t.id, t.shop_id, u.id, shift.id, t.actual_win, approverId, now)
    run("UPDATE tickets SET status = 'PAID', paid_at = ?, paid_by = ?, paid_amount = ? WHERE id = ? AND status = 'WON'", now, u.id, t.actual_win, t.id)
    audit('TICKET_PAID', 'ticket', t.ticket_number, { amount: t.actual_win, txn: txn.ref, approver: approverId }, ctx)
    if (t.actual_win >= cfg()['compliance.largePayout']) {
      raiseAlert('LARGE_PAYOUT', 'HIGH', `Payout of ${t.actual_win / 100} ETB on ${t.ticket_number} by ${u.fullName}`, { shopId: t.shop_id, userId: u.id, details: { ticket: t.ticket_number } })
    }
    return { ticketNumber: t.ticket_number, amount: t.actual_win as number, ref: txn.ref, paidAt: now }
  })
}

export function reprintTicket(u: AuthUser, body: { ticketNumber: string; pin: string }, ctx: Ctx) {
  checkPin(u.id, body.pin, ctx)
  return tx(() => {
    const t = get('SELECT * FROM tickets WHERE ticket_number = ?', String(body.ticketNumber))
    if (!t || t.shop_id !== u.shopId) throw new ApiError(404, 'TICKET_NOT_FOUND', 'Ticket not found in your shop')
    if (t.status === 'CANCELLED') throw new ApiError(409, 'CANCELLED', 'Cancelled tickets cannot be reprinted')
    run('UPDATE tickets SET print_count = print_count + 1 WHERE id = ?', t.id)
    audit('TICKET_REPRINTED', 'ticket', t.ticket_number, { printCount: t.print_count + 1 }, ctx)
    return receiptOf(t.id, true)
  })
}

export function cashierToday(userId: number) {
  const s = openShift(userId)
  return s ? shiftSummary(s.id) : null
}
