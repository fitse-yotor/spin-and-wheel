import { Router } from 'express'
import { authOf, authenticate, ctxOf, login, logout, rateLimit, refresh } from '../auth.ts'
import { get } from '../db.ts'
import { buildState, displayAllowed, verifyGame } from '../game.ts'
import { ApiError } from '../util.ts'

export const publicApi = Router()

publicApi.get('/health', (_req, res) => {
  get('SELECT 1')
  res.json({ ok: true, time: Date.now() })
})

// Game state snapshot (the WebSocket carries the same payload; this is the fallback and clock-sync source)
publicApi.get('/public/state', (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json(buildState(Date.now(), req.query.role === 'display' && displayAllowed(req.query.key)))
})

// Anyone can audit a finished round: commitment published up-front, seed revealed after settlement.
publicApi.get('/public/games/:id/verify', (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) throw new ApiError(400, 'BAD_INPUT', 'Invalid game id')
  res.json(verifyGame(id))
})

publicApi.post('/auth/login', rateLimit('login', 10, 60_000), (req, res) => {
  const { username, password } = req.body ?? {}
  if (typeof username !== 'string' || typeof password !== 'string') throw new ApiError(400, 'BAD_INPUT', 'Enter your username and password')
  res.json(login(username, password, req))
})
publicApi.post('/auth/refresh', rateLimit('refresh', 60, 60_000), (req, res) => {
  if (typeof req.body?.refreshToken !== 'string') throw new ApiError(400, 'BAD_INPUT', 'Missing refresh token')
  res.json(refresh(req.body.refreshToken, req))
})
publicApi.post('/auth/logout', authenticate, (req, res) => {
  logout(authOf(res).sessionId, ctxOf(req, res))
  res.json({ ok: true })
})
publicApi.get('/auth/me', authenticate, (_req, res) => res.json({ user: authOf(res) }))
