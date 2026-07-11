// Общие хелперы для скриптов резервного копирования БД (create/list/verify/
// restore-test/restore-prod) — здесь и только здесь: формат имени файла,
// путь к директории хранения, парсинг DATABASE_URL в переменные окружения
// PG* (не argv — иначе пароль виден в списке процессов `ps aux`), запись в
// журнал. Логика инвалидации кешей приложения тут не нужна — backup работает
// отдельно от Next.js-процесса, читает базу напрямую через pg_dump/psql.

import { mkdirSync, appendFileSync, existsSync, chmodSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'

// Студия работает по московскому времени — расписание (раздел 15 ТЗ:
// "например, в 03:00 по часовому поясу студии") и имена файлов ориентированы
// на него, а не на TZ сервера, где реально исполняется job.
export const STUDIO_TIMEZONE = 'Europe/Moscow'

export function backupDir() {
  // По умолчанию — папка ВНЕ директории проекта (см. AGENTS.md, "Единый
  // источник данных...": критично, чтобы одна-единственная копия backup не
  // лежала на том же диске/в той же папке, что рабочее приложение). Явно
  // настраивается через BACKUP_DIR — например, при переезде на NAS.
  return resolve(process.env.BACKUP_DIR || join(homedir(), 'studio-lk-backups'))
}

export function retentionMonths() {
  const raw = process.env.BACKUP_RETENTION_MONTHS
  const n = raw ? parseInt(raw, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : 12
}

export function ensureBackupDir() {
  const dir = backupDir()
  // 0o700 — только владелец процесса имеет доступ (см. АГЕНТС.md/ТЗ раздел
  // 14: "права только для владельца процесса или администратора").
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  try { chmodSync(dir, 0o700) } catch { /* уже существовала с другими правами — не критично */ }
  return dir
}

export function logPath() {
  return join(ensureBackupDir(), 'backup.log')
}

// Один и тот же санитайзер применяется к ЛЮБОМУ тексту перед записью в лог
// или выводом в консоль — сообщения об ошибках pg_dump/psql иногда включают
// саму connection-строку (с паролем) в текст ошибки. Без этой функции пароль
// от продовой базы мог бы осесть в лог-файле открытым текстом.
export function sanitize(text) {
  return String(text).replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+(@)/gi, '$1***$2')
}

export function log(line) {
  const entry = `[${new Date().toISOString()}] ${sanitize(line)}`
  console.log(entry)
  const file = logPath()
  appendFileSync(file, entry + '\n')
  try { chmodSync(file, 0o600) } catch { /* noop */ }
}

// studio2470-db-2026-07-01-0300.sql.gz — формат имени из ТЗ, время — по
// часовому поясу студии, не по TZ машины, где запущен скрипт.
export function backupFileName(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: STUDIO_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {})
  return `studio2470-db-${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}.sql.gz`
}

// Разбирает DATABASE_URL в набор переменных окружения PG* для дочернего
// процесса pg_dump/psql — сам pg_dump тоже умеет принимать connection-строку
// напрямую первым аргументом, но тогда пароль был бы виден в `ps aux` всем
// локальным пользователям машины. PG*-переменные окружения этого недостатка
// не имеют (процессное окружение не в списке процессов).
export function pgEnvFromUrl(databaseUrl) {
  const url = new URL(databaseUrl)
  const sslmode = url.searchParams.get('sslmode')
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.replace(/^\//, ''),
    ...(sslmode ? { PGSSLMODE: sslmode } : {}),
  }
}

export function requireDatabaseUrl(varName = 'DATABASE_URL') {
  const value = process.env[varName]
  if (!value) {
    console.error(`Переменная окружения ${varName} не задана. Убедитесь, что .env.local загружен ` +
      `(например: set -a && source .env.local && set +a) перед запуском скрипта.`)
    process.exit(1)
  }
  return value
}

export function isBackupFile(name) {
  return /^studio2470-db-\d{4}-\d{2}-\d{2}-\d{4}\.sql\.gz$/.test(name)
}

export function parseBackupDate(name) {
  const m = name.match(/^studio2470-db-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})\.sql\.gz$/)
  if (!m) return null
  const [, y, mo, d, h, mi] = m
  // Компоненты уже в STUDIO_TIMEZONE (см. backupFileName) — здесь достаточно
  // грубой даты для сортировки/retention, точная TZ-математика не нужна.
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:00`)
}

export { existsSync }
