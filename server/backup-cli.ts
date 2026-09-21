import { backupNow } from './backup.ts'
console.log(`Backup written to ${await backupNow()}`)
