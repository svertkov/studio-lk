#!/usr/bin/env node
// Тестовое восстановление backup в ОТДЕЛЬНУЮ (не production) базу — для
// проверки, что дамп реально восстанавливается, а не просто "файл есть".
// Требует TEST_DATABASE_URL — отдельную connection-строку, ЯВНО отличную от
// DATABASE_URL. Если TEST_DATABASE_URL не задана или совпадает с
// DATABASE_URL — скрипт отказывается работать (защита от восстановления
// поверх продовой базы, см. ТЗ: "не восстанавливать backup поверх
// production-базы для проверки").
//
// Запуск: npm run db:restore:test -- studio2470-db-2026-07-01-0300.sql.gz

import { spawnSync } from 'child_process'
import { createReadStream, existsSync } from 'fs'
import { createGunzip } from 'zlib'
import { join, basename } from 'path'
import { backupDir, log, sanitize, pgEnvFromUrl } from './core.mjs'

const arg = process.argv[2]
if (!arg) {
  console.error('Укажите файл: npm run db:restore:test -- <имя-файла>.sql.gz')
  process.exit(1)
}

const databaseUrl = process.env.DATABASE_URL
const testDatabaseUrl = process.env.TEST_DATABASE_URL

if (!testDatabaseUrl) {
  console.error(
    'TEST_DATABASE_URL не задана. Тестовое восстановление требует ОТДЕЛЬНУЮ тестовую базу — ' +
    'создайте её (например, отдельная БД в том же кластере Postgres) и укажите её connection-строку ' +
    'в TEST_DATABASE_URL перед запуском. Продовая DATABASE_URL для этого не подходит.'
  )
  process.exit(1)
}

if (databaseUrl && testDatabaseUrl === databaseUrl) {
  console.error('TEST_DATABASE_URL совпадает с DATABASE_URL — восстановление в production ЗАПРЕЩЕНО этим скриптом. Остановлено.')
  process.exit(1)
}

const dir = backupDir()
const path = join(dir, basename(arg))
if (!existsSync(path)) {
  console.error(`Файл не найден: ${path}`)
  process.exit(1)
}

function pgToolAvailable(bin) {
  return spawnSync(bin, ['--version']).status === 0
}
if (!pgToolAvailable('psql')) {
  console.error('psql не найден в PATH. См. scripts/db-backup/README.md — раздел "Установка pg_dump".')
  process.exit(1)
}

log(`Старт тестового восстановления ${basename(path)} -> TEST_DATABASE_URL`)

const chunks = []
try {
  await new Promise((resolve, reject) => {
    const gunzip = createGunzip()
    createReadStream(path).pipe(gunzip)
    gunzip.on('data', c => chunks.push(c))
    gunzip.on('end', resolve)
    gunzip.on('error', reject)
  })
} catch (e) {
  log(`ПРОВАЛ restore-test: не удалось распаковать файл: ${sanitize(String(e))}`)
  process.exit(1)
}

const sql = Buffer.concat(chunks)
const child = spawnSync('psql', ['--set=ON_ERROR_STOP=1'], { env: pgEnvFromUrl(testDatabaseUrl), input: sql, maxBuffer: 1024 * 1024 * 1024 })

if (child.status !== 0) {
  log(`ПРОВАЛ restore-test: psql завершился с ошибкой (код ${child.status}). ${sanitize(child.stderr?.toString() ?? '')}`)
  process.exit(1)
}

log(`OK restore-test: ${basename(path)} успешно восстановлен в тестовую базу`)
console.log('Восстановление прошло успешно. Продовая база НЕ затронута (использовалась только TEST_DATABASE_URL).')
