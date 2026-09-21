import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'

// ─── Time (Africa/Addis_Ababa, UTC+3, no DST) ───────────────────────────────
const EAT_OFFSET_MS = 3 * 3600 * 1000
export const DAY_MS = 86_400_000

export function dayKey(ts: number): string {
  return new Date(ts + EAT_OFFSET_MS).toISOString().slice(0, 10)
}
export function dayStart(key: string): number {
  return Date.parse(`${key}T00:00:00+03:00`)
}
export function todayRange(ts = Date.now()): [number, number] {
  const s = dayStart(dayKey(ts))
  return [s, s + DAY_MS]
}

// ─── Errors ─────────────────────────────────────────────────────────────────
export class ApiError extends Error {
  status: number
  code: string
  extra?: Record<string, unknown>
  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.code = code
    this.extra = extra
  }
}

// ─── Hashing ────────────────────────────────────────────────────────────────
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

export function hashSecret(secret: string): string {
  const salt = randomBytes(16)
  const key = scryptSync(secret, salt, 32)
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`
}

export function verifySecret(secret: string, stored: string): boolean {
  const [scheme, saltHex, keyHex] = stored.split('$')
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false
  const expected = Buffer.from(keyHex, 'hex')
  const actual = scryptSync(secret, Buffer.from(saltHex, 'hex'), expected.length)
  return timingSafeEqual(actual, expected)
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

// ─── Field encryption (AES-256-GCM) for sensitive personal data ─────────────
function dataKey(): Buffer {
  return createHash('sha256').update(getSecret('data')).digest()
}
export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', dataKey(), iv)
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return `enc1$${iv.toString('hex')}$${c.getAuthTag().toString('hex')}$${enc.toString('hex')}`
}
export function decrypt(blob: string | null): string {
  if (!blob) return ''
  const [v, iv, tag, enc] = blob.split('$')
  if (v !== 'enc1' || !iv || !tag || !enc) return ''
  try {
    const d = createDecipheriv('aes-256-gcm', dataKey(), Buffer.from(iv, 'hex'))
    d.setAuthTag(Buffer.from(tag, 'hex'))
    return Buffer.concat([d.update(Buffer.from(enc, 'hex')), d.final()]).toString('utf8')
  } catch {
    return ''
  }
}

// ─── Secrets: env first, else generated once and kept in the DB ─────────────
let secretLookup: (name: string) => string = () => {
  throw new Error('secret store not initialised')
}
export function setSecretLookup(fn: (name: string) => string) {
  secretLookup = fn
}
export function getSecret(name: 'jwt' | 'data'): string {
  const fromEnv = process.env[name === 'jwt' ? 'JWT_SECRET' : 'DATA_KEY']
  return fromEnv || secretLookup(name)
}

// ─── JWT (HS256) ────────────────────────────────────────────────────────────
const b64u = (v: Buffer | string) => Buffer.from(v).toString('base64url')

export interface JwtPayload {
  sub: number
  role: string
  sid: number
  exp: number
  iat: number
}

export function signJwt(payload: Omit<JwtPayload, 'exp' | 'iat'>, ttlSec: number): string {
  const iat = Math.floor(Date.now() / 1000)
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64u(JSON.stringify({ ...payload, iat, exp: iat + ttlSec }))
  const sig = createHmac('sha256', getSecret('jwt')).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}

export function verifyJwt(token: string): JwtPayload | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [head, body, sig] = parts
  const expected = createHmac('sha256', getSecret('jwt')).update(`${head}.${body}`).digest('base64url')
  if (!safeEqual(sig, expected)) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as JwtPayload
    return p.exp > Date.now() / 1000 ? p : null
  } catch {
    return null
  }
}

// ─── Identifiers ────────────────────────────────────────────────────────────
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I
export function randomCode(len: number): string {
  let out = ''
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return out
}
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')
export const pad = (n: number, w: number) => String(n).padStart(w, '0')

// ─── Money helpers (integers only: santim = 1/100 ETB, odds = hundredths) ───
export const payoutFor = (stake: number, oddsX100: number) => Math.floor((stake * oddsX100) / 100)

export function clientIp(req: { ip?: string; headers: Record<string, unknown> }): string {
  const fwd = req.headers['x-forwarded-for']
  if (process.env.TRUST_PROXY && typeof fwd === 'string') return fwd.split(',')[0].trim()
  return (req.ip ?? '').replace('::ffff:', '')
}
