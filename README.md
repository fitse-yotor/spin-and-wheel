# Spin & Wheel — physical-shop betting platform

Retail Spin & Wheel game — plus a **dog race** as a second game (see `dog race/README.md`) — for licensed betting shops. Players bet in cash (ETB) at a cashier, watch the wheel on
a shop display, and return to the cashier to redeem winning tickets. One central server runs the game; shops
are terminals.

| Surface | URL | Who |
|---|---|---|
| Game display (full screen, no controls, **no sign-in**) | `/` (also `/display`; `?shop=BOLE01` labels a shop for presence, `F` = full screen) | customers |
| Dog race shop screen (public, same rules as the wheel screen) | `/dogs` (press **G** to switch screens) | customers |
| Cashier terminal (own sign-in, then Ticket / Check / Cashbook / Results; switch Wheel ⇄ Dog Race in the banner) | `/cashier` | cashiers |
| Back office (own sign-in) | `/admin` | administrators, shop managers |

The first page is always the game. There is no player login. `/cashier` and `/admin` each show their own sign-in
until a user with the right role is signed in, and refuse the other role's account.

## Run it

Needs Node 22.13+ (uses the built-in `node:sqlite`, no native builds).

```bash
pnpm install
pnpm dev:server     # API + WebSocket + game engine on :8787 (creates data/spinwheel.db and demo data on first run)
pnpm dev            # frontend on :8443, proxies /api and /ws to the server
pnpm test           # 57 tests incl. dog race: RNG fairness, booking, settlement, payout, RBAC, sessions, ledger integrity
pnpm typecheck
pnpm backup         # consistent online DB snapshot -> data/backups (also runs every 6 h while the server is up)
```

Demo accounts (development only, shown on the login page in dev): `admin/admin1234` (PIN 9999),
`manager.bole/manager1234` (PIN 5555), `cashier.bole1/cashier1234` (PIN 1111). Shops: Bole 01, Megenagna 01, Piassa 01.

Default game (all editable in the back office): a 37-pocket European wheel in physical order, sectors A–F, and the
markets shown on the cashier screen. Numbers x36, sectors x6, dozens x3, odd/even, colours and low/high x2,
low/high colours x4, mirrors x18, twins x12. Every bet has the same 97.3% theoretical return.
Set `SEED_ADMIN_PASSWORD` before first run anywhere real, and change every seeded credential.

## How a ticket moves

`Cashier books (server validates round still open, limits, shift) → ticket + selections + ledger sale entry + audit,
all in one transaction → receipt printed (QR + barcode) → betting closes on the server clock → result generated →
wheel spins on every display → result shown → tickets settled automatically → player returns → cashier scans or
types the ticket → WON/LOST/PENDING/CANCELLED/ALREADY PAID/EXPIRED → payout (PIN + verification) → ticket PAID.`

Ticket statuses: `ACTIVE → BETTING_CLOSED → PENDING_RESULT → WON | LOST → PAID`, plus `CANCELLED` (only while betting is
open) and `EXPIRED` (unclaimed winner after the validity period). `DRAFT` exists only as the unsaved cart on the POS:
a draft is never stored server-side, so there is nothing to modify after confirmation.

Round lifecycle (all timings configurable, applied from the next round): betting open (45 s, big-digit countdown for
the last 10 s) → betting closed (3 s) → wheel spin (10 s) → result shown (8 s) → tickets settled → next round starts.
The whole timeline is stored as absolute timestamps on the round, so a server restart or a slow tick simply catches up.

## Design decisions that matter

**Money.** Integer santim (1 ETB = 100) everywhere; odds are integer hundredths. No floating point touches money.
Stakes must be whole ETB. Payout = `floor(stake × odds)`.

**Server is the only authority.** The round closes at `closes_at` on the *server* clock; `bookTicket` re-checks it
inside the write transaction, so a request that arrives 1 ms late is rejected even if the UI still looked open. Browsers
only display a countdown derived from server timestamps.

**Result generation and audit.** Each round draws a 32-byte seed from the OS CSPRNG. `sha256(seed)` is published when
the round opens; the seed is revealed at settlement. The winning segment is `HMAC-SHA256(seed, gameId‖counter)` with
rejection sampling (unbiased), so anyone can re-derive it: `GET /api/public/games/:id/verify`. Every active segment
has exactly equal probability; nothing about sales, cashiers or shops feeds in. Stored per round: result, generation
timestamp, result hash, settlement timestamp, server ID, audit reference. The result table is immutable (DB triggers).
Displays receive the result only once betting has closed; POS terminals only when it is on screen. Set `DISPLAY_KEY`
to require a key (`/display?key=…`) for the early feed.

**Possible win.** Shown as the *best single outcome* across the wheel, not the naive sum of every selection. Bets on
RED and BLACK can never both win, so summing them would overstate exposure. The maximum-payout limit is checked
against this figure.

**Ledger.** `financial_transactions` is append-only (triggers reject UPDATE/DELETE) and hash-chained; wallets are a
cached sum that is verified against it. Corrections are reversal entries, never edits. Every entry has a unique
reference. Audit log is append-only and hash-chained too; `/admin/compliance` re-verifies both.

**Idempotent booking.** The POS sends an idempotency key; retries after a network blip return the same ticket instead
of selling twice. If the server can't be reached the POS says the ticket is *not* confirmed and blocks selling. It never
queues offline tickets.

**Payout safety.** Needs the cashier's PIN plus either the scanned QR reference or the printed verification code
(ticket numbers are sequential and guessable). Payouts above a cashier's limit need a manager's PIN. Only the issuing
shop pays. `payouts.ticket_id` is UNIQUE and the status check runs inside the write lock, so double payouts are impossible.

**Sessions.** Short-lived JWT (15 min) + rotating opaque refresh token; 30-minute inactivity limit that only deliberate
actions reset (background polling doesn't); account lockout after 5 wrong passwords or PINs; per-IP rate limits;
device ID + IP recorded; blocked devices refused.

## Requirement map

Built and tested: login · admin dashboard · shops (company → region → shop) · cashiers/managers · POS · wheel
configuration (segments, categories, multipliers, order, active) · markets & odds with per-option hit chance and
theoretical return · round engine · full-screen display · booking · printable receipt with QR + Code128 barcode +
verification code · ticket check & payout · settlement · shifts (float, sales, payouts, expected vs counted cash,
manager reconciliation) · shop ledger (deposit, withdrawal, adjustment, reversal) · reports (sales by date/shop/cashier/
game/region, payouts, games, cashier shifts, shops) with CSV export · live monitoring · audit log · alerts
(failed logins/PINs, large payouts, frequent cancellations, guessed ticket numbers, cash differences, device IP changes)
· limits (min/max stake, ticket, payout, selections) · configurable minimum-age confirmation and responsible-gambling notice.

## Where this differs from the recommended architecture — read before production

* **SQLite, single Node process** instead of PostgreSQL + Redis + NestJS/Next.js. Postgres and Redis weren't available in
  the environment this was built in, and one process removes the need for Redis pub/sub while giving exact ordering.
  It is comfortably enough for dozens of shops but is a single point of failure; scaling out means porting `server/db.ts`
  (all SQL is plain and transaction-scoped) to Postgres and moving the broadcast to Redis. Use the backups and a standby.
* **HTTPS** is done by the provided `deploy/nginx.conf` + `docker-compose.yml` (TLS, WebSocket upgrade, extra rate
  limits). The Docker files have **not been built or run** here. Build and smoke-test them first.
* **Printing** uses the browser's print dialog with an 80 mm receipt stylesheet. For silent printing run the POS browser
  with `--kiosk-printing` and set the thermal printer as default. There is no ESC/POS driver. **Scanning**: USB barcode
  scanners (keyboard wedge) work; camera scanning is not built.
* **Age verification** is a cashier attestation recorded on each ticket. **Self-exclusion** needs player accounts, which
  v1 deliberately doesn't have. **Regulatory reports** are CSV exports; the exact format and filing duties depend on
  the Ethiopian licensing authority and must be confirmed. Alerts are a monitoring aid, not automatic filing.
* Refresh tokens live in browser `localStorage`. Only phone numbers are field-encrypted (AES-256-GCM); use disk
  encryption for the database volume.
* Default limits, odds (~90% return) and expiry (30 days) are placeholders, not legal advice. Set them under
  *Game & limits* to match your licence.
* UI flows were verified with throw-away Playwright scripts; those are not checked in, so there are no automated browser tests yet.

## Layout

```
server/            Node API, WebSocket, game engine (TypeScript, runs natively on Node 24)
  game.ts          RNG, round lifecycle, settlement, public state
  tickets.ts       booking, cancel, check, payout, reprint, shifts
  ledger.ts        the only code that moves money
  db.ts            schema, immutability triggers, transactions
  routes/          pos, admin, reports, public
  test/            node:test suites
src/pages/Display.tsx   customer display (/)     src/pages/pos/     cashier terminal (/cashier)
src/pages/admin/        back office (/admin)      src/pages/StaffLogin.tsx  sign-in for /cashier and /admin               src/components/    wheel, receipt, QR/barcode, UI kit
deploy/, Dockerfile, docker-compose.yml           legacy/            the previous single-player roulette demo
```
