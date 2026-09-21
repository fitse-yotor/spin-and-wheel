import { Router } from 'express'
import { audit, verifyAuditChain } from '../audit.ts'
import { authOf, ctxOf, requirePerm, scopeShop } from '../auth.ts'
import { all, get, run, tx } from '../db.ts'
import { currentGame, GAME_TYPES, phaseOf } from '../game.ts'
import { postTxn, verifyLedger } from '../ledger.ts'
import { presence } from '../realtime.ts'
import { shiftSummary } from '../tickets.ts'
import { ApiError, DAY_MS, dayStart, todayRange } from '../util.ts'

export const reports = Router()

/** Inclusive YYYY-MM-DD (EAT) → [from, to) in epoch ms. Defaults to today. */
function range(q: Record<string, unknown>): [number, number] {
  const ok = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  if (!ok(q.from) && !ok(q.to)) return todayRange()
  const from = ok(q.from) ? dayStart(q.from as string) : dayStart(q.to as string)
  const to = (ok(q.to) ? dayStart(q.to as string) : dayStart(q.from as string)) + DAY_MS
  if (to <= from) throw new ApiError(400, 'BAD_RANGE', 'The end date is before the start date')
  if (to - from > 370 * DAY_MS) throw new ApiError(400, 'BAD_RANGE', 'Choose a range of one year or less')
  return [from, to]
}
const num = (v: unknown) => (v !== undefined && v !== '' && Number.isInteger(Number(v)) ? Number(v) : null)

const viewer = requirePerm('reports.view')

// ─── Dashboard ──────────────────────────────────────────────────────────────
reports.get('/dashboard', viewer, (_req, res) => {
  const u = authOf(res)
  const shop = scopeShop(u, null)
  const [from, to] = todayRange()
  const sf = shop ? 'AND t.shop_id = ?' : ''
  const sp = shop ? [shop] : []
  const t = get(
    `SELECT COUNT(CASE WHEN t.status != 'CANCELLED' THEN 1 END) AS tickets,
       COALESCE(SUM(CASE WHEN t.status != 'CANCELLED' THEN t.total_stake END),0) AS turnover,
       COALESCE(SUM(CASE WHEN t.status IN ('WON','PAID','LOST','EXPIRED') THEN t.total_stake END),0) AS settled_stake,
       COALESCE(SUM(CASE WHEN t.status IN ('WON','PAID') THEN t.actual_win END),0) AS winnings,
       COUNT(CASE WHEN t.status IN ('WON','PAID','EXPIRED') THEN 1 END) AS winning_tickets
     FROM tickets t WHERE t.created_at >= ? AND t.created_at < ? ${sf}`,
    from, to, ...sp,
  )!
  const paid = get<{ v: number }>(`SELECT COALESCE(SUM(p.amount),0) AS v FROM payouts p WHERE p.created_at >= ? AND p.created_at < ? ${shop ? 'AND p.shop_id = ?' : ''}`, from, to, ...sp)!.v
  const rounds = GAME_TYPES.map((t) => ({ game: t, g: currentGame(t) })).filter((r) => r.g).map((r) => ({ game: r.game, id: r.g!.id, phase: phaseOf(r.g!) }))
  const online = presence()
  const hourly = all(
    `SELECT CAST(((t.created_at + 10800000) % 86400000) / 3600000 AS INTEGER) AS hour, COALESCE(SUM(t.total_stake),0) AS turnover, COUNT(*) AS tickets
     FROM tickets t WHERE t.status != 'CANCELLED' AND t.created_at >= ? AND t.created_at < ? ${sf} GROUP BY hour ORDER BY hour`,
    from, to, ...sp,
  )
  const days = all(
    `SELECT strftime('%Y-%m-%d', (t.created_at + 10800000) / 1000, 'unixepoch') AS day,
       COALESCE(SUM(CASE WHEN t.status != 'CANCELLED' THEN t.total_stake END),0) AS turnover,
       COALESCE(SUM(CASE WHEN t.status IN ('WON','PAID','LOST','EXPIRED') THEN t.total_stake END),0) - COALESCE(SUM(CASE WHEN t.status IN ('WON','PAID') THEN t.actual_win END),0) AS ggr
     FROM tickets t WHERE t.created_at >= ? AND t.created_at < ? ${sf} GROUP BY day ORDER BY day`,
    to - 7 * DAY_MS, to, ...sp,
  )
  res.json({
    scope: shop ? 'SHOP' : 'COMPANY',
    turnover: t.turnover,
    payout: paid,
    ggr: t.settled_stake - t.winnings,
    ticketsSold: t.tickets,
    winningTickets: t.winning_tickets,
    activeShops: get<{ n: number }>(`SELECT COUNT(*) AS n FROM shops WHERE status = 'ACTIVE' ${shop ? 'AND id = ?' : ''}`, ...sp)!.n,
    onlineShops: presence().filter((p) => p.online && (!shop || p.shopId === shop)).length,
    activeCashiers: get<{ n: number }>(`SELECT COUNT(*) AS n FROM cashier_shifts WHERE status = 'OPEN' ${shop ? 'AND shop_id = ?' : ''}`, ...sp)!.n,
    currentRound: rounds.find((r) => r.game === 'WHEEL') ?? null,
    rounds,
    unpaidWinnings: get<{ v: number }>(`SELECT COALESCE(SUM(actual_win),0) AS v FROM tickets t WHERE t.status = 'WON' ${sf}`, ...sp)!.v,
    openAlerts: u.role === 'ADMIN' ? get<{ n: number }>("SELECT COUNT(*) AS n FROM alerts WHERE status = 'OPEN'")!.n : null,
    hourly,
    days,
    online: online.length,
  })
})

// ─── Live monitoring ────────────────────────────────────────────────────────
reports.get('/live', requirePerm('monitor.own'), (_req, res) => {
  const u = authOf(res)
  const shopFilter = scopeShop(u, null)
  const [from, to] = todayRange()
  const pres = new Map(presence().map((p) => [p.shopId, p]))
  const rows = all(
    `SELECT s.id, s.code, s.name, s.status,
       (SELECT COUNT(*) FROM cashier_shifts c WHERE c.shop_id = s.id AND c.status = 'OPEN') AS cashiers,
       (SELECT COUNT(*) FROM tickets t WHERE t.shop_id = s.id AND t.status != 'CANCELLED' AND t.created_at >= ? AND t.created_at < ?) AS tickets,
       (SELECT COALESCE(SUM(t.total_stake),0) FROM tickets t WHERE t.shop_id = s.id AND t.status != 'CANCELLED' AND t.created_at >= ? AND t.created_at < ?) AS turnover,
       (SELECT COALESCE(SUM(p.amount),0) FROM payouts p WHERE p.shop_id = s.id AND p.created_at >= ? AND p.created_at < ?) AS payout,
       (SELECT COALESCE(balance,0) FROM wallets w WHERE w.shop_id = s.id) AS balance
     FROM shops s ${shopFilter ? 'WHERE s.id = ?' : ''} ORDER BY s.name`,
    from, to, from, to, from, to, ...(shopFilter ? [shopFilter] : []),
  )
  res.json({
    shops: rows.map((s) => ({ ...s, online: pres.get(s.id)?.online ?? false, posTerminals: pres.get(s.id)?.pos ?? 0, displays: pres.get(s.id)?.display ?? 0 })),
    rounds: GAME_TYPES.map((t) => ({ game: t, g: currentGame(t) })).filter((r) => r.g).map((r) => ({ game: r.game, id: r.g!.id, phase: phaseOf(r.g!) })),
  })
})

// ─── Reports ────────────────────────────────────────────────────────────────
reports.get('/reports/sales', viewer, (req, res) => {
  const u = authOf(res)
  const [from, to] = range(req.query)
  const shop = scopeShop(u, req.query.shopId)
  const by = String(req.query.groupBy ?? 'date')
  const exprs: Record<string, string> = {
    date: "strftime('%Y-%m-%d', (t.created_at + 10800000) / 1000, 'unixepoch')",
    shop: 's.name',
    cashier: 'us.full_name',
    game: "'#' || CASE WHEN t.game_id >= 1000000000 THEN 'D' || printf('%05d', t.game_id - 1000000000) ELSE printf('%06d', t.game_id) END",
    region: 'r.name',
  }
  if (!exprs[by]) throw new ApiError(400, 'BAD_INPUT', 'groupBy must be one of date, shop, cashier, game, region')
  const where = ['t.created_at >= ?', 't.created_at < ?']
  const params: unknown[] = [from, to]
  if (shop) { where.push('t.shop_id = ?'); params.push(shop) }
  for (const [col, key] of [['t.cashier_id', 'cashierId'], ['t.game_id', 'gameId'], ['s.region_id', 'regionId']] as const) {
    const v = num(req.query[key])
    if (v !== null) { where.push(`${col} = ?`); params.push(v) }
  }
  const rows = all(
    `SELECT ${exprs[by]} AS grp,
       COUNT(CASE WHEN t.status != 'CANCELLED' THEN 1 END) AS tickets,
       COALESCE(SUM(CASE WHEN t.status != 'CANCELLED' THEN t.total_stake END),0) AS turnover,
       COUNT(CASE WHEN t.status = 'CANCELLED' THEN 1 END) AS cancelled,
       COALESCE(SUM(CASE WHEN t.status = 'CANCELLED' THEN t.total_stake END),0) AS cancelled_amount,
       COALESCE(SUM(CASE WHEN t.status IN ('WON','PAID') THEN t.actual_win END),0) AS winnings,
       COALESCE(SUM(t.paid_amount),0) AS paid,
       COALESCE(SUM(CASE WHEN t.status IN ('WON','PAID','LOST','EXPIRED') THEN t.total_stake END),0) AS settled_stake
     FROM tickets t JOIN shops s ON s.id = t.shop_id JOIN regions r ON r.id = s.region_id JOIN users us ON us.id = t.cashier_id
     WHERE ${where.join(' AND ')} GROUP BY grp ORDER BY grp ${by === 'date' || by === 'game' ? 'DESC' : 'ASC'} LIMIT 1000`,
    ...params,
  ).map((r) => ({ group: r.grp, tickets: r.tickets, turnover: r.turnover, cancelled: r.cancelled, cancelledAmount: r.cancelled_amount, winnings: r.winnings, paid: r.paid, ggr: r.settled_stake - r.winnings }))
  res.json({ groupBy: by, rows })
})

reports.get('/reports/payouts', viewer, (req, res) => {
  const u = authOf(res)
  const [from, to] = range(req.query)
  const shop = scopeShop(u, req.query.shopId)
  const filter = String(req.query.status ?? '')
  const where = ["t.status IN ('WON','PAID','EXPIRED')", 't.settled_at >= ?', 't.settled_at < ?']
  const params: unknown[] = [from, to]
  if (shop) { where.push('t.shop_id = ?'); params.push(shop) }
  if (['WON', 'PAID', 'EXPIRED'].includes(filter)) { where.push('t.status = ?'); params.push(filter) }
  const rows = all(
    `SELECT t.ticket_number, t.game_id, t.status, t.total_stake, t.actual_win, t.settled_at, t.paid_at, t.paid_amount, t.expires_at, s.name AS shop, ic.full_name AS issued_by, pc.full_name AS paid_by
     FROM tickets t JOIN shops s ON s.id = t.shop_id JOIN users ic ON ic.id = t.cashier_id LEFT JOIN users pc ON pc.id = t.paid_by
     WHERE ${where.join(' AND ')} ORDER BY t.settled_at DESC LIMIT 2000`,
    ...params,
  ).map((r) => ({ ticketNumber: r.ticket_number, gameId: r.game_id, status: r.status, stake: r.total_stake, winAmount: r.actual_win, settledAt: r.settled_at, paidAt: r.paid_at, paidAmount: r.paid_amount, expiresAt: r.expires_at, shop: r.shop, issuedBy: r.issued_by, paidBy: r.paid_by }))
  const sum = (pred: (r: (typeof rows)[number]) => boolean, f: (r: (typeof rows)[number]) => number) => rows.filter(pred).reduce((a, r) => a + f(r), 0)
  res.json({
    rows,
    summary: {
      winningTickets: rows.length,
      paidTickets: rows.filter((r) => r.status === 'PAID').length,
      paidAmount: sum((r) => r.status === 'PAID', (r) => r.paidAmount ?? 0),
      unpaidWinnings: sum((r) => r.status === 'WON', (r) => r.winAmount ?? 0),
      expiredWinnings: sum((r) => r.status === 'EXPIRED', (r) => r.winAmount ?? 0),
    },
  })
})

reports.get('/reports/games', viewer, (req, res) => {
  const u = authOf(res)
  const [from, to] = range(req.query)
  const shop = scopeShop(u, req.query.shopId)
  const rows = all(
    `SELECT g.id, g.game_type, g.status, g.opens_at, g.closes_at, r.segment_number, r.category, r.multiplier_x100, r.result_json,
       (SELECT COUNT(*) FROM tickets t WHERE t.game_id = g.id AND t.status != 'CANCELLED' ${shop ? 'AND t.shop_id = ?' : ''}) AS tickets,
       (SELECT COALESCE(SUM(t.total_stake),0) FROM tickets t WHERE t.game_id = g.id AND t.status != 'CANCELLED' ${shop ? 'AND t.shop_id = ?' : ''}) AS stakes,
       (SELECT COALESCE(SUM(st.win_amount),0) FROM ticket_settlements st JOIN tickets t ON t.id = st.ticket_id WHERE st.game_id = g.id ${shop ? 'AND t.shop_id = ?' : ''}) AS winnings
     FROM games g LEFT JOIN game_results r ON r.game_id = g.id AND g.status IN ('RESULT','COMPLETED')
     WHERE g.opens_at >= ? AND g.opens_at < ? ORDER BY g.id DESC LIMIT 1000`,
    ...(shop ? [shop, shop, shop] : []), from, to,
  ).map((r) => ({ gameId: r.id, game: r.game_type, finishingOrder: r.result_json ? JSON.parse(r.result_json) : null, status: r.status, tickets: r.tickets, stakes: r.stakes, winnings: r.winnings, companyResult: r.stakes - r.winnings, resultNumber: r.segment_number, category: r.category, multiplier: r.multiplier_x100 ? r.multiplier_x100 / 100 : null, startTime: r.opens_at, closeTime: r.closes_at }))
  res.json({ rows })
})

reports.get('/reports/cashiers', viewer, (req, res) => {
  const u = authOf(res)
  const [from, to] = range(req.query)
  const shop = scopeShop(u, req.query.shopId)
  const rows = all(
    `SELECT c.*, us.full_name, us.cashier_code, s.name AS shop_name FROM cashier_shifts c JOIN users us ON us.id = c.user_id JOIN shops s ON s.id = c.shop_id
     WHERE c.opened_at >= ? AND c.opened_at < ? ${shop ? 'AND c.shop_id = ?' : ''} ORDER BY c.opened_at DESC LIMIT 1000`,
    from, to, ...(shop ? [shop] : []),
  ).map((c) => {
    const live = c.status === 'OPEN' ? shiftSummary(c.id) : null
    return {
      shiftId: c.id, cashier: c.full_name, code: c.cashier_code, shop: c.shop_name, openedAt: c.opened_at, closedAt: c.closed_at, status: c.status,
      openingCash: c.opening_float, sales: live?.sales ?? c.sales, cancellations: live?.cancellations ?? c.cancellations, payouts: live?.payouts ?? c.payouts, adjustments: live?.adjustments ?? c.adjustments,
      expected: live?.expectedCash ?? c.expected_cash, counted: c.counted_cash, difference: c.difference, reconciledAt: c.reconciled_at,
    }
  })
  res.json({ rows })
})

reports.get('/reports/shops', viewer, (req, res) => {
  const u = authOf(res)
  const [from, to] = range(req.query)
  const shop = scopeShop(u, req.query.shopId)
  const rows = all(
    `SELECT s.id, s.name, s.code, r.name AS region, COALESCE(w.balance,0) AS balance,
       COUNT(CASE WHEN t.status != 'CANCELLED' THEN 1 END) AS tickets,
       COALESCE(SUM(CASE WHEN t.status != 'CANCELLED' THEN t.total_stake END),0) AS turnover,
       COALESCE(SUM(CASE WHEN t.status IN ('WON','PAID') THEN t.actual_win END),0) AS winnings,
       COALESCE(SUM(CASE WHEN t.status IN ('WON','PAID','LOST','EXPIRED') THEN t.total_stake END),0) AS settled_stake,
       COALESCE(SUM(t.paid_amount),0) AS payouts
     FROM shops s JOIN regions r ON r.id = s.region_id LEFT JOIN wallets w ON w.shop_id = s.id
     LEFT JOIN tickets t ON t.shop_id = s.id AND t.created_at >= ? AND t.created_at < ?
     ${shop ? 'WHERE s.id = ?' : ''} GROUP BY s.id ORDER BY turnover DESC`,
    from, to, ...(shop ? [shop] : []),
  ).map((r) => ({ shopId: r.id, shop: r.name, code: r.code, region: r.region, tickets: r.tickets, turnover: r.turnover, payouts: r.payouts, ggr: r.settled_stake - r.winnings, averageStake: r.tickets ? Math.round(r.turnover / r.tickets) : 0, walletBalance: r.balance }))
  res.json({ rows })
})

// ─── Ledger ─────────────────────────────────────────────────────────────────
reports.get('/ledger', requirePerm('ledger.view'), (req, res) => {
  const u = authOf(res)
  const shop = scopeShop(u, req.query.shopId)
  const [from, to] = range(req.query)
  const where = ['f.created_at >= ?', 'f.created_at < ?']
  const params: unknown[] = [from, to]
  if (shop) { where.push('f.shop_id = ?'); params.push(shop) }
  if (req.query.type) { where.push('f.type = ?'); params.push(String(req.query.type)) }
  const rows = all(
    `SELECT f.*, s.name AS shop_name, us.full_name AS user_name,
       EXISTS (SELECT 1 FROM financial_transactions x WHERE x.reverses_id = f.id) AS reversed
     FROM financial_transactions f JOIN shops s ON s.id = f.shop_id LEFT JOIN users us ON us.id = f.user_id
     WHERE ${where.join(' AND ')} ORDER BY f.id DESC LIMIT 500`,
    ...params,
  ).map((f) => ({ id: f.id, ref: f.ref, shop: f.shop_name, shopId: f.shop_id, type: f.type, amount: f.amount, balanceAfter: f.balance_after, user: f.user_name, note: f.note, reversesId: f.reverses_id, reversed: !!f.reversed, createdAt: f.created_at }))
  const byType = all(`SELECT f.type, COUNT(*) AS n, SUM(f.amount) AS total FROM financial_transactions f WHERE ${where.join(' AND ')} GROUP BY f.type`, ...params)
  const balance = shop ? (get<{ balance: number }>('SELECT balance FROM wallets WHERE shop_id = ?', shop)?.balance ?? 0) : get<{ v: number }>('SELECT COALESCE(SUM(balance),0) AS v FROM wallets')!.v
  res.json({ rows, byType, balance })
})

reports.post('/ledger', requirePerm('ledger.record'), (req, res) => {
  const u = authOf(res)
  const b = req.body ?? {}
  const shop = scopeShop(u, b.shopId) ?? Number(b.shopId)
  const type = String(b.type)
  if (!['DEPOSIT', 'WITHDRAWAL', 'ADJUSTMENT'].includes(type)) throw new ApiError(400, 'BAD_INPUT', 'Type must be DEPOSIT, WITHDRAWAL or ADJUSTMENT')
  if (type === 'ADJUSTMENT' && u.role !== 'ADMIN') throw new ApiError(403, 'FORBIDDEN', 'Only administrators can post adjustments')
  const amount = Number(b.amount)
  if (!Number.isSafeInteger(amount) || amount === 0 || (type !== 'ADJUSTMENT' && amount < 0)) throw new ApiError(400, 'BAD_AMOUNT', 'Enter a valid amount')
  const note = String(b.note ?? '').trim()
  if (note.length < 3) throw new ApiError(400, 'NOTE_REQUIRED', 'A note explaining the entry is required')
  const out = tx(() => {
    if (!get('SELECT id FROM shops WHERE id = ?', shop)) throw new ApiError(404, 'NOT_FOUND', 'Shop not found')
    const t = postTxn({ shopId: shop, type: type as 'DEPOSIT', amount: type === 'WITHDRAWAL' ? -amount : amount, userId: u.id, note })
    audit('LEDGER_ENTRY', 'transaction', t.ref, { type, amount, note }, { ...ctxOf(req, res), shopId: shop })
    return t
  })
  res.status(201).json(out)
})

reports.post('/ledger/:id/reverse', requirePerm('*'), (req, res) => {
  const u = authOf(res)
  const note = String(req.body?.note ?? '').trim()
  if (note.length < 3) throw new ApiError(400, 'NOTE_REQUIRED', 'A reason is required to reverse a transaction')
  const out = tx(() => {
    const orig = get('SELECT * FROM financial_transactions WHERE id = ?', Number(req.params.id))
    if (!orig) throw new ApiError(404, 'NOT_FOUND', 'Transaction not found')
    if (!['DEPOSIT', 'WITHDRAWAL', 'ADJUSTMENT'].includes(orig.type)) throw new ApiError(409, 'NOT_REVERSIBLE', 'Only manual entries can be reversed here. Tickets are corrected through the ticket itself.')
    if (get('SELECT id FROM financial_transactions WHERE reverses_id = ?', orig.id)) throw new ApiError(409, 'ALREADY_REVERSED', 'This transaction was already reversed')
    const t = postTxn({ shopId: orig.shop_id, type: 'REVERSAL', amount: -orig.amount, userId: u.id, reversesId: orig.id, note: `Reversal of ${orig.ref}: ${note}` })
    audit('LEDGER_REVERSAL', 'transaction', t.ref, { reverses: orig.ref, note }, { ...ctxOf(req, res), shopId: orig.shop_id })
    return t
  })
  res.status(201).json(out)
})

// ─── Ticket history ─────────────────────────────────────────────────────────
reports.get('/tickets', requirePerm('tickets.view'), (req, res) => {
  const u = authOf(res)
  const shop = scopeShop(u, req.query.shopId)
  const [from, to] = range(req.query)
  const where = ['t.created_at >= ?', 't.created_at < ?']
  const params: unknown[] = [from, to]
  if (shop) { where.push('t.shop_id = ?'); params.push(shop) }
  if (req.query.status) { where.push('t.status = ?'); params.push(String(req.query.status)) }
  if (req.query.q) { where.push('t.ticket_number LIKE ?'); params.push(`%${String(req.query.q).trim().toUpperCase().replace(/[%_]/g, '')}%`) }
  const rows = all(
    `SELECT t.ticket_number, t.game_id, t.status, t.total_stake, t.actual_win, t.created_at, s.name AS shop, us.full_name AS cashier
     FROM tickets t JOIN shops s ON s.id = t.shop_id JOIN users us ON us.id = t.cashier_id WHERE ${where.join(' AND ')} ORDER BY t.id DESC LIMIT 300`,
    ...params,
  ).map((t) => ({ ticketNumber: t.ticket_number, gameId: t.game_id, status: t.status, stake: t.total_stake, winAmount: t.actual_win, createdAt: t.created_at, shop: t.shop, cashier: t.cashier }))
  res.json({ rows })
})

reports.get('/tickets/:number', requirePerm('tickets.view'), (req, res) => {
  const u = authOf(res)
  const t = get('SELECT t.*, s.name AS shop_name, us.full_name AS cashier_name FROM tickets t JOIN shops s ON s.id = t.shop_id JOIN users us ON us.id = t.cashier_id WHERE t.ticket_number = ?', String(req.params.number))
  if (!t || (u.role !== 'ADMIN' && t.shop_id !== u.shopId)) throw new ApiError(404, 'NOT_FOUND', 'Ticket not found')
  res.json({
    ticket: {
      ticketNumber: t.ticket_number, status: t.status, gameId: t.game_id, shop: t.shop_name, cashier: t.cashier_name, stake: t.total_stake, maxWin: t.max_win, winAmount: t.actual_win, createdAt: t.created_at,
      paidAt: t.paid_at, paidAmount: t.paid_amount, cancelledAt: t.cancelled_at, expiresAt: t.expires_at, printCount: t.print_count, ip: t.ip, deviceId: t.device_id, ageConfirmed: !!t.age_confirmed,
    },
    selections: all('SELECT * FROM ticket_selections WHERE ticket_id = ?', t.id).map((s) => ({ market: s.market_name, label: s.option_label, stake: s.stake, oddsX100: s.odds_x100, possibleWin: s.possible_win, isWin: s.is_win === null ? null : !!s.is_win, winAmount: s.win_amount })),
    transactions: all('SELECT ref, type, amount, created_at FROM financial_transactions WHERE ticket_id = ? ORDER BY id', t.id),
    audit: all('SELECT ts, action, actor_role, details FROM audit_logs WHERE entity = ? AND entity_id = ? ORDER BY id', 'ticket', t.ticket_number),
  })
})

// ─── Shifts (manager reconciliation) ────────────────────────────────────────
reports.get('/shifts', requirePerm('shifts.manage'), (req, res) => {
  const u = authOf(res)
  const shop = scopeShop(u, req.query.shopId)
  const [from, to] = range(req.query)
  const rows = all(
    `SELECT c.id, c.opened_at, c.closed_at, c.status, c.opening_float, c.counted_cash, c.expected_cash, c.difference, c.reconciled_at, c.reconcile_note, c.close_note, us.full_name, us.cashier_code, s.name AS shop_name
     FROM cashier_shifts c JOIN users us ON us.id = c.user_id JOIN shops s ON s.id = c.shop_id
     WHERE c.opened_at >= ? AND c.opened_at < ? ${shop ? 'AND c.shop_id = ?' : ''} ORDER BY c.opened_at DESC LIMIT 300`,
    from, to, ...(shop ? [shop] : []),
  ).map((c) => {
    const live = c.status === 'OPEN' ? shiftSummary(c.id) : null
    return { id: c.id, cashier: c.full_name, code: c.cashier_code, shop: c.shop_name, openedAt: c.opened_at, closedAt: c.closed_at, status: c.status, openingFloat: c.opening_float, expected: live?.expectedCash ?? c.expected_cash, counted: c.counted_cash, difference: c.difference, reconciledAt: c.reconciled_at, reconcileNote: c.reconcile_note, closeNote: c.close_note }
  })
  res.json({ rows })
})

reports.post('/shifts/:id/reconcile', requirePerm('shifts.manage'), (req, res) => {
  const u = authOf(res)
  const c = get('SELECT * FROM cashier_shifts WHERE id = ?', Number(req.params.id))
  if (!c || (u.role !== 'ADMIN' && c.shop_id !== u.shopId)) throw new ApiError(404, 'NOT_FOUND', 'Shift not found')
  if (c.status !== 'CLOSED') throw new ApiError(409, 'SHIFT_OPEN', 'The cashier must close the shift first')
  if (c.reconciled_at) throw new ApiError(409, 'ALREADY_RECONCILED', 'This shift was already reconciled')
  const note = String(req.body?.note ?? '').slice(0, 500)
  if (c.difference !== 0 && note.trim().length < 3) throw new ApiError(400, 'NOTE_REQUIRED', 'Explain the cash difference before reconciling')
  run('UPDATE cashier_shifts SET reconciled_by = ?, reconciled_at = ?, reconcile_note = ? WHERE id = ?', u.id, Date.now(), note, c.id)
  audit('SHIFT_RECONCILED', 'shift', c.id, { difference: c.difference, note }, { ...ctxOf(req, res), shopId: c.shop_id })
  res.json({ ok: true })
})

// ─── Audit log, alerts, integrity (administrators) ──────────────────────────
reports.get('/audit', requirePerm('*'), (req, res) => {
  const [from, to] = range(req.query)
  const where = ['a.ts >= ?', 'a.ts < ?']
  const params: unknown[] = [from, to]
  if (req.query.action) { where.push('a.action = ?'); params.push(String(req.query.action)) }
  if (req.query.entity) { where.push('a.entity = ?'); params.push(String(req.query.entity)) }
  if (req.query.q) { where.push('(a.entity_id LIKE ? OR a.details LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`) }
  const shop = num(req.query.shopId)
  if (shop) { where.push('a.shop_id = ?'); params.push(shop) }
  const rows = all(
    `SELECT a.id, a.ts, a.action, a.entity, a.entity_id, a.actor_role, a.ip, a.device_id, a.details, us.username, s.name AS shop
     FROM audit_logs a LEFT JOIN users us ON us.id = a.actor_id LEFT JOIN shops s ON s.id = a.shop_id WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT 500`,
    ...params,
  )
  res.json({ rows, actions: all('SELECT DISTINCT action FROM audit_logs ORDER BY action').map((r) => r.action) })
})
reports.get('/integrity', requirePerm('*'), (_req, res) => {
  res.json({ audit: verifyAuditChain(), ledger: verifyLedger() })
})
reports.get('/alerts', requirePerm('*'), (req, res) => {
  const status = String(req.query.status ?? '')
  const rows = all(
    `SELECT a.*, s.name AS shop, us.full_name AS user_name FROM alerts a LEFT JOIN shops s ON s.id = a.shop_id LEFT JOIN users us ON us.id = a.user_id
     ${status ? 'WHERE a.status = ?' : ''} ORDER BY a.id DESC LIMIT 300`,
    ...(status ? [status] : []),
  )
  res.json({ rows: rows.map((a) => ({ id: a.id, ts: a.ts, severity: a.severity, kind: a.kind, message: a.message, shop: a.shop, user: a.user_name, status: a.status, reviewedAt: a.reviewed_at, note: a.review_note })) })
})
reports.put('/alerts/:id', requirePerm('*'), (req, res) => {
  const status = String(req.body?.status)
  if (!['REVIEWED', 'REPORTED', 'DISMISSED', 'OPEN'].includes(status)) throw new ApiError(400, 'BAD_INPUT', 'Invalid status')
  const a = get('SELECT * FROM alerts WHERE id = ?', Number(req.params.id))
  if (!a) throw new ApiError(404, 'NOT_FOUND', 'Alert not found')
  run('UPDATE alerts SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?', status, authOf(res).id, Date.now(), String(req.body?.note ?? '').slice(0, 500), a.id)
  audit('ALERT_' + status, 'alert', a.id, { kind: a.kind }, ctxOf(req, res))
  res.json({ ok: true })
})
