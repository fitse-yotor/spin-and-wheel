import { Router } from 'express'
import { authOf, ctxOf, rateLimit, requirePerm } from '../auth.ts'
import { cfg } from '../config.ts'
import { all, get } from '../db.ts'
import { bookTicket, cancelTicket, cashierToday, closeShift, lookupTicket, outcomeOf, payTicket, posMarkets, reprintTicket, startShift } from '../tickets.ts'
import { todayRange } from '../util.ts'

export const pos = Router()
pos.use(requirePerm('pos.use'))

pos.get('/context', (_req, res) => {
  const u = authOf(res)
  const shop = get('SELECT id, code, name, address, phone, status FROM shops WHERE id = ?', u.shopId)
  const [from, to] = todayRange()
  const today = get<{ sales: number; tickets: number }>(
    "SELECT COALESCE(SUM(total_stake),0) AS sales, COUNT(*) AS tickets FROM tickets WHERE cashier_id = ? AND status != 'CANCELLED' AND created_at >= ? AND created_at < ?",
    u.id, from, to,
  )!
  const c = cfg()
  res.json({
    user: { id: u.id, fullName: u.fullName, cashierCode: u.cashierCode, payoutLimit: u.payoutLimit },
    shop,
    shift: cashierToday(u.id),
    today,
    limits: {
      minStake: c['limits.minStake'],
      maxSelectionStake: c['limits.maxSelectionStake'],
      maxTicketStake: c['limits.maxTicketStake'],
      maxPayout: c['limits.maxPayout'],
      maxSelections: c['limits.maxSelections'],
    },
    minAge: c['compliance.minAge'],
    notice: c['compliance.notice'],
    autoPrint: c['pos.autoPrint'],
    categoryColors: c['wheel.categoryColors'],
  })
})

pos.get('/markets', (req, res) => res.json(posMarkets(req.query.game === 'DOGS' ? 'DOGS' : 'WHEEL')))

pos.post('/shift/start', (req, res) => {
  res.json({ shift: startShift(authOf(res), Number(req.body?.openingFloat), ctxOf(req, res)) })
})
pos.post('/shift/close', (req, res) => {
  res.json({ shift: closeShift(authOf(res), { countedCash: Number(req.body?.countedCash), pin: req.body?.pin, note: req.body?.note }, ctxOf(req, res)) })
})

pos.post('/tickets', rateLimit('book', 120, 60_000, (_r, res) => String(authOf(res).id)), (req, res) => {
  const key = req.header('x-idempotency-key')
  const out = bookTicket(authOf(res), { game: req.body?.game === 'DOGS' ? 'DOGS' : 'WHEEL', selections: req.body?.selections, ageConfirmed: req.body?.ageConfirmed === true }, ctxOf(req, res), key && /^[\w-]{8,64}$/.test(key) ? key : undefined)
  res.status(out.replayed ? 200 : 201).json(out)
})

pos.post('/tickets/lookup', rateLimit('lookup', 120, 60_000, (_r, res) => String(authOf(res).id)), (req, res) => {
  res.json(lookupTicket(authOf(res), String(req.body?.query ?? ''), ctxOf(req, res)))
})
pos.post('/tickets/pay', rateLimit('pay', 30, 60_000, (_r, res) => String(authOf(res).id)), (req, res) => {
  const b = req.body ?? {}
  res.json(payTicket(authOf(res), { ticketNumber: b.ticketNumber, code: b.code, scan: b.scan, pin: b.pin, approverUsername: b.approverUsername, approverPin: b.approverPin }, ctxOf(req, res)))
})
pos.post('/tickets/cancel', (req, res) => {
  res.json(cancelTicket(authOf(res), { ticketNumber: req.body?.ticketNumber, pin: req.body?.pin, reason: req.body?.reason }, ctxOf(req, res)))
})
pos.post('/tickets/reprint', (req, res) => {
  res.json({ receipt: reprintTicket(authOf(res), { ticketNumber: req.body?.ticketNumber, pin: req.body?.pin }, ctxOf(req, res)) })
})

pos.get('/tickets/recent', (_req, res) => {
  const u = authOf(res)
  const [from, to] = todayRange()
  const rows = all('SELECT ticket_number, game_id, status, total_stake, actual_win, created_at FROM tickets WHERE cashier_id = ? AND created_at >= ? AND created_at < ? ORDER BY id DESC LIMIT 25', u.id, from, to)
  res.json({ tickets: rows.map((t) => ({ ticketNumber: t.ticket_number, gameId: t.game_id, status: t.status, outcome: outcomeOf(t.status), totalStake: t.total_stake, winAmount: t.actual_win, createdAt: t.created_at })) })
})
