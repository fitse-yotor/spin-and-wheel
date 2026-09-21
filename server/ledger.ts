import { all, get, nextCounter, run } from './db.ts'
import { ApiError, dayKey, pad, sha256 } from './util.ts'

export type TxnType =
  | 'OPENING_BALANCE'
  | 'TICKET_SALE'
  | 'TICKET_CANCEL'
  | 'PAYOUT'
  | 'ADJUSTMENT'
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'REVERSAL'

export interface TxnInput {
  shopId: number
  type: TxnType
  /** Signed santim: positive adds cash to the shop wallet, negative removes it. */
  amount: number
  userId?: number | null
  shiftId?: number | null
  ticketId?: number | null
  gameId?: number | null
  reversesId?: number | null
  note?: string
}

const GENESIS = '0'.repeat(64)

/**
 * The only way money moves. Appends an immutable ledger row and updates the wallet balance.
 * MUST be called inside tx() so the business action and its ledger entry commit or roll back together.
 */
export function postTxn(t: TxnInput): { id: number; ref: string; balanceAfter: number } {
  if (!Number.isSafeInteger(t.amount) || t.amount === 0) throw new ApiError(400, 'BAD_AMOUNT', 'Amount must be a non-zero whole number of santim')
  const now = Date.now()
  const wallet = get<{ balance: number }>('SELECT balance FROM wallets WHERE shop_id = ?', t.shopId)
  const before = wallet?.balance ?? 0
  const after = before + t.amount
  if (after < 0 && t.type !== 'ADJUSTMENT' && t.type !== 'REVERSAL') {
    throw new ApiError(409, 'INSUFFICIENT_FLOAT', 'Shop wallet does not hold enough cash for this transaction')
  }
  if (wallet) run('UPDATE wallets SET balance = ?, updated_at = ? WHERE shop_id = ?', after, now, t.shopId)
  else run('INSERT INTO wallets (shop_id, balance, updated_at) VALUES (?,?,?)', t.shopId, after, now)

  const ref = `TX-${dayKey(now).replaceAll('-', '')}-${pad(nextCounter(`txn:${dayKey(now)}`), 6)}`
  const prev = get<{ hash: string }>('SELECT hash FROM financial_transactions ORDER BY id DESC LIMIT 1')?.hash ?? GENESIS
  const hash = sha256([prev, ref, t.shopId, t.type, t.amount, after, now].join('|'))
  const r = run(
    `INSERT INTO financial_transactions (ref, shop_id, shift_id, user_id, type, amount, balance_after, ticket_id, game_id, reverses_id, note, created_at, prev_hash, hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ref,
    t.shopId,
    t.shiftId ?? null,
    t.userId ?? null,
    t.type,
    t.amount,
    after,
    t.ticketId ?? null,
    t.gameId ?? null,
    t.reversesId ?? null,
    t.note ?? null,
    now,
    prev,
    hash,
  )
  return { id: Number(r.lastInsertRowid), ref, balanceAfter: after }
}

/** Integrity check: every wallet must equal the sum of its ledger rows, and the hash chain must be intact. */
export function verifyLedger(): { ok: boolean; problems: string[] } {
  const problems: string[] = []
  for (const w of all('SELECT w.shop_id, w.balance, COALESCE(SUM(f.amount),0) AS total FROM wallets w LEFT JOIN financial_transactions f ON f.shop_id = w.shop_id GROUP BY w.shop_id')) {
    if (w.balance !== w.total) problems.push(`Shop ${w.shop_id}: wallet ${w.balance} != ledger ${w.total}`)
  }
  let prev = GENESIS
  for (const r of all('SELECT * FROM financial_transactions ORDER BY id ASC')) {
    const expected = sha256([prev, r.ref, r.shop_id, r.type, r.amount, r.balance_after, r.created_at].join('|'))
    if (r.prev_hash !== prev || r.hash !== expected) {
      problems.push(`Ledger chain broken at ${r.ref}`)
      break
    }
    prev = r.hash
  }
  return { ok: problems.length === 0, problems }
}
