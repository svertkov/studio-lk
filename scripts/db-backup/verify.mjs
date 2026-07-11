#!/usr/bin/env node
// Проверка целостности одного backup-файла: пересчитывает SHA-256 и сверяет
// с сохранённым .sha256, проверяет что gzip не битый, и что в начале дампа
// есть ожидаемый заголовок pg_dump — без обращения к какой-либо базе.
// Запуск: npm run db:backup:verify -- studio2470-db-2026-07-01-0300.sql.gz

import { createReadStream, readFileSync, existsSync, statSync } from 'fs'
import { createHash } from 'crypto'
import { createGunzip } from 'zlib'
import { pipeline } from 'stream/promises'
import { join, basename } from 'path'
import { backupDir, log, sanitize } from './core.mjs'

const arg = process.argv[2]
if (!arg) {
  console.error('Укажите файл: npm run db:backup:verify -- <имя-файла>.sql.gz')
  process.exit(1)
}

const dir = backupDir()
const path = join(dir, basename(arg))
const sha256Path = path + '.sha256'

if (!existsSync(path)) {
  console.error(`Файл не найден: ${path}`)
  process.exit(1)
}

const size = statSync(path).size
if (size === 0) {
  log(`ПРОВАЛ verify: ${basename(path)} — файл пустой (0 байт)`)
  process.exit(1)
}

async function sha256File(p) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(p), hash)
  return hash.digest('hex')
}

const actualChecksum = await sha256File(path)

let checksumOk = false
if (existsSync(sha256Path)) {
  const expected = readFileSync(sha256Path, 'utf8').trim().split(/\s+/)[0]
  checksumOk = expected === actualChecksum
  if (!checksumOk) {
    log(`ПРОВАЛ verify: ${basename(path)} — checksum не совпадает (ожидался ${expected}, получен ${actualChecksum})`)
  }
} else {
  log(`ПРЕДУПРЕЖДЕНИЕ verify: у ${basename(path)} нет файла .sha256 — сверить не с чем`)
}

// gunzip -t эквивалент: пропускаем поток через gunzip, ничего не сохраняя —
// если архив битый, pipeline упадёт с ошибкой.
let gzipOk = true
try {
  await pipeline(createReadStream(path), createGunzip(), async function* (source) {
    for await (const chunk of source) { void chunk } // поток просто прокачивается, содержимое не нужно
  })
} catch (e) {
  gzipOk = false
  log(`ПРОВАЛ verify: ${basename(path)} — gzip повреждён: ${sanitize(String(e.message ?? e))}`)
}

// Лёгкая проверка "это похоже на реальный дамп pg_dump", без восстановления
// в базу — читаем первые байты после распаковки и ищем стандартный заголовок.
let looksLikeDump = false
if (gzipOk) {
  try {
    const chunks = []
    let total = 0
    await pipeline(createReadStream(path), createGunzip(), async function* (source) {
      for await (const chunk of source) {
        chunks.push(chunk)
        total += chunk.length
        if (total > 4096) break
      }
    })
    const head = Buffer.concat(chunks).toString('utf8', 0, 4096)
    looksLikeDump = head.includes('PostgreSQL database dump') || head.includes('-- Dumped from database')
  } catch { /* уже залогировано выше как gzip-ошибка */ }
}

const ok = checksumOk && gzipOk && looksLikeDump
log(`${ok ? 'OK' : 'ПРОВАЛ'} verify: ${basename(path)} — checksum=${checksumOk ? 'ok' : 'НЕТ'}, gzip=${gzipOk ? 'ok' : 'НЕТ'}, заголовок дампа=${looksLikeDump ? 'ok' : 'НЕТ'}`)
process.exit(ok ? 0 : 1)
