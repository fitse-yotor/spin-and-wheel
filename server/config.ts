import { all, get, run } from './db.ts'
import { ApiError } from './util.ts'

/** All money values are santim (1 ETB = 100 santim). */
export const DEFAULTS = {
  'company.name': 'SpinWheel Ethiopia',
  'receipt.footer': 'Keep this ticket for prize collection.',
  'compliance.notice': 'Players must be 18 or older. Gamble responsibly. Help is available: ask the cashier.',
  'compliance.minAge': 18,
  'compliance.largePayout': 5_000_000, // 50,000 ETB — raises a suspicious-activity alert
  'compliance.cancelAlertCount': 3, // cancellations by one cashier per shift before alerting
  'game.bettingSeconds': 45,
  'game.closedSeconds': 3,
  'game.spinSeconds': 10,
  'game.resultSeconds': 8,
  'game.countdownSeconds': 10,
  'game.paused': false,
  // Dog race (second game): own timings, own pause switch
  'dog.bettingSeconds': 60,
  'dog.closedSeconds': 3,
  'dog.raceSeconds': 24,
  'dog.resultSeconds': 10,
  'dog.countdownSeconds': 10,
  'dog.paused': false,
  'dog.marginPercent': 10, // house margin baked into every dog-race price
  'dog.names': ['Abay', 'Tana', 'Awash', 'Omo', 'Simien', 'Gibe'] as string[],
  'limits.minStake': 1_000, // 10 ETB
  'limits.maxSelectionStake': 500_000, // 5,000 ETB
  'limits.maxTicketStake': 2_000_000, // 20,000 ETB
  'limits.maxPayout': 10_000_000, // 100,000 ETB
  'limits.maxSelections': 20,
  'ticket.expiryDays': 30,
  'session.accessMinutes': 15,
  'session.idleMinutes': 30,
  'session.absoluteHours': 12,
  'pos.autoPrint': true,
  'wheel.categoryColors': {
    RED: '#c8161d',
    BLACK: '#16181b',
    GREEN: '#25a244',
    BLUE: '#2f6fbf',
    GOLD: '#e3a80f',
  } as Record<string, string>,
}
export type ConfigKey = keyof typeof DEFAULTS
export type AppConfig = { [K in ConfigKey]: (typeof DEFAULTS)[K] }

let cache: AppConfig | null = null

export function cfg(): AppConfig {
  if (cache) return cache
  const out: Record<string, unknown> = { ...DEFAULTS }
  for (const r of all<{ key: string; value: string }>("SELECT key, value FROM configuration WHERE key NOT LIKE 'secret.%'")) {
    if (r.key in DEFAULTS) out[r.key] = JSON.parse(r.value)
  }
  cache = out as AppConfig
  return cache
}

export function setConfig(updates: Record<string, unknown>, userId: number | null): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  const current = cfg()
  for (const [key, value] of Object.entries(updates)) {
    if (!(key in DEFAULTS)) throw new ApiError(400, 'UNKNOWN_CONFIG', `Unknown setting: ${key}`)
    const def = DEFAULTS[key as ConfigKey]
    if (Array.isArray(def)) {
      if (!Array.isArray(value) || value.length !== def.length || !value.every((v) => typeof v === 'string' && v.trim().length >= 1 && v.length <= 16)) {
        throw new ApiError(400, 'BAD_CONFIG', `${key} must be a list of ${def.length} short names`)
      }
      changes[key] = { from: current[key as ConfigKey], to: value }
      continue
    }
    if (typeof value !== typeof def) throw new ApiError(400, 'BAD_CONFIG', `${key} must be a ${typeof def}`)
    if (typeof def === 'number' && (!Number.isInteger(value) || (value as number) < 0)) {
      throw new ApiError(400, 'BAD_CONFIG', `${key} must be a non-negative whole number`)
    }
    changes[key] = { from: current[key as ConfigKey], to: value }
  }
  const merged = { ...current, ...updates } as AppConfig
  if (merged['limits.minStake'] < 100) throw new ApiError(400, 'BAD_CONFIG', 'Minimum stake must be at least 1 ETB')
  if (merged['limits.minStake'] > merged['limits.maxSelectionStake']) throw new ApiError(400, 'BAD_CONFIG', 'Minimum stake exceeds maximum selection stake')
  if (merged['limits.maxSelectionStake'] > merged['limits.maxTicketStake']) throw new ApiError(400, 'BAD_CONFIG', 'Maximum selection stake exceeds maximum ticket stake')
  if (merged['game.bettingSeconds'] < 5) throw new ApiError(400, 'BAD_CONFIG', 'Betting window must be at least 5 seconds')
  if (merged['game.spinSeconds'] < 3 || merged['game.resultSeconds'] < 2) throw new ApiError(400, 'BAD_CONFIG', 'Spin/result durations are too short')
  if (merged['dog.bettingSeconds'] < 5) throw new ApiError(400, 'BAD_CONFIG', 'Dog race betting window must be at least 5 seconds')
  if (merged['dog.raceSeconds'] < 8 || merged['dog.resultSeconds'] < 3) throw new ApiError(400, 'BAD_CONFIG', 'Race/result durations are too short')
  if (merged['dog.marginPercent'] > 40) throw new ApiError(400, 'BAD_CONFIG', 'Dog race margin cannot exceed 40%')
  const now = Date.now()
  for (const [key, value] of Object.entries(updates)) {
    run(
      'INSERT INTO configuration (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
      key,
      JSON.stringify(value),
      now,
      userId,
    )
  }
  cache = null
  return changes
}

export function invalidateConfig() {
  cache = null
}

export function configRow(key: string) {
  return get('SELECT * FROM configuration WHERE key = ?', key)
}
