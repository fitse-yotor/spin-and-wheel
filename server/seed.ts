import { audit } from './audit.ts'
import { cfg } from './config.ts'
import { get, run, tx } from './db.ts'
import { postTxn } from './ledger.ts'
import { encrypt, hashSecret } from './util.ts'

// European roulette layout: 37 pockets in physical wheel order, 0 is green.
const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26]
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36])
const categoryOf = (n: number) => (n === 0 ? 'GREEN' : REDS.has(n) ? 'RED' : 'BLACK')
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k)
const ALL = range(1, 36)

export function seedIfEmpty() {
  if (get('SELECT id FROM users LIMIT 1')) return false
  const now = Date.now()
  tx(() => {
    // Company → Region → Shop
    const company = Number(run('INSERT INTO companies (name) VALUES (?)', cfg()['company.name']).lastInsertRowid)
    const region = Number(run('INSERT INTO regions (company_id, name) VALUES (?,?)', company, 'Addis Ababa').lastInsertRowid)
    const shops = [
      { code: 'BOLE01', name: 'Bole 01', address: 'Bole Road, Addis Ababa', phone: '+251 11 000 0101' },
      { code: 'MEG01', name: 'Megenagna 01', address: 'Megenagna Square, Addis Ababa', phone: '+251 11 000 0102' },
      { code: 'PIA01', name: 'Piassa 01', address: 'Churchill Avenue, Addis Ababa', phone: '+251 11 000 0103' },
    ]
    const opening = 50_000_000 // 500,000 ETB starting float per shop
    const shopIds: number[] = []
    for (const s of shops) {
      const id = Number(run('INSERT INTO shops (region_id, code, name, address, phone, opening_balance, created_at) VALUES (?,?,?,?,?,?,?)', region, s.code, s.name, s.address, s.phone, opening, now).lastInsertRowid)
      shopIds.push(id)
      postTxn({ shopId: id, type: 'OPENING_BALANCE', amount: opening, note: 'Opening balance' })
    }

    // Users (demo credentials — change before any real deployment)
    const adminPw = process.env.SEED_ADMIN_PASSWORD ?? 'admin1234'
    const addUser = (username: string, fullName: string, role: string, shopId: number | null, code: string | null, password: string, pin: string, phone: string) =>
      Number(
        run(
          'INSERT INTO users (username, full_name, role, shop_id, cashier_code, password_hash, pin_hash, phone_enc, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
          username, fullName, role, shopId, code, hashSecret(password), hashSecret(pin), encrypt(phone), now,
        ).lastInsertRowid,
      )
    addUser('admin', 'System Administrator', 'ADMIN', null, null, adminPw, '9999', '+251 91 000 0000')
    const staff = [
      { shop: 0, prefix: 'bole', mgr: 'Hana Bekele', cashiers: ['Abel Tesfaye', 'Meron Alemu'] },
      { shop: 1, prefix: 'meg', mgr: 'Dawit Girma', cashiers: ['Selam Haile', 'Yonas Kebede'] },
      { shop: 2, prefix: 'piassa', mgr: 'Liya Mengistu', cashiers: ['Biruk Tadesse'] },
    ]
    for (const st of staff) {
      const shopId = shopIds[st.shop]
      const mid = addUser(`manager.${st.prefix}`, st.mgr, 'MANAGER', shopId, null, 'manager1234', '5555', '+251 92 000 0000')
      run('UPDATE shops SET manager_user_id = ? WHERE id = ?', mid, shopId)
      st.cashiers.forEach((name, i) => addUser(`cashier.${st.prefix}${i + 1}`, name, 'CASHIER', shopId, `Cashier ${String(i + 1).padStart(2, '0')}`, 'cashier1234', '1111', '+251 93 000 0000'))
    }

    // Wheel: 37 pockets, each paying 36x on an exact hit (97.3% theoretical return, the same as every other bet below)
    const wheel = Number(run('INSERT INTO wheels (name) VALUES (?)', 'Main Wheel').lastInsertRowid)
    WHEEL_ORDER.forEach((n, i) => run('INSERT INTO wheel_segments (wheel_id, number, name, category, multiplier_x100, sort_order) VALUES (?,?,?,?,?,?)', wheel, n, String(n), categoryOf(n), 3600, i + 1))

    const market = (code: string, name: string, kind: string, order: number) => Number(run('INSERT INTO bet_markets (code, name, kind, sort_order) VALUES (?,?,?,?)', code, name, kind, order).lastInsertRowid)
    let order = 0
    const option = (m: number, code: string, label: string, nums: number[], odds: number, source = 'FIXED', tone = '') =>
      run('INSERT INTO bet_options (market_id, code, label, segment_numbers, odds_x100, odds_source, tone, sort_order) VALUES (?,?,?,?,?,?,?,?)', m, code, label, JSON.stringify(nums), odds, source, tone, ++order)

    const mExact = market('EXACT', 'Numbers', 'EXACT', 1)
    range(0, 36).forEach((n) => option(mExact, `N${n}`, String(n), [n], 3600, 'SEGMENT', categoryOf(n)))
    // Sectors A–F: six consecutive pockets each on the physical wheel (0 excluded)
    const mSector = market('SECTOR', 'Sectors', 'SECTOR', 2)
    'ABCDEF'.split('').forEach((l, i) => option(mSector, `S_${l}`, l, WHEEL_ORDER.slice(1 + i * 6, 7 + i * 6), 600))
    const mDozen = market('DOZEN', 'Dozens', 'DOZEN', 3)
    ;[[1, 12], [13, 24], [25, 36]].forEach(([a, b]) => option(mDozen, `D_${a}_${b}`, `${a}~${b}`, range(a, b), 300))
    const mParity = market('PARITY', 'Odd / Even', 'PARITY', 4)
    option(mParity, 'EVEN', 'Even', ALL.filter((n) => n % 2 === 0), 200)
    option(mParity, 'ODD', 'Odd', ALL.filter((n) => n % 2 === 1), 200)
    const mColors = market('COLORS', 'Colors', 'CATEGORY', 5)
    option(mColors, 'C_RED', 'Red', ALL.filter((n) => REDS.has(n)), 200, 'FIXED', 'RED')
    option(mColors, 'C_BLACK', 'Black', ALL.filter((n) => !REDS.has(n)), 200, 'FIXED', 'BLACK')
    const mHalf = market('HALF', 'Low / High', 'RANGE', 6)
    option(mHalf, 'H_LOW', '1-18', range(1, 18), 200)
    option(mHalf, 'H_HIGH', '19-36', range(19, 36), 200)
    const mCombo = market('COMBO', 'Low / High Colors', 'RANGE', 7)
    option(mCombo, 'X_LOW_RED', '1-18 (Red)', range(1, 18).filter((n) => REDS.has(n)), 400)
    option(mCombo, 'X_HIGH_RED', '19-36 (Red)', range(19, 36).filter((n) => REDS.has(n)), 400)
    option(mCombo, 'X_LOW_BLACK', '1-18 (Black)', range(1, 18).filter((n) => !REDS.has(n)), 400)
    option(mCombo, 'X_HIGH_BLACK', '19-36 (Black)', range(19, 36).filter((n) => !REDS.has(n)), 400)
    const mMirror = market('MIRROR', 'Mirrors', 'CUSTOM', 8)
    ;[[12, 21], [13, 31], [23, 32]].forEach(([a, b]) => option(mMirror, `M_${a}_${b}`, `${a} & ${b}`, [a, b], 1800))
    const mTwins = market('TWINS', 'Twins', 'CUSTOM', 9)
    option(mTwins, 'T_11_22_33', '11 & 22 & 33', [11, 22, 33], 1200)

    audit('SYSTEM_SEEDED', 'system', null, { shops: shops.length })
  })
  return true
}
