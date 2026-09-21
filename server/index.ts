import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'
import { authenticate, rateLimit } from './auth.ts'
import { admin } from './routes/admin.ts'
import { pos } from './routes/pos.ts'
import { publicApi } from './routes/public.ts'
import { reports } from './routes/reports.ts'
import { ApiError } from './util.ts'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  if (process.env.TRUST_PROXY) app.set('trust proxy', 1)

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    if (process.env.TRUST_PROXY) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    next()
  })
  app.use('/api', express.json({ limit: '64kb' }), rateLimit('api', 900, 60_000))
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })

  app.use('/api', publicApi)
  app.use('/api/pos', authenticate, pos)
  app.use('/api', authenticate, admin)
  app.use('/api', authenticate, reports)
  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'Unknown endpoint')))

  // Production: serve the built frontend from the same origin
  const dist = resolve('dist')
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }))
    // SPA fallback for page routes only; a missing asset must be a real 404
    app.get('/{*splat}', (req, res, next) => (/\.[a-z0-9]+$/i.test(req.path) ? next() : void res.sendFile(resolve(dist, 'index.html'))))
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      return void res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.extra } })
    }
    if ((err as { type?: string })?.type === 'entity.parse.failed') {
      return void res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed request body' } })
    }
    const msg = err instanceof Error ? err.message : String(err)
    // Database constraint failures are business-rule violations, not server crashes.
    if (/append-only|immutable|cannot be modified|cannot be deleted/.test(msg)) {
      return void res.status(409).json({ error: { code: 'IMMUTABLE', message: 'This record cannot be changed' } })
    }
    console.error('[error]', err)
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on the server' } })
  })
  return app
}
