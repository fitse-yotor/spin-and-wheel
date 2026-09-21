// Thin fetch wrapper: bearer auth, silent token refresh, device id, and a distinct NETWORK error
// so the POS can tell "server said no" apart from "server unreachable".

export interface User {
  id: number
  username: string
  fullName: string
  role: 'ADMIN' | 'MANAGER' | 'CASHIER'
  shopId: number | null
  cashierCode: string | null
}
interface AuthState {
  accessToken: string
  refreshToken: string
  user: User
}

const AUTH_KEY = 'sw.auth'
const DEVICE_KEY = 'sw.device'

const read = (): AuthState | null => {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) ?? 'null')
  } catch {
    return null
  }
}
let auth: AuthState | null = read()
const listeners = new Set<() => void>()

export const getAuth = () => auth
export const subscribeAuth = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
export function setAuth(next: AuthState | null) {
  auth = next
  try {
    if (next) localStorage.setItem(AUTH_KEY, JSON.stringify(next))
    else localStorage.removeItem(AUTH_KEY)
  } catch {
    /* storage unavailable: session lives in memory only */
  }
  listeners.forEach((l) => l())
}

export function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return 'volatile-' + Math.random().toString(36).slice(2, 12)
  }
}

export class ApiError extends Error {
  code: string
  status: number
  extra: Record<string, unknown>
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.code = code
    this.extra = extra
  }
}

let refreshing: Promise<boolean> | null = null
async function refreshTokens(): Promise<boolean> {
  if (!auth) return false
  refreshing ??= (async () => {
    try {
      const r = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-device-id': deviceId() },
        body: JSON.stringify({ refreshToken: auth!.refreshToken }),
      })
      if (!r.ok) return false
      const j = await r.json()
      setAuth({ accessToken: j.accessToken, refreshToken: j.refreshToken, user: j.user })
      return true
    } catch {
      return true // network trouble is not a reason to sign the cashier out
    } finally {
      setTimeout(() => (refreshing = null), 0)
    }
  })()
  return refreshing
}

interface Opts {
  method?: string
  body?: unknown
  headers?: Record<string, string>
  anonymous?: boolean
  /** Polling that must not count as user activity for the inactivity timeout. */
  background?: boolean
}

export async function api<T = any>(path: string, opts: Opts = {}, retried = false): Promise<T> {
  let res: Response
  try {
    res = await fetch('/api' + path, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers: {
        'content-type': 'application/json',
        'x-device-id': deviceId(),
        ...(auth && !opts.anonymous ? { authorization: `Bearer ${auth.accessToken}` } : {}),
        ...(opts.background ? { 'x-background': '1' } : {}),
        ...opts.headers,
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server')
  }
  if (res.status === 401 && !opts.anonymous && !retried && auth) {
    if (await refreshTokens()) return api<T>(path, opts, true)
    setAuth(null)
  }
  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* non-JSON error page from a proxy */
  }
  if (!res.ok) {
    if (res.status === 401 && !opts.anonymous) setAuth(null)
    const e = json?.error
    const { code, message, ...extra } = e ?? {}
    throw new ApiError(res.status, code ?? 'HTTP_' + res.status, message ?? `Server error (${res.status})`, extra)
  }
  return json as T
}

export async function login(username: string, password: string) {
  const j = await api('/auth/login', { body: { username, password }, anonymous: true })
  setAuth({ accessToken: j.accessToken, refreshToken: j.refreshToken, user: j.user })
  return j.user as User
}
export async function logout() {
  try {
    await api('/auth/logout', { body: {} })
  } catch {
    /* already signed out */
  }
  setAuth(null)
}
