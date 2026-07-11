#!/usr/bin/env node
// Список сохранённых резервных копий с размером, датой и статусом checksum.
// Запуск: npm run db:backup:list

import { readdirSync, statSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { backupDir, isBackupFile, parseBackupDate } from './core.mjs'

const dir = backupDir()
if (!existsSync(dir)) {
  console.log(`Директория backup ещё не создана: ${dir}`)
  process.exit(0)
}

const files = readdirSync(dir).filter(isBackupFile)
if (files.length === 0) {
  console.log(`В ${dir} пока нет резервных копий.`)
  process.exit(0)
}

const rows = files
  .map(name => {
    const path = join(dir, name)
    const size = statSync(path).size
    const date = parseBackupDate(name)
    const sha256Path = path + '.sha256'
    const hasChecksum = existsSync(sha256Path)
    const checksum = hasChecksum ? readFileSync(sha256Path, 'utf8').split(/\s+/)[0] : null
    return { name, size, date, checksum }
  })
  .sort((a, b) => b.date - a.date)

console.log(`Резервные копии в ${dir} (всего: ${rows.length}):\n`)
for (const r of rows) {
  const sizeMb = (r.size / 1024 / 1024).toFixed(2)
  console.log(`${r.name}  —  ${sizeMb} МБ  —  ${r.checksum ? 'sha256 ✓' : 'sha256 ОТСУТСТВУЕТ'}`)
  if (r.checksum) console.log(`  ${r.checksum}`)
}
