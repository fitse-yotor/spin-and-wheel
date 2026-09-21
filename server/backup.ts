import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { backup } from 'node:sqlite'
import { join } from 'node:path'
import { db } from './db.ts'

const DIR = process.env.BACKUP_DIR ?? 'data/backups'
const KEEP = Number(process.env.BACKUP_KEEP ?? 28)

/** Consistent online snapshot of the database (safe while the server is running). */
export async function backupNow(): Promise<string> {
  mkdirSync(DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)
  const file = join(DIR, `spinwheel-${stamp}.db`)
  await backup(db, file)
  const old = readdirSync(DIR).filter((f) => f.startsWith('spinwheel-')).sort().slice(0, -KEEP)
  for (const f of old) rmSync(join(DIR, f))
  return file
}

export function scheduleBackups(everyHours = Number(process.env.BACKUP_EVERY_HOURS ?? 6)) {
  if (process.env.DB_PATH === ':memory:' || everyHours <= 0) return
  const run = () => backupNow().then((f) => console.log(`[backup] ${f}`)).catch((e) => console.error('[backup] failed', e))
  setTimeout(run, 30_000).unref()
  setInterval(run, everyHours * 3_600_000).unref()
}
