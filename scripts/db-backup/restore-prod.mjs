#!/usr/bin/env node
// Восстановление backup В PRODUCTION — намеренно неудобная, "тяжёлая" команда
// (ТЗ: "команда восстановления production не должна выполняться случайно").
// Требует ОБА условия:
//   1. флаг --yes-i-understand-this-overwrites-production в аргументах;
//   2. интерактивный ввод точной фразы "ВОССТАНОВИТЬ PRODUCTION" в терминале.
// Без интерактивного терминала (cron/CI) команда всегда завершится отказом —
// это осознанно: production restore не должен и не может быть автоматическим.
//
// Запуск: npm run db:restore:prod -- studio2470-db-2026-07-01-0300.sql.gz --yes-i-understand-this-overwrites-production

import { spawnSync } from 'child_process'
import { createReadStream, existsSync } from 'fs'
import { createGunzip } from 'zlib'
import { join, basename } from 'path'
import { createInterface } from 'readline/promises'
import { stdin, stdout } from 'process'
import { backupDir, log, sanitize, pgEnvFromUrl, requireDatabaseUrl } from './core.mjs'

const arg = process.argv[2]
const confirmFlag = process.argv.includes('--yes-i-understand-this-overwrites-production')

if (!arg || !confirmFlag) {
  console.error(
    'Использование: npm run db:restore:prod -- <имя-файла>.sql.gz --yes-i-understand-this-overwrites-production\n' +
    'Оба аргумента обязательны — это намеренная защита от случайного восстановления поверх production.'
  )
  process.exit(1)
}

if (!stdin.isTTY) {
  console.error('Восстановление production доступно только в интерактивном терминале (нужно подтвердить вручную). Остановлено.')
  process.exit(1)
}

const databaseUrl = requireDatabaseUrl()
const dir = backupDir()
const path = join(dir, basename(arg))
if (!existsSync(path)) {
  console.error(`Файл не найден: ${path}`)
  process.exit(1)
}

const rl = createInterface({ input: stdin, output: stdout })
console.log(`ВНИМАНИЕ: это восстановит файл ${basename(path)} ПОВЕРХ PRODUCTION-БАЗЫ. Все данные, изменённые после даты этого backup, будут потеряны.`)
const answer = await rl.question('Введите точную фразу "ВОССТАНОВИТЬ PRODUCTION" для подтверждения: ')
rl.close()

if (answer.trim() !== 'ВОССТАНОВИТЬ PRODUCTION') {
  console.error('Фраза не совпадает — восстановление отменено.')
  process.exit(1)
}

function pgToolAvailable(bin) {
  return spawnSync(bin, ['--version']).status === 0
}
if (!pgToolAvailable('psql')) {
  console.error('psql не найден в PATH. См. scripts/db-backup/README.md.')
  process.exit(1)
}

log(`Старт ВОССТАНОВЛЕНИЯ PRODUCTION из ${basename(path)} (подтверждено вручную)`)

const chunks = []
await new Promise((resolve, reject) => {
  const gunzip = createGunzip()
  createReadStream(path).pipe(gunzip)
  gunzip.on('data', c => chunks.push(c))
  gunzip.on('end', resolve)
  gunzip.on('error', reject)
})

const child = spawnSync('psql', ['--set=ON_ERROR_STOP=1'], { env: pgEnvFromUrl(databaseUrl), input: Buffer.concat(chunks), maxBuffer: 1024 * 1024 * 1024 })

if (child.status !== 0) {
  log(`ПРОВАЛ restore-prod: psql завершился с ошибкой (код ${child.status}). ${sanitize(child.stderr?.toString() ?? '')}`)
  process.exit(1)
}

log(`OK restore-prod: production восстановлен из ${basename(path)}`)
