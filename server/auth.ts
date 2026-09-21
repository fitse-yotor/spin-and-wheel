import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { audit, raiseAlert, type Ctx } from './audit.ts'
import { cfg } from './config.ts'
import { get, run, tx } from './db.ts'
import { ApiError, clientIp, hashSecret, randomToken, sha256, signJwt, verifyJwt, verifySecret } from './util.ts'

export type Role = 'ADMIN' | 'MANAGER' | 'CASHIER'

export interface AuthUser {
  id: number
  username: string
  fullName: string
  role: Role
  shopId: number | null
  cashierCode: string | null
  payoutLimit: number
  sessionId: number
}

// ─── RBAC ───────────────────────────────────────────────────────────────────
const PERMISSIONS: Record<Role, string[]> = {
  ADMIN: ['*'],
  MANAGER: ['reports.view', 'ledger.view', 'ledger.record', 'tickets.view', 'shifts.manage', 'users.manage.shop', 'shops.view.own', 'monitor.own'],
  CASHIER: ['pos.use'],
}
export const can = (role: Role, perm: string) => PERMISSIONS[role].includes('*') || PERMISSIONS[role].includes(perm)

export const requirePerm =
  (perm: string): RequestHandler =>
  (_req, res, next) => {
    const u = res.locals.auth as AuthUser
    if (!can(u.role, perm)) return next(new ApiError(403, 'FORBIDDEN', 'Your role is not allowed to do this'))
    next()
  }

export const authOf = (res: Response) => res.locals.auth as AuthUser
export const ctxOf = (req: Request, res: Response): Ctx => ({
  user: res.locals.auth ? { id: authOf(res).id, role: authOf(res).role, shopId: authOf(res).shopId } : null,
  ip: clientIp(req),
  deviceId: deviceIdOf(req),
})
const deviceIdOf = (req: Request) => {
  const d = req.header('x-device-id')
  return d && /^[\w-]{8,64}$/.test(d) ? d : undefined
}

/** Manager/cashier requests are always confined to their own shop; admin may choose. */
export function scopeShop(u: AuthUser, requested: unknown): number | null {
  if (u.role === 'ADMIN') return requested ? Number(requested) : null
  if (!u.shopId) throw new ApiError(403, 'NO_SHOP', 'Your account is not assigned to a shop')
  if (requested && Number(requested) !== u.shopId) throw new ApiError(403, 'FORBIDDEN', 'You can only access your own shop')
  return u.shopId
}

// ─── Rate limiting (per key, sliding fixed window) ──────────────────────────
const buckets = new Map<string, { count: number; reset: number }>()
setInterval(() => {
  const now = Date.now()
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k)
}, 60_000).unref()

export const rateLimit =
  (name: string, max: number, windowMs: number, by: (req: Request, res: Response) => string = (req) => clientIp(req)): RequestHandler =>
  (req, res, next) => {
    const key = `${name}:${by(req, res)}`
    const now = Date.now()
    let b = buckets.get(key)
    if (!b || b.reset < now) {
      b = { count: 0, reset: now + windowMs }
      buckets.set(key, b)
    }
    if (++b.count > max) {
      res.setHeader('Retry-After', Math.ceil((b.reset - now) / 1000))
      return next(new ApiError(429, 'RATE_LIMITED', 'Too many requests. Slow down and try again shortly.'))
    }
    next()
  }

// ─── Devices ────────────────────────────────────────────────────────────────
export function touchDevice(req: Request, kind: string, userId: number | null, shopId: number | null) {
  const id = deviceIdOf(req)
  if (!id) return
  const now = Date.now()
  const ip = clientIp(req)
  const ua = (req.header('user-agent') ?? '').slice(0, 200)
  const existing = get<{ status: string; last_ip: string | null }>('SELECT status, last_ip FROM devices WHERE id = ?', id)
  if (existing?.status === 'BLOCKED') throw new ApiError(403, 'DEVICE_BLOCKED', 'This device has been blocked by an administrator')
  if (existing) {
    run('UPDATE devices SET last_seen = ?, last_ip = ?, user_agent = ?, last_user_id = COALESCE(?, last_user_id), shop_id = COALESCE(?, shop_id) WHERE id = ?', now, ip, ua, userId, shopId, id)
    if (existing.last_ip && existing.last_ip !== ip && userId) {
      raiseAlert('DEVICE_IP_CHANGE', 'LOW', `Device ${id.slice(0, 8)} changed IP ${existing.last_ip} → ${ip}`, { shopId, userId })
    }
  } else {
    run('INSERT INTO devices (id, kind, shop_id, last_user_id, last_ip, user_agent, first_seen, last_seen) VALUES (?,?,?,?,?,?,?,?)', id, kind, shopId, userId, ip, ua, now, now)
  }
}

// ─── Sessions ───────────────────────────────────────────────────────────────
function issueTokens(user: { id: number; role: Role }, sessionId: number, refresh: string) {
  return {
    accessToken: signJwt({ sub: user.id, role: user.role, sid: sessionId }, cfg()['session.accessMinutes'] * 60),
    refreshToken: refresh,
    accessExpiresInSec: cfg()['session.accessMinutes'] * 60,
  }
}

const DUMMY_HASH = hashSecret('dummy-password-for-timing')

export function login(username: string, password: string, req: Request) {
  const now = Date.now()
  const ip = clientIp(req)
  const user = get('SELECT * FROM users WHERE username = ?', String(username).trim().toLowerCase())
  if (!user) {
    verifySecret(String(password), DUMMY_HASH)
    audit('LOGIN_FAILED', 'user', null, { username: String(username).slice(0, 40), reason: 'unknown user' }, { ip, deviceId: deviceIdOf(req) })
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Wrong username or password')
  }
  const ctx: Ctx = { user: { id: user.id, role: user.role, shopId: user.shop_id }, ip, deviceId: deviceIdOf(req) }
  if (user.locked_until > now) {
    throw new ApiError(423, 'ACCOUNT_LOCKED', `Account locked. Try again in ${Math.ceil((user.locked_until - now) / 60000)} min.`)
  }
  if (user.status !== 'ACTIVE') throw new ApiError(403, 'ACCOUNT_DISABLED', 'This account is disabled')
  if (user.shop_id) {
    const shop = get<{ status: string }>('SELECT status FROM shops WHERE id = ?', user.shop_id)
    if (shop && shop.status !== 'ACTIVE') throw new ApiError(403, 'SHOP_INACTIVE', 'Your shop is not active')
  }
  if (!verifySecret(String(password), user.password_hash)) {
    tx(() => {
      const fails = user.failed_logins + 1
      const lock = fails >= 5
      run('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', lock ? 0 : fails, lock ? now + 15 * 60_000 : 0, user.id)
      audit('LOGIN_FAILED', 'user', user.id, { attempt: fails }, ctx)
      if (lock) {
        raiseAlert('REPEATED_FAILED_LOGIN', 'MEDIUM', `${user.username} locked after 5 failed sign-ins from ${ip}`, { shopId: user.shop_id, userId: user.id })
        audit('ACCOUNT_LOCKED', 'user', user.id, { minutes: 15 }, ctx)
      }
    })
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Wrong username or password')
  }
  return tx(() => {
    run('UPDATE users SET failed_logins = 0, last_login_at = ? WHERE id = ?', now, user.id)
    const refresh = randomToken(32)
    const s = run(
      'INSERT INTO sessions (user_id, refresh_hash, device_id, ip, user_agent, created_at, last_seen, expires_at) VALUES (?,?,?,?,?,?,?,?)',
      user.id, sha256(refresh), deviceIdOf(req) ?? null, ip, (req.header('user-agent') ?? '').slice(0, 200), now, now, now + cfg()['session.absoluteHours'] * 3_600_000,
    )
    const sid = Number(s.lastInsertRowid)
    touchDevice(req, user.role === 'CASHIER' ? 'POS' : 'ADMIN', user.id, user.shop_id)
    audit('LOGIN', 'user', user.id, { sessionId: sid }, ctx)
    return { ...issueTokens(user, sid, refresh), user: publicUser(user) }
  })
}

export function refresh(refreshToken: string, req: Request) {
  const now = Date.now()
  const s = get('SELECT * FROM sessions WHERE refresh_hash = ?', sha256(String(refreshToken)))
  if (!s || s.revoked || s.expires_at < now || now - s.last_seen > cfg()['session.idleMinutes'] * 60_000) {
    throw new ApiError(401, 'SESSION_EXPIRED', 'Session expired. Please sign in again.')
  }
  const user = get('SELECT * FROM users WHERE id = ?', s.user_id)
  if (!user || user.status !== 'ACTIVE') throw new ApiError(401, 'SESSION_EXPIRED', 'Session expired. Please sign in again.')
  const next = randomToken(32)
  run('UPDATE sessions SET refresh_hash = ?, ip = ? WHERE id = ?', sha256(next), clientIp(req), s.id)
  return { ...issueTokens(user, s.id, next), user: publicUser(user) }
}

export function logout(sessionId: number, ctx: Ctx) {
  run('UPDATE sessions SET revoked = 1 WHERE id = ?', sessionId)
  audit('LOGOUT', 'session', sessionId, {}, ctx)
}

export const publicUser = (u: any) => ({
  id: u.id,
  username: u.username,
  fullName: u.full_name,
  role: u.role as Role,
  shopId: u.shop_id as number | null,
  cashierCode: u.cashier_code as string | null,
})

// ─── Express middleware ─────────────────────────────────────────────────────
export function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const h = req.header('authorization') ?? ''
    const payload = h.startsWith('Bearer ') ? verifyJwt(h.slice(7)) : null
    if (!payload) throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in')
    const now = Date.now()
    const s = get('SELECT * FROM sessions WHERE id = ?', payload.sid)
    if (!s || s.revoked || s.user_id !== payload.sub || s.expires_at < now || now - s.last_seen > cfg()['session.idleMinutes'] * 60_000) {
      throw new ApiError(401, 'SESSION_EXPIRED', 'Session expired. Please sign in again.')
    }
    const u = get('SELECT * FROM users WHERE id = ?', payload.sub)
    if (!u || u.status !== 'ACTIVE') throw new ApiError(401, 'SESSION_EXPIRED', 'Account disabled')
    // Only deliberate actions keep a session alive. Background polling (x-background) must not, or the idle timeout could never fire.
    if (!req.header('x-background') && now - s.last_seen > 10_000) run('UPDATE sessions SET last_seen = ? WHERE id = ?', now, s.id)
    touchDevice(req, u.role === 'CASHIER' ? 'POS' : 'ADMIN', u.id, u.shop_id)
    res.locals.auth = { ...publicUser(u), payoutLimit: u.payout_limit, sessionId: s.id } satisfies AuthUser
    next()
  } catch (e) {
    next(e)
  }
}

// ─── PIN confirmation for sensitive actions ─────────────────────────────────
export function checkPin(userId: number, pin: unknown, ctx: Ctx): void {
  const u = get('SELECT * FROM users WHERE id = ?', userId)!
  if (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) throw new ApiError(400, 'PIN_REQUIRED', 'Enter your PIN to continue')
  if (u.locked_until > Date.now()) throw new ApiError(423, 'ACCOUNT_LOCKED', 'Account locked')
  if (verifySecret(pin, u.pin_hash)) {
    if (u.failed_pins) run('UPDATE users SET failed_pins = 0 WHERE id = ?', userId)
    return
  }
  const fails = u.failed_pins + 1
  // Failure bookkeeping must survive the caller's rollback, so it is committed independently.
  const lock = fails >= 5
  run('UPDATE users SET failed_pins = ?, locked_until = ? WHERE id = ?', lock ? 0 : fails, lock ? Date.now() + 15 * 60_000 : 0, userId)
  audit('PIN_FAILED', 'user', userId, { attempt: fails }, ctx)
  if (lock) {
    run('UPDATE sessions SET revoked = 1 WHERE user_id = ?', userId)
    raiseAlert('REPEATED_FAILED_PIN', 'HIGH', `${u.username} locked after 5 wrong PIN entries`, { shopId: u.shop_id, userId })
  }
  throw new ApiError(403, 'BAD_PIN', lock ? 'Too many wrong PINs. Account locked for 15 minutes.' : 'Wrong PIN')
}
