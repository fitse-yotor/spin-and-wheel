import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { createServer, type Server } from 'node:http'

process.env.DB_PATH = ':memory:'
process.env.TRUST_PROXY = '1' // lets each test pose as a different client IP for the rate limiter

const { get, run } = await import('../db.ts')
const { seedIfEmpty } = await import('../seed.ts')
const { tick, buildState, currentGame } = await import('../game.ts')
const { createApp } = await import('../index.ts')

let server: Server
let base = ''

async function call(path: string, opts: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {}) {
  const r = await fetch(base + path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', 'x-device-id': 'api-test-device-1', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...opts.headers },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const text = await r.text()
  return { status: r.status, json: text ? JSON.parse(text) : null }
}
let ipSeq = 0
const login = async (username: string, password: string, ip = `10.0.0.${++ipSeq}`) => call('/api/auth/login', { body: { username, password }, headers: { 'x-forwarded-for': ip } })

before(async () => {
  seedIfEmpty()
  tick()
  server = createServer(createApp())
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => server.close())

describe('authentication', () => {
  it('rejects unauthenticated requests', async () => {
    assert.equal((await call('/api/pos/context')).status, 401)
    assert.equal((await call('/api/dashboard')).status, 401)
  })

  it('signs in with valid credentials and returns tokens, never password hashes', async () => {
    const r = await login('cashier.bole1', 'cashier1234')
    assert.equal(r.status, 200)
    assert.ok(r.json.accessToken && r.json.refreshToken)
    assert.equal(JSON.stringify(r.json).includes('hash'), false)
  })

  it('locks the account after 5 wrong passwords and raises an alert', async () => {
    for (let i = 0; i < 5; i++) assert.equal((await login('cashier.meg2', 'wrong-password')).status, 401)
    const locked = await login('cashier.meg2', 'cashier1234')
    assert.equal(locked.status, 423)
    assert.ok(get('SELECT id FROM alerts WHERE kind = ?', 'REPEATED_FAILED_LOGIN'))
  })

  it('rate-limits sign-in attempts from one address', async () => {
    const codes: number[] = []
    for (let i = 0; i < 12; i++) codes.push((await login('nobody', 'nope', '203.0.113.9')).status)
    assert.equal(codes[0], 401)
    assert.equal(codes.at(-1), 429)
  })

  it('rotates refresh tokens: an old one stops working', async () => {
    const a = await login('cashier.bole2', 'cashier1234')
    const b = await call('/api/auth/refresh', { body: { refreshToken: a.json.refreshToken } })
    assert.equal(b.status, 200)
    assert.equal((await call('/api/auth/refresh', { body: { refreshToken: a.json.refreshToken } })).status, 401)
  })
})

describe('role-based access', () => {
  let cashier = ''
  let manager = ''
  let admin = ''
  before(async () => {
    cashier = (await login('cashier.bole1', 'cashier1234')).json.accessToken
    manager = (await login('manager.bole', 'manager1234')).json.accessToken
    admin = (await login('admin', 'admin1234')).json.accessToken
  })

  it('cashiers cannot reach admin, reporting or configuration endpoints', async () => {
    for (const p of ['/api/dashboard', '/api/users', '/api/shops', '/api/ledger', '/api/config', '/api/audit', '/api/reports/sales', '/api/wheel', '/api/markets']) {
      assert.equal((await call(p, { token: cashier })).status, 403, p)
    }
    assert.equal((await call('/api/config', { method: 'PUT', body: { 'limits.maxPayout': 1 }, token: cashier })).status, 403)
  })

  it('managers cannot use the POS, change config, or read another shop', async () => {
    assert.equal((await call('/api/pos/context', { token: manager })).status, 403)
    assert.equal((await call('/api/config', { method: 'PUT', body: {}, token: manager })).status, 403)
    assert.equal((await call('/api/ledger?shopId=2', { token: manager })).status, 403)
    assert.equal((await call('/api/reports/sales?shopId=2', { token: manager })).status, 403)
    assert.equal((await call('/api/ledger', { body: { shopId: 1, type: 'ADJUSTMENT', amount: 100, note: 'nope' }, token: manager })).status, 403)
    assert.equal((await call('/api/wheel/segments/1', { method: 'PUT', body: { active: false }, token: manager })).status, 403)
  })

  it("managers see only their own shop's data", async () => {
    const shops = await call('/api/shops', { token: manager })
    assert.equal(shops.json.shops.length, 1)
    assert.equal(shops.json.shops[0].code, 'BOLE01')
    const users = await call('/api/users', { token: manager })
    assert.ok(users.json.users.every((u: any) => u.shopId === 1 && u.role === 'CASHIER'))
  })

  it('a manager can top up their own shop float, and it lands in the immutable ledger', async () => {
    const r = await call('/api/ledger', { body: { shopId: 1, type: 'DEPOSIT', amount: 100_000, note: 'Float top-up from head office' }, token: manager })
    assert.equal(r.status, 201)
    const l = await call('/api/ledger?shopId=1&type=DEPOSIT', { token: manager })
    assert.equal(l.json.rows[0].amount, 100_000)
  })

  it('reversing a ledger entry posts an opposite entry and cannot be repeated', async () => {
    const l = await call('/api/ledger?shopId=1&type=DEPOSIT', { token: admin })
    const id = l.json.rows[0].id
    assert.equal((await call(`/api/ledger/${id}/reverse`, { body: { note: 'entered twice' }, token: admin })).status, 201)
    assert.equal((await call(`/api/ledger/${id}/reverse`, { body: { note: 'again' }, token: admin })).status, 409)
    assert.equal((await call(`/api/ledger/${id}/reverse`, { body: { note: 'x' }, token: manager })).status, 403)
  })

  it('admin can read everything, and an integrity check passes', async () => {
    assert.equal((await call('/api/dashboard', { token: admin })).status, 200)
    const i = await call('/api/integrity', { token: admin })
    assert.equal(i.json.audit.ok, true)
    assert.equal(i.json.ledger.ok, true)
  })
})

describe('sessions', () => {
  it('background polling does not extend the inactivity timeout, real actions do', async () => {
    const t = (await login('cashier.piassa1', 'cashier1234')).json.accessToken
    const sid = get<{ id: number }>('SELECT s.id FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.username = ? ORDER BY s.id DESC LIMIT 1', 'cashier.piassa1')!.id
    const lastSeen = () => get<{ last_seen: number }>('SELECT last_seen FROM sessions WHERE id = ?', sid)!.last_seen
    const twentyMinAgo = Date.now() - 20 * 60_000
    run('UPDATE sessions SET last_seen = ? WHERE id = ?', twentyMinAgo, sid)
    assert.equal((await call('/api/pos/context', { token: t, headers: { 'x-background': '1' } })).status, 200)
    assert.equal(lastSeen(), twentyMinAgo, 'polling must leave last_seen alone')
    assert.equal((await call('/api/pos/context', { token: t })).status, 200)
    assert.ok(lastSeen() > twentyMinAgo, 'a deliberate request refreshes it')
  })

  it('expires idle sessions for both access and refresh', async () => {
    const a = await login('cashier.bole1', 'cashier1234')
    const sid = get<{ id: number }>('SELECT s.id FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.username = ? ORDER BY s.id DESC LIMIT 1', 'cashier.bole1')!.id
    run('UPDATE sessions SET last_seen = ? WHERE id = ?', Date.now() - 31 * 60_000, sid)
    const r = await call('/api/pos/context', { token: a.json.accessToken })
    assert.equal(r.status, 401)
    assert.equal(r.json.error.code, 'SESSION_EXPIRED')
    assert.equal((await call('/api/auth/refresh', { body: { refreshToken: a.json.refreshToken } })).status, 401)
  })

  it('signing out revokes the session', async () => {
    const a = await login('cashier.bole2', 'cashier1234')
    assert.equal((await call('/api/auth/logout', { body: {}, token: a.json.accessToken })).status, 200)
    assert.equal((await call('/api/pos/context', { token: a.json.accessToken })).status, 401)
  })
})

describe('result secrecy', () => {
  it('only displays learn the result before it is on screen; terminals and the public never do', () => {
    const g = currentGame('WHEEL')!
    run('UPDATE games SET closes_at = ? WHERE id = ?', Date.now() - 1000, g.id)
    tick()
    const now = Date.now()
    const display = buildState(now, true)
    const others = buildState(now, false)
    const dw = display.games.WHEEL
    assert.equal(dw.game!.phase, 'BETTING_CLOSED')
    assert.ok(dw.game!.result, 'display feed carries the final result once betting is closed')
    assert.equal(others.games.WHEEL.game!.result, null, 'POS/public feed must not')
    const pub = JSON.stringify(others)
    assert.equal(pub.includes(String(dw.game!.result!.resultHash)), false)
    assert.equal(pub.includes('"seed"'), false, 'the seed is never exposed before settlement')
  })

  it('the seed stays hidden until the round is settled', async () => {
    const id = currentGame('WHEEL')!.id
    const v = await call(`/api/public/games/${id}/verify`)
    assert.equal(v.json.revealed, false)
    assert.equal(v.json.seed, undefined)
    assert.ok(v.json.commitment)
  })
})
