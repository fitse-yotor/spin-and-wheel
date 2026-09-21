import { all, get, run } from './db.ts'
import { pad, sha256 } from './util.ts'

export interface Ctx {
  user?: { id: number; role: string; shopId: number | null } | null
  ip?: string
  deviceId?: string
  shopId?: number | null
}

const GENESIS = '0'.repeat(64)

/** Append to the tamper-evident audit trail (each row hashes the previous one). Returns the audit reference. */
export function audit(action: string, entity: string, entityId: string | number | null, details: unknown = {}, ctx: Ctx = {}): string {
  const last = get<{ hash: string }>('SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1')
  const prev = last?.hash ?? GENESIS
  const ts = Date.now()
  const json = JSON.stringify(details ?? {})
  const shopId = ctx.shopId ?? ctx.user?.shopId ?? null
  const hash = sha256([prev, ts, ctx.user?.id ?? '', action, entity, entityId ?? '', json].join('|'))
  const r = run(
    'INSERT INTO audit_logs (ts, actor_id, actor_role, shop_id, action, entity, entity_id, ip, device_id, details, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    ts,
    ctx.user?.id ?? null,
    ctx.user?.role ?? 'SYSTEM',
    shopId,
    action,
    entity,
    entityId === null ? null : String(entityId),
    ctx.ip ?? null,
    ctx.deviceId ?? null,
    json,
    prev,
    hash,
  )
  return `AUD-${pad(Number(r.lastInsertRowid), 8)}`
}

/** Re-computes the whole chain; returns the first broken row id, or null when intact. */
export function verifyAuditChain(): { ok: boolean; checked: number; brokenAt: number | null } {
  let prev = GENESIS
  let checked = 0
  for (const r of all('SELECT * FROM audit_logs ORDER BY id ASC')) {
    const expected = sha256([prev, r.ts, r.actor_id ?? '', r.action, r.entity, r.entity_id ?? '', r.details].join('|'))
    if (r.prev_hash !== prev || r.hash !== expected) return { ok: false, checked, brokenAt: r.id }
    prev = r.hash
    checked++
  }
  return { ok: true, checked, brokenAt: null }
}

export function raiseAlert(
  kind: string,
  severity: 'LOW' | 'MEDIUM' | 'HIGH',
  message: string,
  opts: { shopId?: number | null; userId?: number | null; details?: unknown } = {},
) {
  run(
    'INSERT INTO alerts (ts, severity, kind, message, shop_id, user_id, details) VALUES (?,?,?,?,?,?,?)',
    Date.now(),
    severity,
    kind,
    message,
    opts.shopId ?? null,
    opts.userId ?? null,
    JSON.stringify(opts.details ?? {}),
  )
}
