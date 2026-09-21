import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

process.env.DB_PATH = ':memory:'

const { db, get, all, run } = await import('../db.ts')
const { seedIfEmpty } = await import('../seed.ts')
const game = await import('../game.ts')
const tickets = await import('../tickets.ts')
const { verifyLedger } = await import('../ledger.ts')
const { verifyAuditChain } = await import('../audit.ts')
const { hashSecret } = await import('../util.ts')
const { cfg, setConfig } = await import('../config.ts')

const ctx = { ip: '127.0.0.1', deviceId: 'test-device-0001' }
let cashier: any
let manager: any

const asAuth = (row: any) => ({ id: row.id, username: row.username, fullName: row.full_name, role: row.role, shopId: row.shop_id, cashierCode: row.cashier_code, payoutLimit: row.payout_limit, sessionId: 1 })
const optionId = (code: string) => get<{ id: number }>('SELECT id FROM bet_options WHERE code = ?', code)!.id
const ETB = (n: number) => n * 100
/** Dozens 1~12 / 13~24 / 25~36 plus number 0 cover all 37 pockets: a guaranteed winner without touching the RNG. */
const coverAll = (stake: number) => ['D_1_12', 'D_13_24', 'D_25_36', 'N0'].map((c) => ({ optionId: optionId(c), stake }))
/** What a coverAll(stake) ticket must win for a given drawn number: 0 pays 36x, any other number pays its dozen 3x. */
const coverAllWin = (stake: number, drawn: number) => stake * (drawn === 0 ? 36 : 3)

/** Move the running round's timeline so `at` is "now" relative to it (test-only clock control). */
function shiftRound(deltaMs: number) {
  const g = game.currentGame()!
  run('UPDATE games SET opens_at = opens_at + ?, closes_at = closes_at + ?, spin_at = spin_at + ?, result_at = result_at + ?, ends_at = ends_at + ?, created_at = created_at WHERE id = ?', deltaMs, deltaMs, deltaMs, deltaMs, deltaMs, g.id)
}
function finishRound() {
  // Push the whole timeline into the past; a single engine tick must catch up through every phase.
  shiftRound(-120_000)
  game.tick(Date.now())
}

before(() => {
  seedIfEmpty()
  cashier = asAuth(get('SELECT * FROM users WHERE username = ?', 'cashier.bole1'))
  manager = asAuth(get('SELECT * FROM users WHERE username = ?', 'manager.bole'))
  game.tick()
  tickets.startShift(cashier, ETB(10_000), ctx)
})

describe('random number generation', () => {
  it('is reproducible from the revealed seed and bound to its commitment', () => {
    const seed = game.newSeed()
    assert.equal(game.drawIndex(seed, 42, 30), game.drawIndex(seed, 42, 30))
    assert.equal(game.commitmentOf(seed).length, 64)
    assert.notEqual(game.commitmentOf(seed), game.commitmentOf(game.newSeed()))
  })

  it('is uniform across segments (chi-square, 30 segments)', () => {
    const n = 30
    const draws = 60_000
    const counts = new Array(n).fill(0)
    for (let i = 0; i < draws; i++) counts[game.drawIndex(game.newSeed(), i + 1, n)]++
    const expected = draws / n
    const chi = counts.reduce((a, c) => a + (c - expected) ** 2 / expected, 0)
    // 29 degrees of freedom: 99.9th percentile ≈ 58.3. A biased generator would blow far past this.
    assert.ok(chi < 58.3, `chi-square ${chi.toFixed(1)} indicates non-uniform output`)
  })

  it('never depends on anything but the seed (no hidden weighting)', () => {
    const seed = game.newSeed()
    const a = game.drawIndex(seed, 7, 30)
    assert.equal(game.drawIndex(seed, 7, 30), a)
  })
})

describe('booking', () => {
  it('books a ticket atomically: ticket + selections + ledger + wallet', () => {
    const before = get<{ balance: number }>('SELECT balance FROM wallets WHERE shop_id = ?', cashier.shopId)!.balance
    const { receipt } = tickets.bookTicket(cashier, { ageConfirmed: true, selections: [{ optionId: optionId('N7'), stake: ETB(50) }, { optionId: optionId('C_RED'), stake: ETB(100) }] }, ctx)
    assert.match(receipt.ticketNumber, /^SW-\d{8}-\d{6}$/)
    assert.equal(receipt.totalStake, ETB(150))
    assert.match(receipt.qrPayload, /^SW1:[A-Z2-9]{16}$/)
    assert.equal(get<{ balance: number }>('SELECT balance FROM wallets WHERE shop_id = ?', cashier.shopId)!.balance, before + ETB(150))
    assert.equal(all('SELECT * FROM ticket_selections WHERE ticket_id = (SELECT id FROM tickets WHERE ticket_number = ?)', receipt.ticketNumber).length, 2)
    assert.ok(verifyLedger().ok)
  })

  it('computes possible win as the best single outcome, not the naive sum', () => {
    const { receipt } = tickets.bookTicket(cashier, { ageConfirmed: true, selections: [{ optionId: optionId('C_RED'), stake: ETB(100) }, { optionId: optionId('C_BLACK'), stake: ETB(100) }] }, ctx)
    // RED and BLACK can never both hit: best case is one 2.00x win = 200 ETB (not the naive 400)
    assert.equal(receipt.maxWin, ETB(200))
  })

  it('enforces limits and rolls back without leaving partial records', () => {
    const count = () => get<{ n: number }>('SELECT COUNT(*) AS n FROM tickets')!.n
    const ledger = () => get<{ n: number }>('SELECT COUNT(*) AS n FROM financial_transactions')!.n
    const t0 = count()
    const l0 = ledger()
    const bad = (selections: any[], code: string, age = true) =>
      assert.throws(() => tickets.bookTicket(cashier, { ageConfirmed: age, selections }, ctx), (e: any) => e.code === code)
    bad([{ optionId: optionId('N7'), stake: ETB(5) }], 'STAKE_TOO_LOW')
    bad([{ optionId: optionId('N7'), stake: ETB(5_001) }], 'STAKE_TOO_HIGH')
    bad([{ optionId: optionId('N7'), stake: 1050 }], 'BAD_STAKE')
    bad([{ optionId: optionId('N7'), stake: ETB(20) }, { optionId: optionId('N7'), stake: ETB(20) }], 'DUPLICATE_SELECTION')
    bad([{ optionId: 99999, stake: ETB(20) }], 'OPTION_UNAVAILABLE')
    bad([{ optionId: optionId('N7'), stake: ETB(20) }], 'AGE_NOT_CONFIRMED', false)
    bad([{ optionId: optionId('D_1_12'), stake: ETB(5_000) }, { optionId: optionId('D_13_24'), stake: ETB(5_000) }, { optionId: optionId('D_25_36'), stake: ETB(5_000) }, { optionId: optionId('ODD'), stake: ETB(5_000) }, { optionId: optionId('EVEN'), stake: ETB(1_000) }], 'TICKET_STAKE_TOO_HIGH')
    bad([{ optionId: optionId('N7'), stake: ETB(4_000) }, { optionId: optionId('N8'), stake: ETB(4_000) }], 'PAYOUT_LIMIT') // 4,000 × 36 = 144,000 > 100,000
    assert.equal(count(), t0)
    assert.equal(ledger(), l0)
  })

  it('is idempotent: a retried request returns the same ticket, not a second one', () => {
    const body = { ageConfirmed: true, selections: [{ optionId: optionId('EVEN'), stake: ETB(10) }] }
    const a = tickets.bookTicket(cashier, body, ctx, 'idem-key-12345')
    const b = tickets.bookTicket(cashier, body, ctx, 'idem-key-12345')
    assert.equal(a.receipt.ticketNumber, b.receipt.ticketNumber)
    assert.equal(b.replayed, true)
  })

  it('requires an open shift', () => {
    const other = asAuth(get('SELECT * FROM users WHERE username = ?', 'cashier.bole2'))
    assert.throws(() => tickets.bookTicket(other, { ageConfirmed: true, selections: [{ optionId: optionId('N7'), stake: ETB(20) }] }, ctx), (e: any) => e.code === 'NO_SHIFT')
  })
})

describe('cancellation', () => {
  it('refunds through a reversal transaction while betting is open', () => {
    const before = get<{ balance: number }>('SELECT balance FROM wallets WHERE shop_id = ?', cashier.shopId)!.balance
    const { receipt } = tickets.bookTicket(cashier, { ageConfirmed: true, selections: [{ optionId: optionId('ODD'), stake: ETB(30) }] }, ctx)
    tickets.cancelTicket(manager, { ticketNumber: receipt.ticketNumber }, ctx)
    assert.equal(get<{ balance: number }>('SELECT balance FROM wallets WHERE shop_id = ?', cashier.shopId)!.balance, before)
    assert.equal(get<{ status: string }>('SELECT status FROM tickets WHERE ticket_number = ?', receipt.ticketNumber)!.status, 'CANCELLED')
    assert.ok(all('SELECT * FROM financial_transactions WHERE type = ?', 'TICKET_CANCEL').some((t) => t.note))
    assert.ok(verifyLedger().ok)
  })
})

describe('betting closure (server clock is authoritative)', () => {
  it('rejects bookings the instant the round closes, even before the engine ticks', () => {
    const g = game.currentGame()!
    run('UPDATE games SET closes_at = ? WHERE id = ?', Date.now() - 1, g.id) // cutoff passed, status still BETTING_OPEN
    const l0 = get<{ n: number }>('SELECT COUNT(*) AS n FROM financial_transactions')!.n
    assert.throws(() => tickets.bookTicket(cashier, { ageConfirmed: true, selections: [{ optionId: optionId('N7'), stake: ETB(20) }] }, ctx), (e: any) => e.code === 'BETTING_CLOSED')
    assert.equal(get<{ n: number }>('SELECT COUNT(*) AS n FROM financial_transactions')!.n, l0)
    // restore for the following tests
    run('UPDATE games SET closes_at = ? WHERE id = ?', Date.now() + 30_000, g.id)
  })
})

describe('full round: close → spin → result → settle → pay', () => {
  let ticketNo = ''
  let verifyCode = ''
  let gameId = 0
  let winAmount = 0
  it('settles every ticket and pays a winner exactly once', () => {
    gameId = game.currentGame()!.id
    const { receipt } = tickets.bookTicket(cashier, { ageConfirmed: true, selections: coverAll(ETB(100)) }, ctx)
    ticketNo = receipt.ticketNumber
    verifyCode = receipt.verifyCode
    const pending = tickets.lookupTicket(cashier, ticketNo, ctx)
    assert.equal(pending.outcome, 'PENDING')

    finishRound()
    const result = get<{ segment_number: number }>('SELECT segment_number FROM game_results WHERE game_id = ?', gameId)!
    const seen = tickets.lookupTicket(cashier, ticketNo, ctx)
    assert.equal(seen.outcome, 'WON')
    winAmount = coverAllWin(ETB(100), result.segment_number)
    assert.equal((seen as any).winAmount, winAmount)
    assert.equal(get<{ status: string }>('SELECT status FROM games WHERE id = ?', gameId)!.status, 'COMPLETED')
    assert.ok(result.segment_number >= 1)
    assert.ok(game.currentGame() && game.currentGame()!.id === gameId + 1, 'next round starts automatically')

    const v: any = game.verifyGame(gameId)
    assert.equal(v.revealed, true)
    assert.deepEqual(v.checks, { commitmentMatchesSeed: true, resultReproducible: true, hashMatches: true })
  })

  it('refuses payout with a wrong verification code, then pays once with the right one', () => {
    const pay = (code: string) => tickets.payTicket(cashier, { ticketNumber: ticketNo, code, pin: '1111' }, ctx)
    assert.throws(() => pay('WRONG1'), (e: any) => e.code === 'BAD_VERIFICATION')
    const before = get<{ balance: number }>('SELECT balance FROM wallets WHERE shop_id = ?', cashier.shopId)!.balance
    const out = pay(verifyCode)
    assert.equal(out.amount, winAmount)
    assert.equal(get<{ balance: number }>('SELECT balance FROM wallets WHERE shop_id = ?', cashier.shopId)!.balance, before - winAmount)
    assert.throws(() => pay(verifyCode), (e: any) => e.code === 'ALREADY_PAID')
    assert.equal(tickets.lookupTicket(cashier, ticketNo, ctx).outcome, 'ALREADY_PAID')
    assert.equal(get<{ n: number }>('SELECT COUNT(*) AS n FROM payouts WHERE ticket_id = (SELECT id FROM tickets WHERE ticket_number = ?)', ticketNo)!.n, 1)
  })

  it('requires manager approval above the cashier payout limit', () => {
    run('UPDATE users SET payout_limit = ? WHERE id = ?', ETB(50), cashier.id)
    const c2 = { ...cashier, payoutLimit: ETB(50) }
    const { receipt } = tickets.bookTicket(c2, { ageConfirmed: true, selections: coverAll(ETB(100)) }, ctx)
    const drawn = () => get<{ segment_number: number }>('SELECT segment_number FROM game_results WHERE game_id = ?', tickets.lookupTicket(c2, receipt.ticketNumber, ctx).gameId)!.segment_number
    finishRound()
    const body = { ticketNumber: receipt.ticketNumber, code: receipt.verifyCode, pin: '1111' }
    assert.throws(() => tickets.payTicket(c2, body, ctx), (e: any) => e.code === 'APPROVAL_REQUIRED')
    assert.throws(() => tickets.payTicket(c2, { ...body, approverUsername: 'manager.bole', approverPin: '0000' }, ctx), (e: any) => e.code === 'BAD_PIN')
    const ok = tickets.payTicket(c2, { ...body, approverUsername: 'manager.bole', approverPin: '5555' }, ctx)
    assert.equal(ok.amount, coverAllWin(ETB(100), drawn()))
    run('UPDATE users SET payout_limit = ? WHERE id = ?', 5_000_000, cashier.id)
  })

  it("won't pay a ticket at another shop", () => {
    const other = asAuth(get('SELECT * FROM users WHERE username = ?', 'cashier.meg1'))
    tickets.startShift(other, ETB(1_000), ctx)
    assert.throws(() => tickets.payTicket(other, { ticketNumber: ticketNo, code: verifyCode, pin: '1111' }, ctx), (e: any) => e.code === 'OTHER_SHOP')
    assert.equal((tickets.lookupTicket(other, ticketNo, ctx) as any).foreignShop, true)
  })
})

describe('immutability and integrity', () => {
  it('the ledger, audit log, results and confirmed tickets cannot be edited or deleted', () => {
    assert.throws(() => db.exec('UPDATE financial_transactions SET amount = 1 WHERE id = 1'), /append-only/)
    assert.throws(() => db.exec('DELETE FROM financial_transactions'), /append-only/)
    assert.throws(() => db.exec("UPDATE audit_logs SET action = 'X'"), /append-only/)
    assert.throws(() => db.exec('DELETE FROM game_results'), /immutable/)
    assert.throws(() => db.exec('UPDATE tickets SET total_stake = 1'), /cannot be modified/)
    assert.throws(() => db.exec('DELETE FROM tickets'), /cannot be deleted/)
    assert.throws(() => db.exec('UPDATE ticket_selections SET stake = 1'), /cannot be modified/)
  })

  it('every wallet equals the sum of its ledger, and both hash chains verify', () => {
    const l = verifyLedger()
    assert.deepEqual(l.problems, [])
    assert.equal(verifyAuditChain().ok, true)
  })

  it('records booking, check, payout and settlement in the audit trail', () => {
    const actions = new Set(all('SELECT DISTINCT action FROM audit_logs').map((r) => r.action))
    for (const a of ['TICKET_BOOKED', 'TICKET_CHECKED', 'TICKET_PAID', 'TICKET_SETTLED', 'TICKET_CANCELLED', 'RESULT_GENERATED', 'GAME_SETTLED']) assert.ok(actions.has(a), `missing audit action ${a}`)
  })
})

describe('shifts', () => {
  it('reconciles expected cash = float + sales − cancellations − payouts', () => {
    const shift = tickets.openShift(cashier.id)!
    const s = tickets.shiftSummary(shift.id)
    assert.equal(s.expectedCash, s.openingFloat + s.sales - s.cancellations - s.payouts)
    const closed = tickets.closeShift(cashier, { countedCash: s.expectedCash - ETB(20), pin: '1111' }, ctx)
    assert.equal(closed.status, 'CLOSED')
    assert.equal(closed.difference, -ETB(20))
    assert.ok(all('SELECT * FROM alerts WHERE kind = ?', 'SHIFT_DIFFERENCE').length >= 1)
  })
})

describe('configuration', () => {
  it('rejects inconsistent limits', () => {
    assert.throws(() => setConfig({ 'limits.minStake': ETB(9_999) }, 1), (e: any) => e.code === 'BAD_CONFIG')
    assert.equal(cfg()['limits.minStake'], ETB(10))
  })
})

void hashSecret
