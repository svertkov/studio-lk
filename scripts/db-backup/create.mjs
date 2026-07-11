#!/usr/bin/env node
// Полный backup продовой PostgreSQL: pg_dump -> gzip -> SHA-256 -> запись в
// журнал -> удаление копий старше BACKUP_RETENTION_MONTHS. Требует pg_dump в
// PATH (см. README.md рядом с этим файлом). Ничего не удаляет, если сам
// backup не создался или не прошёл проверку целостности (см. раздел
// "Требования" в ТЗ: "не удалять файлы при неуспешном создании новой копии").
//
// Запуск: npm run db:backup

import { spawnSync } from 'child_process'
import { createReadStream, createWriteStream, statSync, readdirSync, unlinkSync, renameSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { createGzip } from 'zlib'
import { pipeline } from 'stream/promises'
import { join } from 'path'
import {
  ensureBackupDir, backupFileName, log, sanitize, pgEnvFromUrl, requireDatabaseUrl,
  isBackupFile, parseBackupDate, retentionMonths,
} from './core.mjs'

async function sha256File(path) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

function pgDumpAvailable() {
  const res = spawnSync('pg_dump', ['--version'])
  return res.status === 0
}

async function createBackup() {
  const databaseUrl = requireDatabaseUrl()
  if (!pgDumpAvailable()) {
    log('ОШИБКА: pg_dump не найден в PATH. См. scripts/db-backup/README.md — раздел "Установка pg_dump".')
    process.exitCode = 1
    return null
  }

  const dir = ensureBackupDir()
  const finalName = backupFileName()
  const finalPath = join(dir, finalName)
  // Пишем во временный файл и переименовываем только после успешной
  // проверки — если процесс упадёт/оборвётся посередине, в директории не
  // останется битого файла с "финальным" именем.
  const tmpPath = finalPath + '.tmp'

  log(`Старт backup -> ${finalName}`)
  const startedAt = Date.now()

  const dumpArgs = [
    '--format=plain',
    '--no-owner',
    '--no-privileges',
    '--no-comments',
  ]
  const child = spawnSync('pg_dump', dumpArgs, { env: pgEnvFromUrl(databaseUrl), maxBuffer: 1024 * 1024 * 1024 })

  if (child.status !== 0 || !child.stdout || child.stdout.length === 0) {
    const stderr = sanitize(child.stderr?.toString() ?? '')
    log(`ОШИБКА: pg_dump завершился с ошибкой (код ${child.status}). ${stderr}`)
    process.exitCode = 1
    return null
  }

  try {
    const gzip = createGzip()
    const out = createWriteStream(tmpPath, { mode: 0o600 })
    gzip.end(child.stdout)
    await pipeline(gzip, out)
  } catch (e) {
    log(`ОШИБКА при сжатии/записи файла: ${sanitize(String(e))}`)
    process.exitCode = 1
    return null
  }

  const size = statSync(tmpPath).size
  if (size === 0) {
    log('ОШИБКА: итоговый файл backup пустой (0 байт) — не сохраняем.')
    try { unlinkSync(tmpPath) } catch { /* noop */ }
    process.exitCode = 1
    return null
  }

  const checksum = await sha256File(tmpPath)
  renameSync(tmpPath, finalPath)
  writeFileSync(finalPath + '.sha256', `${checksum}  ${finalName}\n`, { mode: 0o600 })

  const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1)
  log(`OK: ${finalName} — ${size} байт, sha256=${checksum}, ${durationSec}с`)

  return { path: finalPath, size, checksum }
}

function applyRetention() {
  const dir = ensureBackupDir()
  const months = retentionMonths()
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - months)

  const files = readdirSync(dir).filter(isBackupFile)
  const withDates = files
    .map(name => ({ name, date: parseBackupDate(name) }))
    .filter(f => f.date != null)
    .sort((a, b) => b.date - a.date)

  if (withDates.length === 0) return

  // Даже если retention формально требует удалить всё (например, единственный
  // backup старше срока хранения) — самый свежий успешный backup никогда не
  // удаляется (ТЗ: "не удалять последний успешный backup").
  const [newest, ...rest] = withDates
  const toDelete = rest.filter(f => f.date < cutoff)

  for (const f of toDelete) {
    try {
      unlinkSync(join(dir, f.name))
      try { unlinkSync(join(dir, f.name + '.sha256')) } catch { /* могло не быть */ }
      log(`Retention: удалён устаревший backup ${f.name} (старше ${months} мес.)`)
    } catch (e) {
      log(`Retention: не удалось удалить ${f.name}: ${sanitize(String(e))}`)
    }
  }
  if (toDelete.length === 0) {
    log(`Retention: удалять нечего (порог ${months} мес., самый свежий backup — ${newest.name})`)
  }
}

const result = await createBackup()
if (result) {
  applyRetention()
} else {
  log('Retention пропущен: новый backup не создался (см. ошибку выше). Существующие копии не тронуты.')
}
process.exit(result ? 0 : 1)
