import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { randomBytes } from 'node:crypto'
import { allRules, DOGS, oddsTable, parseRule, permProbabilities, permutations, ruleWins, worstCase } from '../shared/rules.ts'
import { drawOrder, makeRaceSnapshot, raceCommitment } from './race.ts'

const seed = () => randomBytes(32).toString('hex')

describe('dog race rules', () => {
  it('has 720 finishing orders whose probabilities sum to exactly 1', () => {
    assert.equal(permutations().length, 720)
    const sum = permProbabilities([10, 20, 30, 15, 25, 40]).reduce((a, b) => a + b, 0)
    assert.ok(Math.abs(sum - 1) < 1e-12, `sum ${sum}`)
  })

  it('offers 57 bets and rejects malformed or non-canonical codes', () => {
    assert.equal(allRules().length, 6 + 6 + 30 + 15)
    for (const bad of ['WIN:0', 'WIN:7', 'WIN:1-2', 'FC:3', 'FC:3-3', 'QN:5-3', 'PLACE:', 'win:1', 'TRI:1-2-3', '']) assert.equal(parseRule(bad), null, bad)
    assert.deepEqual(parseRule('FC:3-5'), { kind: 'FC', dogs: [3, 5] })
  })

  it('settles each bet type against a finishing order', () => {
    const order = [3, 5, 1, 2, 4, 6]
    assert.ok(ruleWins('WIN:3', order) && !ruleWins('WIN:5', order))
    assert.ok(ruleWins('PLACE:1', order) && !ruleWins('PLACE:2', order))
    assert.ok(ruleWins('FC:3-5', order) && !ruleWins('FC:5-3', order))
    assert.ok(ruleWins('QN:3-5', order) && ruleWins('QN:3-5', [5, 3, 1, 2, 4, 6]) && !ruleWins('QN:1-3', order))
  })

  it('worst case is the best single finishing order, not the sum of every bet', () => {
    // WIN 1 and WIN 2 can never both win: exposure is the larger payout, not 300
    assert.equal(worstCase([{ rule: 'WIN:1', payout: 100 }, { rule: 'WIN:2', payout: 200 }]), 200)
    // WIN 1 + PLACE 1 + FC 1-2 all win together when 1 then 2 finish first
    assert.equal(worstCase([{ rule: 'WIN:1', payout: 100 }, { rule: 'PLACE:1', payout: 50 }, { rule: 'FC:1-2', payout: 1000 }]), 1150)
  })
})

describe('odds are honest', () => {
  const weights = [10, 22, 40, 18, 30, 12]

  it('every bet pays at (100 − margin)% of its true probability, never better', () => {
    const margin = 10
    const table = oddsTable(weights, margin)
    const probs = permProbabilities(weights)
    const truth = (rule: string) => permutations().reduce((a, o, i) => a + (ruleWins(rule, o) ? probs[i] : 0), 0)
    for (const rule of allRules()) {
      const rtp = (table[rule] / 100) * truth(rule)
      assert.ok(rtp <= 0.9 + 1e-6, `${rule} returns ${(rtp * 100).toFixed(2)}%`) // flooring only ever favours the house
      if (table[rule] > 101 && table[rule] < 50_000) assert.ok(rtp > 0.85, `${rule} returns only ${(rtp * 100).toFixed(2)}%`) // and never by much
    }
  })

  it('the strongest dog has the shortest win odds; win probabilities equal strength shares', () => {
    const t = oddsTable(weights, 10)
    const shortest = Math.min(...[1, 2, 3, 4, 5, 6].map((d) => t[`WIN:${d}`]))
    assert.equal(t['WIN:3'], shortest)
    const total = weights.reduce((a, b) => a + b, 0)
    assert.equal(t['WIN:3'], Math.floor(90 / (40 / total)))
  })
})

describe('race draw', () => {
  it('is reproducible from the seed and a valid full ordering', () => {
    const s = seed()
    const w = [10, 22, 40, 18, 30, 12]
    const a = drawOrder(s, 1_000_000_001, w)
    assert.deepEqual(a, drawOrder(s, 1_000_000_001, w))
    assert.deepEqual([...a].sort(), [1, 2, 3, 4, 5, 6])
  })

  it('winners follow the published strengths (chi-square)', () => {
    const w = [10, 22, 40, 18, 30, 12]
    const total = w.reduce((a, b) => a + b, 0)
    const n = 60_000
    const counts = new Array(6).fill(0)
    for (let i = 0; i < n; i++) counts[drawOrder(seed(), i + 1, w)[0] - 1]++
    const chi = counts.reduce((a, c, i) => a + (c - (n * w[i]) / total) ** 2 / ((n * w[i]) / total), 0)
    // 5 degrees of freedom: 99.9th percentile ≈ 20.5
    assert.ok(chi < 20.5, `chi-square ${chi.toFixed(1)}`)
  })

  it('the second place follows the strengths of the dogs that are left', () => {
    const w = [10, 22, 40, 18, 30, 12]
    const total = w.reduce((a, b) => a + b, 0)
    const n = 60_000
    let pairs = 0
    for (let i = 0; i < n; i++) {
      const o = drawOrder(seed(), i + 1, w)
      if (o[0] === 3 && o[1] === 5) pairs++
    }
    const expected = (40 / total) * (30 / (total - 40))
    assert.ok(Math.abs(pairs / n - expected) < 0.006, `${(pairs / n).toFixed(4)} vs ${expected.toFixed(4)}`)
  })

  it('the commitment changes if either the seed or a strength is altered', () => {
    const s = seed()
    const w = [10, 22, 40, 18, 30, 12]
    const c = raceCommitment(s, w)
    assert.notEqual(c, raceCommitment(seed(), w))
    assert.notEqual(c, raceCommitment(s, [...w.slice(0, 5), 13]))
  })

  it('each round gets fresh strengths in the allowed range and consistent odds', () => {
    const snap = makeRaceSnapshot(['A', 'B', 'C', 'D', 'E', 'F'], 10)
    assert.equal(snap.dogs.length, DOGS)
    assert.ok(snap.dogs.every((d) => d.weight >= 10 && d.weight <= 40))
    assert.deepEqual(snap.odds, oddsTable(snap.dogs.map((d) => d.weight), 10))
  })
})
