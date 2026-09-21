# Dog race

The platform's second game. It runs beside the wheel with its own rounds, its own numbering (`D00057`), its own
cashier tab, ticket printing, payouts, reports and shop screen (`/dogs`). Tickets, ledger, shifts and audit are shared.

```
dog race/
  shared/rules.ts      pure rules: bet codes, settlement, honest odds, worst-case exposure (server + browser)
  server/race.ts       the draw: strengths, finishing order, commitment, result hash
  server/race.test.ts  fairness and odds tests
  web/                 DogDisplay (shop TV), DogBets (cashier), DogArt (original SVG greyhound), raceMath (motion)
  reference/           Betradar's banner video, for looking at only. NOT used or shipped. See its README.
```
The engine hooks live in `server/game.ts` (round lifecycle, settlement, state) and `server/tickets.ts` (booking).

## How a race works

1. **Round opens.** Six dogs get a *strength* (10–40) from the OS CSPRNG. Strengths and every price are published
   immediately, on the shop TV and the cashier screen, and fixed for the whole round.
2. **Bets** (all stakes whole ETB, same limits as the wheel):

   | Bet | Code | Wins when | Example |
   |---|---|---|---|
   | Win | `WIN:3` | trap 3 finishes 1st | |
   | Place | `PLACE:3` | trap 3 finishes in the top 3 | |
   | Forecast | `FC:3-5` | 3 first **and** 5 second, in that order | 30 combinations |
   | Quinella | `QN:3-5` | 3 and 5 are first and second, either order | 15 combinations |
3. **Betting closes** on the server clock. Only now is the finishing order drawn, from the seed committed when the
   round opened. Displays get it immediately so every screen animates the identical race; cashier terminals get it only
   when it is on screen.
4. **Race, result, settlement, next race**, exactly like the wheel. Tickets settle automatically.

## Fairness and honest prices

* **The draw.** Each place goes to one of the dogs still running with probability `strength / sum of the remaining
  strengths`, using unbiased `HMAC-SHA256(seed, …)` sampling. Nothing about ticket sales, shops or cashiers feeds in.
* **The prices.** The exact probability of every bet is computed from the published strengths over all 720 possible
  finishing orders. The price is `(100 − margin)% ÷ probability`, rounded down (margin default 10%). So the strong dog
  really is shorter, and every bet returns the same ~90% on average. Nothing is hidden: the strength bars on the TV
  are what the draw uses. Odds are capped between 1.01x and 500x.
* **Auditable.** The public commitment is `sha256(seed | strengths)`, so neither can change after betting opens. When a
  race is settled the seed is revealed and anyone can re-derive the order:
  `GET /api/public/games/1000000005/verify` returns the strengths, the finishing order and three checks
  (commitment matches, result reproducible, hash matches). Rounds are numbered from 1,000,000,001 internally and shown as `D00001`.
* **Exposure.** The "possible win" on a ticket is the best single finishing order for the player (a Win and a Forecast on
  the same dogs can both hit; two Wins cannot), checked against the maximum-payout limit.

## Settings (Back office → Game & limits → Dog race)

Timings (default 60 s betting, 3 s closed, 24 s race, 10 s result), house margin, dog names, and a separate pause
switch. The wheel and the race pause independently.

## The shop screen

`/dogs` (press **G** on either shop screen to switch, **F** for full screen). `?shop=BOLE01` labels a screen.
The race is drawn from data every screen receives (finishing order, result hash, server timestamps), so all
screens show the identical race, and one that joins mid-race shows it at the right place.

## Tests

`pnpm test` runs `server/race.test.ts` (fairness against the strengths, odds never better than the margin, settlement of every
bet type, commitment binding) and `server/test/dogs.test.ts` (booking, an exhaustive settlement of all 57 bets on one ticket,
payout, verification, pause, both games at once).

## Not built yet

Tricast and combination bets, several distances/tracks, and per-shop dog names. Betting on a specific finishing
time or margin is deliberately out of scope.
