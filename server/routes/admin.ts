import { Router } from 'express'
import { audit } from '../audit.ts'
import { authOf, ctxOf, requirePerm, scopeShop } from '../auth.ts'
import { cfg, setConfig } from '../config.ts'
import { all, get, run, tx } from '../db.ts'
import { currentGame, tick, wheelSnapshot } from '../game.ts'
import { postTxn } from '../ledger.ts'
import { broadcastNow, presence } from '../realtime.ts'
import { shiftSummary } from '../tickets.ts'
import { ApiError, decrypt, encrypt, hashSecret, todayRange } from '../util.ts'

export const admin = Router()

const str = (v: unknown, name: string, min = 1, max = 120): string => {
  const s = typeof v === 'string' ? v.trim() : ''
  if (s.length < min || s.length > max) throw new ApiError(400, 'BAD_INPUT', `${name} must be ${min}–${max} characters`)
  return s
}
const int = (v: unknown, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): number => {
  const n = Number(v)
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new ApiError(400, 'BAD_INPUT', `${name} must be a whole number between ${min} and ${max}`)
  return n
}
const requireAdmin = requirePerm('*')

// ─── Regions & shops ────────────────────────────────────────────────────────
admin.get('/regions', (_req, res) => {
  res.json({ company: get('SELECT * FROM companies LIMIT 1'), regions: all('SELECT * FROM regions ORDER BY name') })
})
admin.post('/regions', requireAdmin, (req, res) => {
  const name = str(req.body?.name, 'Region name', 2, 60)
  const company = get<{ id: number }>('SELECT id FROM companies LIMIT 1')!
  const r = run('INSERT INTO regions (company_id, name) VALUES (?,?)', company.id, name)
  audit('REGION_CREATED', 'region', Number(r.lastInsertRowid), { name }, ctxOf(req, res))
  res.status(201).json({ id: Number(r.lastInsertRowid) })
})

function shopRows(shopId: number | null) {
  const [from, to] = todayRange()
  return all(
    `SELECT s.*, r.name AS region_name, u.full_name AS manager_name, COALESCE(w.balance,0) AS balance,
       (SELECT COUNT(*) FROM users c WHERE c.shop_id = s.id AND c.role = 'CASHIER' AND c.status = 'ACTIVE') AS cashiers,
       (SELECT COUNT(*) FROM devices d WHERE d.shop_id = s.id) AS devices,
       (SELECT COALESCE(SUM(total_stake),0) FROM tickets t WHERE t.shop_id = s.id AND t.status != 'CANCELLED' AND t.created_at >= ? AND t.created_at < ?) AS turnover_today
     FROM shops s JOIN regions r ON r.id = s.region_id LEFT JOIN users u ON u.id = s.manager_user_id LEFT JOIN wallets w ON w.shop_id = s.id
     ${shopId ? 'WHERE s.id = ?' : ''} ORDER BY s.name`,
    from, to, ...(shopId ? [shopId] : []),
  ).map((s) => ({
    id: s.id, code: s.code, name: s.name, address: s.address, phone: s.phone, status: s.status, regionId: s.region_id, region: s.region_name,
    managerId: s.manager_user_id, manager: s.manager_name, openingBalance: s.opening_balance, balance: s.balance, cashiers: s.cashiers, devices: s.devices, turnoverToday: s.turnover_today,
  }))
}

admin.get('/shops', (req, res) => {
  const u = authOf(res)
  if (u.role === 'CASHIER') throw new ApiError(403, 'FORBIDDEN', 'Not allowed')
  res.json({ shops: shopRows(u.role === 'ADMIN' ? null : u.shopId) })
})

admin.post('/shops', requireAdmin, (req, res) => {
  const b = req.body ?? {}
  const code = str(b.code, 'Shop code', 3, 12).toUpperCase()
  if (!/^[A-Z0-9]+$/.test(code)) throw new ApiError(400, 'BAD_INPUT', 'Shop code may contain only letters and digits')
  const id = tx(() => {
    if (get('SELECT id FROM shops WHERE code = ?', code)) throw new ApiError(409, 'DUPLICATE', 'A shop with that code already exists')
    if (!get('SELECT id FROM regions WHERE id = ?', b.regionId)) throw new ApiError(400, 'BAD_INPUT', 'Choose a region')
    const opening = int(b.openingBalance ?? 0, 'Opening balance')
    const sid = Number(
      run('INSERT INTO shops (region_id, code, name, address, phone, opening_balance, created_at) VALUES (?,?,?,?,?,?,?)', b.regionId, code, str(b.name, 'Shop name', 2, 60), String(b.address ?? '').slice(0, 200), String(b.phone ?? '').slice(0, 30), opening, Date.now()).lastInsertRowid,
    )
    run('INSERT INTO wallets (shop_id, balance, updated_at) VALUES (?,0,?)', sid, Date.now())
    if (opening > 0) postTxn({ shopId: sid, type: 'OPENING_BALANCE', amount: opening, userId: authOf(res).id, note: 'Opening balance' })
    audit('SHOP_CREATED', 'shop', sid, { code, opening }, ctxOf(req, res))
    return sid
  })
  res.status(201).json({ id })
})

admin.put('/shops/:id', requireAdmin, (req, res) => {
  const id = int(req.params.id, 'id')
  const b = req.body ?? {}
  const shop = get('SELECT * FROM shops WHERE id = ?', id)
  if (!shop) throw new ApiError(404, 'NOT_FOUND', 'Shop not found')
  const status = b.status ?? shop.status
  if (!['ACTIVE', 'SUSPENDED', 'CLOSED'].includes(status)) throw new ApiError(400, 'BAD_INPUT', 'Invalid status')
  let managerId = b.managerId === undefined ? shop.manager_user_id : b.managerId
  if (managerId !== null && !get("SELECT id FROM users WHERE id = ? AND role = 'MANAGER' AND shop_id = ?", managerId, id)) {
    throw new ApiError(400, 'BAD_INPUT', 'Manager must be a MANAGER user assigned to this shop')
  }
  run('UPDATE shops SET name = ?, address = ?, phone = ?, status = ?, manager_user_id = ? WHERE id = ?', b.name ? str(b.name, 'Shop name', 2, 60) : shop.name, b.address ?? shop.address, b.phone ?? shop.phone, status, managerId ?? null, id)
  audit('SHOP_UPDATED', 'shop', id, { before: { name: shop.name, status: shop.status }, after: { name: b.name, status } }, ctxOf(req, res))
  res.json({ ok: true })
})

// ─── Users (admins, managers, cashiers) ─────────────────────────────────────
function userRow(u: any) {
  const shift = get('SELECT id FROM cashier_shifts WHERE user_id = ? AND status = ?', u.id, 'OPEN')
  const live = shift ? shiftSummary(shift.id) : null
  const life = get<{ sales: number; payouts: number }>(
    "SELECT COALESCE((SELECT SUM(total_stake) FROM tickets WHERE cashier_id = ? AND status != 'CANCELLED'),0) AS sales, COALESCE((SELECT SUM(amount) FROM payouts WHERE cashier_id = ?),0) AS payouts",
    u.id, u.id,
  )!
  return {
    id: u.id, username: u.username, fullName: u.full_name, role: u.role, shopId: u.shop_id, shop: u.shop_name ?? null, cashierCode: u.cashier_code,
    phone: decrypt(u.phone_enc), shiftLabel: u.shift_label, payoutLimit: u.payout_limit, status: u.status, lastLoginAt: u.last_login_at,
    lockedUntil: u.locked_until > Date.now() ? u.locked_until : null,
    openingFloat: live?.openingFloat ?? null, currentBalance: live?.expectedCash ?? null, onShift: !!live,
    totalSales: life.sales, totalPayouts: life.payouts, netBalance: life.sales - life.payouts,
  }
}

admin.get('/users', requirePerm('users.manage.shop'), (req, res) => {
  const u = authOf(res)
  const shopId = scopeShop(u, req.query.shopId)
  const rows = all(`SELECT u.*, s.name AS shop_name FROM users u LEFT JOIN shops s ON s.id = u.shop_id WHERE 1=1 ${shopId ? 'AND u.shop_id = ?' : ''} ${u.role !== 'ADMIN' ? "AND u.role = 'CASHIER'" : ''} ${req.query.role ? 'AND u.role = ?' : ''} ORDER BY u.role, u.full_name`, ...(shopId ? [shopId] : []), ...(req.query.role ? [String(req.query.role)] : []))
  res.json({ users: rows.map(userRow) })
})

const validPassword = (p: unknown) => {
  if (typeof p !== 'string' || p.length < 8 || p.length > 100) throw new ApiError(400, 'WEAK_PASSWORD', 'Password must be at least 8 characters')
  return p
}
const validPin = (p: unknown) => {
  if (typeof p !== 'string' || !/^\d{4,6}$/.test(p)) throw new ApiError(400, 'BAD_PIN', 'PIN must be 4 to 6 digits')
  return p
}

admin.post('/users', requirePerm('users.manage.shop'), (req, res) => {
  const me = authOf(res)
  const b = req.body ?? {}
  const role = me.role === 'ADMIN' ? String(b.role) : 'CASHIER'
  if (!['ADMIN', 'MANAGER', 'CASHIER'].includes(role)) throw new ApiError(400, 'BAD_INPUT', 'Invalid role')
  const shopId = role === 'ADMIN' ? null : scopeShop(me, b.shopId) ?? int(b.shopId, 'Shop', 1)
  if (role !== 'ADMIN' && !get('SELECT id FROM shops WHERE id = ?', shopId)) throw new ApiError(400, 'BAD_INPUT', 'Choose a shop')
  const username = str(b.username, 'Username', 3, 32).toLowerCase()
  if (!/^[a-z0-9._-]+$/.test(username)) throw new ApiError(400, 'BAD_INPUT', 'Username may contain letters, digits, dot, dash and underscore')
  if (get('SELECT id FROM users WHERE username = ?', username)) throw new ApiError(409, 'DUPLICATE', 'That username is taken')
  const id = tx(() => {
    const r = run(
      'INSERT INTO users (username, full_name, role, shop_id, cashier_code, password_hash, pin_hash, phone_enc, shift_label, payout_limit, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      username, str(b.fullName, 'Full name', 2, 80), role, shopId, role === 'CASHIER' ? str(b.cashierCode ?? '', 'Cashier code', 1, 20) : null, hashSecret(validPassword(b.password)), hashSecret(validPin(b.pin)),
      encrypt(String(b.phone ?? '').slice(0, 30)), ['MORNING', 'AFTERNOON', 'NIGHT', 'FULL'].includes(b.shiftLabel) ? b.shiftLabel : 'FULL', b.payoutLimit === undefined ? 5_000_000 : int(b.payoutLimit, 'Payout limit'), Date.now(),
    )
    const uid = Number(r.lastInsertRowid)
    if (role === 'MANAGER' && !get('SELECT manager_user_id FROM shops WHERE id = ?', shopId)?.manager_user_id) run('UPDATE shops SET manager_user_id = ? WHERE id = ?', uid, shopId)
    audit('USER_CREATED', 'user', uid, { username, role, shopId }, ctxOf(req, res))
    return uid
  })
  res.status(201).json({ id })
})

function targetUser(me: ReturnType<typeof authOf>, id: number) {
  const t = get('SELECT * FROM users WHERE id = ?', id)
  if (!t) throw new ApiError(404, 'NOT_FOUND', 'User not found')
  if (me.role !== 'ADMIN' && (t.role !== 'CASHIER' || t.shop_id !== me.shopId)) throw new ApiError(403, 'FORBIDDEN', 'You can only manage cashiers in your own shop')
  return t
}

admin.put('/users/:id', requirePerm('users.manage.shop'), (req, res) => {
  const me = authOf(res)
  const t = targetUser(me, int(req.params.id, 'id'))
  const b = req.body ?? {}
  const status = b.status ?? t.status
  if (!['ACTIVE', 'DISABLED'].includes(status)) throw new ApiError(400, 'BAD_INPUT', 'Invalid status')
  if (t.id === me.id && status !== 'ACTIVE') throw new ApiError(400, 'BAD_INPUT', 'You cannot disable your own account')
  const shopId = me.role === 'ADMIN' && b.shopId !== undefined && t.role !== 'ADMIN' ? int(b.shopId, 'Shop', 1) : t.shop_id
  run(
    'UPDATE users SET full_name = ?, phone_enc = ?, shift_label = ?, payout_limit = ?, status = ?, cashier_code = ?, shop_id = ?, locked_until = ?, failed_logins = ?, failed_pins = ? WHERE id = ?',
    b.fullName ? str(b.fullName, 'Full name', 2, 80) : t.full_name, b.phone !== undefined ? encrypt(String(b.phone).slice(0, 30)) : t.phone_enc,
    ['MORNING', 'AFTERNOON', 'NIGHT', 'FULL'].includes(b.shiftLabel) ? b.shiftLabel : t.shift_label, b.payoutLimit !== undefined ? int(b.payoutLimit, 'Payout limit') : t.payout_limit,
    status, b.cashierCode !== undefined && t.role === 'CASHIER' ? str(b.cashierCode, 'Cashier code', 1, 20) : t.cashier_code, shopId,
    b.unlock ? 0 : t.locked_until, b.unlock ? 0 : t.failed_logins, b.unlock ? 0 : t.failed_pins, t.id,
  )
  if (status !== 'ACTIVE') run('UPDATE sessions SET revoked = 1 WHERE user_id = ?', t.id)
  audit('USER_UPDATED', 'user', t.id, { status, unlock: !!b.unlock, payoutLimit: b.payoutLimit }, ctxOf(req, res))
  res.json({ ok: true })
})

admin.post('/users/:id/reset', requirePerm('users.manage.shop'), (req, res) => {
  const t = targetUser(authOf(res), int(req.params.id, 'id'))
  const b = req.body ?? {}
  if (b.password === undefined && b.pin === undefined) throw new ApiError(400, 'BAD_INPUT', 'Provide a new password and/or PIN')
  if (b.password !== undefined) run('UPDATE users SET password_hash = ? WHERE id = ?', hashSecret(validPassword(b.password)), t.id)
  if (b.pin !== undefined) run('UPDATE users SET pin_hash = ? WHERE id = ?', hashSecret(validPin(b.pin)), t.id)
  run('UPDATE sessions SET revoked = 1 WHERE user_id = ?', t.id)
  audit('CREDENTIALS_RESET', 'user', t.id, { password: b.password !== undefined, pin: b.pin !== undefined }, ctxOf(req, res))
  res.json({ ok: true })
})

// ─── Wheel (changes apply from the next round; the running round keeps its snapshot) ──
admin.get('/wheel', requireAdmin, (_req, res) => {
  const wheel = get('SELECT * FROM wheels WHERE active = 1 LIMIT 1')
  res.json({
    wheel,
    categoryColors: cfg()['wheel.categoryColors'],
    segments: all('SELECT * FROM wheel_segments WHERE wheel_id = ? ORDER BY sort_order, number', wheel?.id).map((s) => ({
      id: s.id, number: s.number, name: s.name, category: s.category, multiplierX100: s.multiplier_x100, active: !!s.active, sortOrder: s.sort_order,
    })),
    liveSnapshot: currentGame() ? (JSON.parse(currentGame()!.wheel_snapshot) as unknown[]).length : null,
  })
})

function assertWheelPlayable(wheelId: number) {
  const n = get<{ n: number }>('SELECT COUNT(*) AS n FROM wheel_segments WHERE wheel_id = ? AND active = 1', wheelId)!.n
  if (n < 2) throw new ApiError(400, 'WHEEL_TOO_SMALL', 'The wheel needs at least two active segments')
}

admin.post('/wheel/segments', requireAdmin, (req, res) => {
  const b = req.body ?? {}
  const wheel = get<{ id: number }>('SELECT id FROM wheels WHERE active = 1 LIMIT 1')!
  const number = int(b.number, 'Number', 0, 999)
  if (get('SELECT id FROM wheel_segments WHERE wheel_id = ? AND number = ?', wheel.id, number)) throw new ApiError(409, 'DUPLICATE', 'A segment with that number already exists')
  const max = get<{ m: number }>('SELECT COALESCE(MAX(sort_order),0) AS m FROM wheel_segments WHERE wheel_id = ?', wheel.id)!.m
  const r = run('INSERT INTO wheel_segments (wheel_id, number, name, category, multiplier_x100, sort_order) VALUES (?,?,?,?,?,?)', wheel.id, number, str(b.name ?? String(number), 'Name', 1, 20), str(b.category, 'Category', 2, 20).toUpperCase(), int(b.multiplierX100, 'Multiplier', 100), b.sortOrder === undefined ? max + 1 : int(b.sortOrder, 'Order'))
  audit('SEGMENT_CREATED', 'segment', Number(r.lastInsertRowid), { number, category: b.category, multiplierX100: b.multiplierX100 }, ctxOf(req, res))
  res.status(201).json({ id: Number(r.lastInsertRowid) })
})

admin.put('/wheel/segments/:id', requireAdmin, (req, res) => {
  const id = int(req.params.id, 'id')
  const s = get('SELECT * FROM wheel_segments WHERE id = ?', id)
  if (!s) throw new ApiError(404, 'NOT_FOUND', 'Segment not found')
  const b = req.body ?? {}
  tx(() => {
    run('UPDATE wheel_segments SET name = ?, category = ?, multiplier_x100 = ?, active = ?, sort_order = ? WHERE id = ?', b.name ? str(b.name, 'Name', 1, 20) : s.name, b.category ? str(b.category, 'Category', 2, 20).toUpperCase() : s.category, b.multiplierX100 !== undefined ? int(b.multiplierX100, 'Multiplier', 100) : s.multiplier_x100, b.active === undefined ? s.active : b.active ? 1 : 0, b.sortOrder !== undefined ? int(b.sortOrder, 'Order') : s.sort_order, id)
    assertWheelPlayable(s.wheel_id)
    audit('SEGMENT_UPDATED', 'segment', id, { before: { category: s.category, multiplierX100: s.multiplier_x100, active: s.active }, after: b }, ctxOf(req, res))
  })
  res.json({ ok: true })
})

// ─── Markets & options ──────────────────────────────────────────────────────
admin.get('/markets', requireAdmin, (_req, res) => {
  const snap = wheelSnapshot()
  const n = snap.length
  const mult = new Map(snap.map((s) => [s.number, s.multiplierX100]))
  const markets = all('SELECT * FROM bet_markets ORDER BY sort_order, id').map((m) => ({
    id: m.id, code: m.code, name: m.name, kind: m.kind, active: !!m.active, sortOrder: m.sort_order,
    options: all('SELECT * FROM bet_options WHERE market_id = ? ORDER BY sort_order, id', m.id).map((o) => {
      const numbers = JSON.parse(o.segment_numbers) as number[]
      const covered = numbers.filter((x) => mult.has(x))
      const sum = covered.reduce((a, x) => a + (o.odds_source === 'SEGMENT' ? mult.get(x)! : o.odds_x100), 0)
      return { id: o.id, code: o.code, label: o.label, numbers, oddsX100: o.odds_x100, oddsSource: o.odds_source, tone: o.tone, active: !!o.active, sortOrder: o.sort_order, coverage: covered.length, wheelSize: n, hitChance: n ? covered.length / n : 0, theoreticalReturn: n ? sum / 100 / n : 0 }
    }),
  }))
  res.json({ markets })
})

admin.post('/markets', requireAdmin, (req, res) => {
  const b = req.body ?? {}
  const code = str(b.code, 'Code', 2, 20).toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  if (get('SELECT id FROM bet_markets WHERE code = ?', code)) throw new ApiError(409, 'DUPLICATE', 'Market code already exists')
  const max = get<{ m: number }>('SELECT COALESCE(MAX(sort_order),0) AS m FROM bet_markets')!.m
  const r = run('INSERT INTO bet_markets (code, name, kind, sort_order) VALUES (?,?,?,?)', code, str(b.name, 'Name', 2, 40), 'CUSTOM', max + 1)
  audit('MARKET_CREATED', 'market', Number(r.lastInsertRowid), { code }, ctxOf(req, res))
  res.status(201).json({ id: Number(r.lastInsertRowid) })
})
admin.put('/markets/:id', requireAdmin, (req, res) => {
  const id = int(req.params.id, 'id')
  const m = get('SELECT * FROM bet_markets WHERE id = ?', id)
  if (!m) throw new ApiError(404, 'NOT_FOUND', 'Market not found')
  const b = req.body ?? {}
  run('UPDATE bet_markets SET name = ?, active = ?, sort_order = ? WHERE id = ?', b.name ? str(b.name, 'Name', 2, 40) : m.name, b.active === undefined ? m.active : b.active ? 1 : 0, b.sortOrder !== undefined ? int(b.sortOrder, 'Order') : m.sort_order, id)
  audit('MARKET_UPDATED', 'market', id, { active: b.active, name: b.name }, ctxOf(req, res))
  res.json({ ok: true })
})

const numbersOf = (v: unknown): number[] => {
  if (!Array.isArray(v) || v.length === 0 || v.length > 200 || !v.every((x) => Number.isInteger(x))) throw new ApiError(400, 'BAD_INPUT', 'Choose at least one wheel number')
  return [...new Set(v as number[])].sort((a, b) => a - b)
}
admin.post('/markets/:id/options', requireAdmin, (req, res) => {
  const b = req.body ?? {}
  const mid = int(req.params.id, 'id')
  if (!get('SELECT id FROM bet_markets WHERE id = ?', mid)) throw new ApiError(404, 'NOT_FOUND', 'Market not found')
  const code = str(b.code, 'Code', 2, 24).toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  if (get('SELECT id FROM bet_options WHERE code = ?', code)) throw new ApiError(409, 'DUPLICATE', 'Option code already exists')
  const max = get<{ m: number }>('SELECT COALESCE(MAX(sort_order),0) AS m FROM bet_options WHERE market_id = ?', mid)!.m
  const r = run('INSERT INTO bet_options (market_id, code, label, segment_numbers, odds_x100, odds_source, tone, sort_order) VALUES (?,?,?,?,?,?,?,?)', mid, code, str(b.label, 'Label', 1, 30), JSON.stringify(numbersOf(b.numbers)), int(b.oddsX100, 'Odds', 100, 10_000_000), b.oddsSource === 'SEGMENT' ? 'SEGMENT' : 'FIXED', String(b.tone ?? '').slice(0, 20), max + 1)
  audit('OPTION_CREATED', 'option', Number(r.lastInsertRowid), { code, oddsX100: b.oddsX100 }, ctxOf(req, res))
  res.status(201).json({ id: Number(r.lastInsertRowid) })
})
admin.put('/options/:id', requireAdmin, (req, res) => {
  const id = int(req.params.id, 'id')
  const o = get('SELECT * FROM bet_options WHERE id = ?', id)
  if (!o) throw new ApiError(404, 'NOT_FOUND', 'Option not found')
  const b = req.body ?? {}
  run('UPDATE bet_options SET label = ?, segment_numbers = ?, odds_x100 = ?, odds_source = ?, active = ?, sort_order = ? WHERE id = ?', b.label ? str(b.label, 'Label', 1, 30) : o.label, b.numbers ? JSON.stringify(numbersOf(b.numbers)) : o.segment_numbers, b.oddsX100 !== undefined ? int(b.oddsX100, 'Odds', 100, 10_000_000) : o.odds_x100, b.oddsSource ? (b.oddsSource === 'SEGMENT' ? 'SEGMENT' : 'FIXED') : o.odds_source, b.active === undefined ? o.active : b.active ? 1 : 0, b.sortOrder !== undefined ? int(b.sortOrder, 'Order') : o.sort_order, id)
  audit('OPTION_UPDATED', 'option', id, { before: { oddsX100: o.odds_x100, active: o.active }, after: { oddsX100: b.oddsX100, active: b.active } }, ctxOf(req, res))
  res.json({ ok: true })
})

// ─── System configuration ───────────────────────────────────────────────────
admin.get('/config', requireAdmin, (_req, res) => res.json({ config: cfg() }))
admin.put('/config', requireAdmin, (req, res) => {
  const changes = tx(() => {
    const c = setConfig(req.body ?? {}, authOf(res).id)
    audit('CONFIG_CHANGED', 'configuration', null, c, ctxOf(req, res))
    return c
  })
  if ('game.paused' in changes || 'dog.paused' in changes) tick()
  broadcastNow()
  res.json({ config: cfg() })
})

// ─── Games ──────────────────────────────────────────────────────────────────
admin.get('/games', requirePerm('tickets.view'), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 200)
  const rows = all(
    `SELECT g.id, g.game_type, g.status, g.opens_at, g.closes_at, g.settled_at, r.segment_number, r.category, r.result_json, r.generated_at, r.result_hash, r.server_id, r.audit_ref,
       (SELECT COUNT(*) FROM tickets t WHERE t.game_id = g.id AND t.status != 'CANCELLED') AS tickets,
       (SELECT COALESCE(SUM(total_stake),0) FROM tickets t WHERE t.game_id = g.id AND t.status != 'CANCELLED') AS stake,
       (SELECT COALESCE(SUM(win_amount),0) FROM ticket_settlements s WHERE s.game_id = g.id) AS winnings
     FROM games g LEFT JOIN game_results r ON r.game_id = g.id AND g.status IN ('RESULT','COMPLETED') ORDER BY g.id DESC LIMIT ?`,
    limit,
  )
  res.json({ games: rows })
})
// Each game is paused and resumed on its own. Body: { game: 'WHEEL' | 'DOGS' } (default WHEEL).
const pauseKey = (body: any) => (body?.game === 'DOGS' ? 'dog.paused' : 'game.paused')
admin.post('/games/pause', requireAdmin, (req, res) => {
  tx(() => {
    setConfig({ [pauseKey(req.body)]: true }, authOf(res).id)
    audit('GAMES_PAUSED', 'system', null, { game: req.body?.game ?? 'WHEEL' }, ctxOf(req, res))
  })
  broadcastNow()
  res.json({ ok: true })
})
admin.post('/games/resume', requireAdmin, (req, res) => {
  tx(() => {
    setConfig({ [pauseKey(req.body)]: false }, authOf(res).id)
    audit('GAMES_RESUMED', 'system', null, { game: req.body?.game ?? 'WHEEL' }, ctxOf(req, res))
  })
  tick()
  broadcastNow()
  res.json({ ok: true })
})

// ─── Devices & presence ─────────────────────────────────────────────────────
admin.get('/devices', requireAdmin, (_req, res) => {
  res.json({
    devices: all('SELECT d.*, s.name AS shop_name FROM devices d LEFT JOIN shops s ON s.id = d.shop_id ORDER BY d.last_seen DESC LIMIT 200').map((d) => ({
      id: d.id, kind: d.kind, shop: d.shop_name, label: d.label, lastIp: d.last_ip, userAgent: d.user_agent, firstSeen: d.first_seen, lastSeen: d.last_seen, status: d.status,
    })),
    presence: presence(),
  })
})
admin.put('/devices/:id', requireAdmin, (req, res) => {
  const d = get('SELECT * FROM devices WHERE id = ?', String(req.params.id))
  if (!d) throw new ApiError(404, 'NOT_FOUND', 'Device not found')
  const status = req.body?.status === 'BLOCKED' ? 'BLOCKED' : 'ACTIVE'
  run('UPDATE devices SET status = ?, label = ? WHERE id = ?', status, req.body?.label ?? d.label, d.id)
  audit('DEVICE_UPDATED', 'device', d.id, { status }, ctxOf(req, res))
  res.json({ ok: true })
})
