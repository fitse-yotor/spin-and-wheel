import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { randomToken, setSecretLookup } from './util.ts'

const DB_PATH = process.env.DB_PATH ?? 'data/spinwheel.db'
if (DB_PATH !== ':memory:') mkdirSync(dirname(DB_PATH), { recursive: true })

export const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;')

// Every money amount is an INTEGER number of santim (1 ETB = 100 santim).
// Odds are INTEGER hundredths (2.00x = 200). No floating point touches money.
db.exec(`
CREATE TABLE IF NOT EXISTS configuration (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by INTEGER
);
CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS companies (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS regions (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS shops (
  id INTEGER PRIMARY KEY, region_id INTEGER NOT NULL REFERENCES regions(id),
  code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
  manager_user_id INTEGER, status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED')),
  opening_balance INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','MANAGER','CASHIER')),
  shop_id INTEGER REFERENCES shops(id), cashier_code TEXT,
  password_hash TEXT NOT NULL, pin_hash TEXT NOT NULL, phone_enc TEXT,
  shift_label TEXT NOT NULL DEFAULT 'FULL', payout_limit INTEGER NOT NULL DEFAULT 5000000,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  failed_logins INTEGER NOT NULL DEFAULT 0, failed_pins INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, last_login_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), refresh_hash TEXT NOT NULL UNIQUE,
  device_id TEXT, ip TEXT, user_agent TEXT, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, shop_id INTEGER, label TEXT, last_user_id INTEGER, last_ip TEXT,
  user_agent TEXT, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE IF NOT EXISTS wheels (id INTEGER PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS wheel_segments (
  id INTEGER PRIMARY KEY, wheel_id INTEGER NOT NULL REFERENCES wheels(id), number INTEGER NOT NULL,
  name TEXT NOT NULL, category TEXT NOT NULL, multiplier_x100 INTEGER NOT NULL CHECK (multiplier_x100 >= 100),
  active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL, UNIQUE (wheel_id, number)
);
CREATE TABLE IF NOT EXISTS bet_markets (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, kind TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS bet_options (
  id INTEGER PRIMARY KEY, market_id INTEGER NOT NULL REFERENCES bet_markets(id), code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL, segment_numbers TEXT NOT NULL, odds_x100 INTEGER NOT NULL CHECK (odds_x100 >= 100),
  odds_source TEXT NOT NULL DEFAULT 'FIXED' CHECK (odds_source IN ('FIXED','SEGMENT')),
  tone TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('BETTING_OPEN','BETTING_CLOSED','SPINNING','RESULT','COMPLETED')),
  created_at INTEGER NOT NULL, opens_at INTEGER NOT NULL, closes_at INTEGER NOT NULL, spin_at INTEGER NOT NULL,
  result_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
  wheel_snapshot TEXT NOT NULL, timing_snapshot TEXT NOT NULL,
  seed TEXT NOT NULL, seed_commitment TEXT NOT NULL,
  settled_at INTEGER, completed_at INTEGER,
  ticket_count INTEGER NOT NULL DEFAULT 0, total_stake INTEGER NOT NULL DEFAULT 0, total_winnings INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS game_results (
  id INTEGER PRIMARY KEY, game_id INTEGER NOT NULL UNIQUE REFERENCES games(id),
  segment_number INTEGER NOT NULL, segment_index INTEGER NOT NULL, category TEXT NOT NULL, multiplier_x100 INTEGER NOT NULL,
  generated_at INTEGER NOT NULL, result_hash TEXT NOT NULL, server_id TEXT NOT NULL, audit_ref TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cashier_shifts (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), shop_id INTEGER NOT NULL REFERENCES shops(id),
  opened_at INTEGER NOT NULL, closed_at INTEGER, opening_float INTEGER NOT NULL,
  counted_cash INTEGER, expected_cash INTEGER, difference INTEGER,
  sales INTEGER, cancellations INTEGER, payouts INTEGER, adjustments INTEGER,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')), close_note TEXT,
  reconciled_by INTEGER, reconciled_at INTEGER, reconcile_note TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_shift_per_user ON cashier_shifts(user_id) WHERE status = 'OPEN';

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY, ticket_number TEXT NOT NULL UNIQUE, secure_ref TEXT NOT NULL UNIQUE, verify_code TEXT NOT NULL,
  game_id INTEGER NOT NULL REFERENCES games(id), shop_id INTEGER NOT NULL REFERENCES shops(id),
  cashier_id INTEGER NOT NULL REFERENCES users(id), shift_id INTEGER NOT NULL REFERENCES cashier_shifts(id),
  status TEXT NOT NULL CHECK (status IN ('DRAFT','ACTIVE','BETTING_CLOSED','PENDING_RESULT','WON','LOST','CANCELLED','EXPIRED','PAID')),
  total_stake INTEGER NOT NULL CHECK (total_stake > 0), max_win INTEGER NOT NULL, actual_win INTEGER,
  age_confirmed INTEGER NOT NULL DEFAULT 0, device_id TEXT, ip TEXT, created_at INTEGER NOT NULL,
  settled_at INTEGER, expires_at INTEGER, cancelled_at INTEGER, cancelled_by INTEGER,
  paid_at INTEGER, paid_by INTEGER, paid_amount INTEGER, print_count INTEGER NOT NULL DEFAULT 1, idem_key TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS tickets_idem ON tickets(cashier_id, idem_key) WHERE idem_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS tickets_game ON tickets(game_id);
CREATE INDEX IF NOT EXISTS tickets_shop_created ON tickets(shop_id, created_at);
CREATE INDEX IF NOT EXISTS tickets_cashier_created ON tickets(cashier_id, created_at);
CREATE INDEX IF NOT EXISTS tickets_status ON tickets(status);

CREATE TABLE IF NOT EXISTS ticket_selections (
  id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL REFERENCES tickets(id), option_id INTEGER NOT NULL,
  market_name TEXT NOT NULL, option_label TEXT NOT NULL, segment_numbers TEXT NOT NULL,
  stake INTEGER NOT NULL CHECK (stake > 0), odds_x100 INTEGER NOT NULL, possible_win INTEGER NOT NULL,
  is_win INTEGER, win_amount INTEGER
);
CREATE INDEX IF NOT EXISTS selections_ticket ON ticket_selections(ticket_id);
CREATE TABLE IF NOT EXISTS ticket_settlements (
  id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL UNIQUE REFERENCES tickets(id), game_id INTEGER NOT NULL,
  result_number INTEGER NOT NULL, outcome TEXT NOT NULL, win_amount INTEGER NOT NULL, settled_at INTEGER NOT NULL, audit_ref TEXT
);
CREATE TABLE IF NOT EXISTS payouts (
  id INTEGER PRIMARY KEY, ref TEXT NOT NULL UNIQUE, ticket_id INTEGER NOT NULL UNIQUE REFERENCES tickets(id),
  shop_id INTEGER NOT NULL, cashier_id INTEGER NOT NULL, shift_id INTEGER NOT NULL, amount INTEGER NOT NULL CHECK (amount > 0),
  approved_by INTEGER, created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wallets (shop_id INTEGER PRIMARY KEY REFERENCES shops(id), balance INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS financial_transactions (
  id INTEGER PRIMARY KEY, ref TEXT NOT NULL UNIQUE, shop_id INTEGER NOT NULL REFERENCES shops(id), shift_id INTEGER,
  user_id INTEGER, type TEXT NOT NULL CHECK (type IN ('OPENING_BALANCE','TICKET_SALE','TICKET_CANCEL','PAYOUT','ADJUSTMENT','DEPOSIT','WITHDRAWAL','REVERSAL')),
  amount INTEGER NOT NULL, balance_after INTEGER NOT NULL, ticket_id INTEGER, game_id INTEGER, reverses_id INTEGER UNIQUE,
  note TEXT, created_at INTEGER NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fin_shop_created ON financial_transactions(shop_id, created_at);
CREATE INDEX IF NOT EXISTS fin_shift ON financial_transactions(shift_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, actor_id INTEGER, actor_role TEXT, shop_id INTEGER,
  action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, ip TEXT, device_id TEXT, details TEXT NOT NULL,
  prev_hash TEXT NOT NULL, hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_ts ON audit_logs(ts);
CREATE INDEX IF NOT EXISTS audit_entity ON audit_logs(entity, entity_id);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, severity TEXT NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL,
  shop_id INTEGER, user_id INTEGER, details TEXT, status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','REVIEWED','REPORTED','DISMISSED')),
  reviewed_by INTEGER, reviewed_at INTEGER, review_note TEXT
);

-- Immutability: ledger, audit trail and generated results can never be edited or deleted.
CREATE TRIGGER IF NOT EXISTS fin_no_update BEFORE UPDATE ON financial_transactions BEGIN SELECT RAISE(ABORT, 'financial_transactions is append-only'); END;
CREATE TRIGGER IF NOT EXISTS fin_no_delete BEFORE DELETE ON financial_transactions BEGIN SELECT RAISE(ABORT, 'financial_transactions is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
CREATE TRIGGER IF NOT EXISTS result_no_update BEFORE UPDATE ON game_results BEGIN SELECT RAISE(ABORT, 'game_results is immutable'); END;
CREATE TRIGGER IF NOT EXISTS result_no_delete BEFORE DELETE ON game_results BEGIN SELECT RAISE(ABORT, 'game_results is immutable'); END;
-- A confirmed ticket cannot be modified (only its lifecycle columns may change) or deleted.
CREATE TRIGGER IF NOT EXISTS ticket_frozen BEFORE UPDATE OF ticket_number, secure_ref, verify_code, game_id, shop_id, cashier_id, shift_id, total_stake, max_win, created_at ON tickets BEGIN SELECT RAISE(ABORT, 'confirmed tickets cannot be modified'); END;
CREATE TRIGGER IF NOT EXISTS ticket_no_delete BEFORE DELETE ON tickets BEGIN SELECT RAISE(ABORT, 'tickets cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS selection_frozen BEFORE UPDATE OF ticket_id, option_id, segment_numbers, stake, odds_x100, possible_win ON ticket_selections BEGIN SELECT RAISE(ABORT, 'ticket selections cannot be modified'); END;
CREATE TRIGGER IF NOT EXISTS selection_no_delete BEFORE DELETE ON ticket_selections BEGIN SELECT RAISE(ABORT, 'ticket selections cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS payout_no_change BEFORE UPDATE ON payouts BEGIN SELECT RAISE(ABORT, 'payouts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS payout_no_delete BEFORE DELETE ON payouts BEGIN SELECT RAISE(ABORT, 'payouts are immutable'); END;
`)

// ─── Second game (dog race): additive columns, applied to new and existing databases alike ──
function ensureColumn(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`)
}
ensureColumn('games', 'game_type', "TEXT NOT NULL DEFAULT 'WHEEL'")
ensureColumn('game_results', 'result_json', 'TEXT') // dog race: full finishing order, e.g. [3,5,1,2,4,6]
ensureColumn('ticket_selections', 'rule', 'TEXT') // dog race: bet code such as WIN:3 or FC:3-5 (wheel bets keep segment_numbers)
db.exec(`
CREATE INDEX IF NOT EXISTS games_type_status ON games(game_type, status);
DROP TRIGGER IF EXISTS selection_frozen;
CREATE TRIGGER selection_frozen BEFORE UPDATE OF ticket_id, option_id, segment_numbers, rule, stake, odds_x100, possible_win ON ticket_selections BEGIN SELECT RAISE(ABORT, 'ticket selections cannot be modified'); END;
`)

// ─── Helpers ────────────────────────────────────────────────────────────────
export type Row = any
export const all = <T = Row>(sql: string, ...p: any[]): T[] => db.prepare(sql).all(...p) as T[]
export const get = <T = Row>(sql: string, ...p: any[]): T | undefined => db.prepare(sql).get(...p) as T | undefined
export const run = (sql: string, ...p: any[]) => db.prepare(sql).run(...p)

let depth = 0
/** Runs fn in one atomic write transaction. Any throw rolls everything back. */
export function tx<T>(fn: () => T): T {
  if (depth > 0) return fn()
  db.exec('BEGIN IMMEDIATE')
  depth++
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (e) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* already rolled back */
    }
    throw e
  } finally {
    depth--
  }
}

export function nextCounter(name: string): number {
  run('INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1', name)
  return get<{ value: number }>('SELECT value FROM counters WHERE name = ?', name)!.value
}

// Secrets generated on first boot (JWT signing key, field-encryption key)
setSecretLookup((name) => {
  const key = `secret.${name}`
  const row = get<{ value: string }>('SELECT value FROM configuration WHERE key = ?', key)
  if (row) return JSON.parse(row.value)
  const v = randomToken(48)
  run('INSERT INTO configuration (key, value, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(v), Date.now())
  return v
})
