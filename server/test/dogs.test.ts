import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

process.env.DB_PATH = ':memory:'

const { get, all, run } = await import('../db.ts')
const { seedIfEmpty } = await import('../seed.ts')
const game = await import('../game.ts')
const tickets = await import('../tickets.ts')
const { verifyLedger } = await import('../ledger.ts')
const { setConfig } = await import('../config.ts')
const { allRules, ruleWins } = await import('../../dog race/shared/rules.ts')
const { payoutFor } = await import('../util.ts')

const ctx = { ip: '127.0.0.1', deviceId: 'dog-test-device-1' }
const ETB = (n: number) => n * 100
let cashier: any
const asAuth = (row: any) => ({ id: row.id, username: row.username, fullName: row.full_name, role: row.role, shopId: row.shop_id, cashierCode: row.cashier_code, payoutLimit: 5_000_000_000, sessionId: 1 })

/** Push one game's whole timeline into the past so a single tick settles it (test-only clock control). */
function finish(gameId: number) {
  run('UPDATE games SET opens_at = opens_at - 300000, closes_at = closes_at - 300000, spin_at = spin_at - 300000, result_at = result_at - 300000, ends_at = ends_at - 300000 WHERE id = ?', gameId)
  game.tick(Date.now())
}

before(() => {
  seedIfEmpty()
  setConfig({ 'limits.maxSelections': 100 }, 1)
  cashier = asAuth(get('SELECT * FROM users WHERE username = ?', 'cashier.bole1'))
  game.tick()
  tickets.startShift(cashier, ETB(10_000), ctx)
})

describe('two games side by side', () => {
  it('runs a wheel round and a dog race round at the same time, each with its own numbering', () => {
    const w = game.currentGame('WHEEL')!
    const d = game.currentGame('DOGS')!
    assert.equal(w.game_type, 'WHEEL')
    assert.equal(d.game_type, 'DOGS')
    assert.ok(w.id < game.DOG_ID_BASE)
    assert.equal(d.id, game.DOG_ID_BASE + 1)
    assert.equal(w.status, 'BETTING_OPEN')
    assert.equal(d.status, 'BETTING_OPEN')
  })

  it('publishes strengths and odds when the round opens, and shows both games in the public state', () => {
    const st = game.buildState(Date.now(), false)
    const race = st.games.DOGS.game!.race!
    assert.equal(race.dogs.length, 6)
    assert.ok(race.dogs.every((x: any) => x.weight >= 10 && x.weight <= 40 && x.winOdds >= 1.01))
    assert.ok(st.games.WHEEL.game!.wheel.length === 37)
    assert.equal(st.games.DOGS.game!.wheel.length, 0)
  })

  it('hides the finishing order from terminals until it is on screen, but lets the display animate it', () => {
    const d = game.currentGame('DOGS')!
    run('UPDATE games SET closes_at = ? WHERE id = ?', Date.now() - 1000, d.id)
    game.tick()
    const now = Date.now()
    assert.deepEqual(game.buildState(now, true).games.DOGS.game!.result!.order!.length, 6)
    assert.equal(game.buildState(now, false).games.DOGS.game!.result, null)
    finish(d.id) // settle and start the next race; leaves a clean state for the next tests
  })
})

describe('dog race booking', () => {
  it('lists every bet with the round\'s fixed odds', () => {
    const m: any = tickets.posMarkets('DOGS')
    const options = m.markets.flatMap((x: any) => x.options)
    assert.equal(options.length, 57)
    assert.deepEqual(m.markets.map((x: any) => x.code), ['WIN', 'PLACE', 'FC', 'QN'])
    const snap = JSON.parse(game.currentGame('DOGS')!.wheel_snapshot)
    for (const o of options) assert.equal(o.oddsX100, snap.odds[o.code])
  })

  it('books a ticket, computes the true worst case and records the ledger sale', () => {
    const snap = JSON.parse(game.currentGame('DOGS')!.wheel_snapshot)
    const before = get<{ balance: number }>('SELECT balance FROM wallets WHERE shop_id = ?', cashier.shopId)!.balance
    const { receipt } = tickets.bookTicket(cashier, { game: 'DOGS', ageConfirmed: true, selections: [{ code: 'WIN:1', stake: ETB(50) }, { code: 'PLACE:1', stake: ETB(20) }, { code: 'FC:1-2', stake: ETB(10) }] }, ctx)
    assert.equal(receipt.gameType, 'DOGS')
    assert.equal(receipt.gameName, 'DOG RACE')
    assert.equal(receipt.totalStake, ETB(80))
    // All three win together when 1 then 2 finish first, so that order is the worst case
    const expect = payoutFor(ETB(50), snap.odds['WIN:1']) + payoutFor(ETB(20), snap.odds['PLACE:1']) + payoutFor(ETB(10), snap.odds['FC:1-2'])
    assert.equal(receipt.maxWin, expect)
    assert.equal(get<{ balance: number }>('SELECT balance FROM wallets WHERE shop_id = ?', cashier.shopId)!.balance, before + ETB(80))
    assert.ok(all('SELECT rule FROM ticket_selections WHERE ticket_id = (SELECT id FROM tickets WHERE ticket_number = ?)', receipt.ticketNumber).every((r: any) => r.rule))
    assert.ok(verifyLedger().ok)
  })

  it('rejects malformed, impossible and repeated bets without leaving partial records', () => {
    const t0 = get<{ n: number }>('SELECT COUNT(*) AS n FROM tickets')!.n
    const bad = (selections: any[], code: string) => assert.throws(() => tickets.bookTicket(cashier, { game: 'DOGS', ageConfirmed: true, selections }, ctx), (e: any) => e.code === code)
    bad([{ code: 'WIN:9', stake: ETB(20) }], 'OPTION_UNAVAILABLE')
    bad([{ code: 'FC:3-3', stake: ETB(20) }], 'OPTION_UNAVAILABLE')
    bad([{ code: 'QN:5-3', stake: ETB(20) }], 'OPTION_UNAVAILABLE')
    bad([{ optionId: 1, stake: ETB(20) }], 'OPTION_UNAVAILABLE') // a wheel bet cannot go on a race ticket
    bad([{ code: 'WIN:1', stake: ETB(20) }, { code: 'WIN:1', stake: ETB(20) }], 'DUPLICATE_SELECTION')
    bad([{ code: 'WIN:1', stake: ETB(5) }], 'STAKE_TOO_LOW')
    assert.equal(get<{ n: number }>('SELECT COUNT(*) AS n FROM tickets')!.n, t0)
  })

  it('a wheel option id and a race code cannot be mixed up across games', () => {
    assert.throws(() => tickets.bookTicket(cashier, { game: 'WHEEL', ageConfirmed: true, selections: [{ code: 'WIN:1', stake: ETB(20) }] as any }, ctx), (e: any) => e.code === 'BAD_SELECTION')
  })

  it('closes on the server clock for the race too', () => {
    const d = game.currentGame('DOGS')!
    run('UPDATE games SET closes_at = ? WHERE id = ?', Date.now() - 1, d.id)
    assert.throws(() => tickets.bookTicket(cashier, { game: 'DOGS', ageConfirmed: true, selections: [{ code: 'WIN:1', stake: ETB(20) }] }, ctx), (e: any) => e.code === 'BETTING_CLOSED')
    run('UPDATE games SET closes_at = ? WHERE id = ?', Date.now() + 30_000, d.id)
  })
})

describe('dog race settlement', () => {
  it('pays every bet type exactly per the finishing order, pays once, and is verifiable', () => {
    const d = game.currentGame('DOGS')!
    const snap = JSON.parse(d.wheel_snapshot)
    // Bet on all 57 possible outcomes at 10 ETB: whatever happens, several of these bets win.
    const rules = allRules()
    const { receipt } = tickets.bookTicket(cashier, { game: 'DOGS', ageConfirmed: true, selections: rules.map((code) => ({ code, stake: ETB(10) })) }, ctx)
    assert.equal(receipt.selections.length, 57)

    finish(d.id)
    const order = JSON.parse(get<{ result_json: string }>('SELECT result_json FROM game_results WHERE game_id = ?', d.id)!.result_json) as number[]
    assert.deepEqual([...order].sort(), [1, 2, 3, 4, 5, 6])

    const expected = rules.filter((r) => ruleWins(r, order)).reduce((a, r) => a + payoutFor(ETB(10), snap.odds[r]), 0)
    // 1 win + 3 place + 1 forecast + 1 quinella = 6 winning bets in every race
    assert.equal(rules.filter((r) => ruleWins(r, order)).length, 6)
    const seen: any = tickets.lookupTicket(cashier, receipt.ticketNumber, ctx)
    assert.equal(seen.outcome, 'WON')
    assert.equal(seen.winAmount, expected)
    assert.equal(seen.gameType, 'DOGS')
    assert.deepEqual(seen.result.order, order)

    const balance = () => get<{ balance: number }>('SELECT balance FROM wallets WHERE shop_id = ?', cashier.shopId)!.balance
    const before = balance()
    const paid = tickets.payTicket(cashier, { ticketNumber: receipt.ticketNumber, code: receipt.verifyCode, pin: '1111' }, ctx)
    assert.equal(paid.amount, expected)
    assert.equal(balance(), before - expected)
    assert.throws(() => tickets.payTicket(cashier, { ticketNumber: receipt.ticketNumber, code: receipt.verifyCode, pin: '1111' }, ctx), (e: any) => e.code === 'ALREADY_PAID')
    assert.ok(verifyLedger().ok)

    const v: any = game.verifyGame(d.id)
    assert.equal(v.gameType, 'DOGS')
    assert.deepEqual(v.finishingOrder, order)
    assert.deepEqual(v.checks, { commitmentMatchesSeedAndStrengths: true, resultReproducible: true, hashMatches: true })
  })

  it('the wheel keeps working alongside: its round is untouched by the race settling', () => {
    assert.equal(game.currentGame('WHEEL')!.status, 'BETTING_OPEN')
    assert.ok(game.currentGame('DOGS')!.id > game.DOG_ID_BASE + 1)
    const { receipt } = tickets.bookTicket(cashier, { game: 'WHEEL', ageConfirmed: true, selections: [{ optionId: get<{ id: number }>('SELECT id FROM bet_options WHERE code = ?', 'N7')!.id, stake: ETB(20) }] }, ctx)
    assert.equal(receipt.gameType, 'WHEEL')
    assert.ok(receipt.gameId < game.DOG_ID_BASE)
  })

  it('each game can be paused on its own', () => {
    setConfig({ 'dog.paused': true }, 1)
    const d = game.currentGame('DOGS')!
    finish(d.id)
    assert.equal(game.currentGame('DOGS'), undefined, 'no new race while paused')
    assert.ok(game.currentGame('WHEEL'), 'the wheel keeps running')
    setConfig({ 'dog.paused': false }, 1)
    game.tick()
    assert.ok(game.currentGame('DOGS'))
  })
})
