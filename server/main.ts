import { createServer } from 'node:http'
import { tick } from './game.ts'
import { scheduleBackups } from './backup.ts'
import { createApp } from './index.ts'
import { attachRealtime } from './realtime.ts'
import { seedIfEmpty } from './seed.ts'

const port = Number(process.env.SERVER_PORT ?? 8787)
if (seedIfEmpty()) console.log('[seed] Demo data created. Sign in as admin / admin1234 (change before production).')
tick()
const server = createServer(createApp())
attachRealtime(server)
scheduleBackups()
server.listen(port, '0.0.0.0', () => console.log(`[server] Spin & Wheel API + WebSocket on http://localhost:${port}`))
const stop = () => {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 2000).unref()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
