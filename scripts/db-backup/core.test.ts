import { describe, it, expect } from 'vitest'
import { backupFileName, isBackupFile, parseBackupDate, sanitize, pgEnvFromUrl } from './core.mjs'

describe('backupFileName — формат имени файла', () => {
  it('matches studio2470-db-YYYY-MM-DD-HHmm.sql.gz', () => {
    // 2026-07-01 03:00 MSK = 2026-07-01 00:00 UTC (без DST в Москве, UTC+3 круглый год).
    const name = backupFileName(new Date('2026-07-01T00:00:00.000Z'))
    expect(name).toBe('studio2470-db-2026-07-01-0300.sql.gz')
  })

  it('is recognized by isBackupFile', () => {
    expect(isBackupFile(backupFileName(new Date()))).toBe(true)
  })
})

describe('isBackupFile — распознавание имени файла backup', () => {
  it('accepts the canonical format', () => {
    expect(isBackupFile('studio2470-db-2026-07-01-0300.sql.gz')).toBe(true)
  })

  it('rejects unrelated or malformed names', () => {
    expect(isBackupFile('studio2470-db-2026-07-01-0300.sql.gz.sha256')).toBe(false)
    expect(isBackupFile('backup.log')).toBe(false)
    expect(isBackupFile('random-file.sql.gz')).toBe(false)
    expect(isBackupFile('studio2470-db-2026-13-99-9999.sql.gz')).toBe(true) // формат совпадает, календарную валидность не проверяем здесь
  })
})

describe('parseBackupDate — извлечение даты из имени файла (для retention)', () => {
  it('parses a valid backup filename', () => {
    const d = parseBackupDate('studio2470-db-2026-07-01-0300.sql.gz')
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2026)
    expect(d!.getMonth()).toBe(6) // июль — индекс 6
    expect(d!.getDate()).toBe(1)
  })

  it('returns null for a non-matching name', () => {
    expect(parseBackupDate('backup.log')).toBeNull()
  })
})

describe('sanitize — маскирование пароля в логах/ошибках', () => {
  it('masks the password inside a postgres connection string', () => {
    const text = 'connection to postgresql://studio_lk_user:S3cr3t!@host:6432/db failed'
    const result = sanitize(text)
    expect(result).not.toContain('S3cr3t!')
    expect(result).toContain('postgresql://studio_lk_user:***@host:6432/db')
  })

  it('leaves text without connection strings untouched', () => {
    expect(sanitize('pg_dump: error: connection refused')).toBe('pg_dump: error: connection refused')
  })
})

describe('pgEnvFromUrl — разбор DATABASE_URL в переменные окружения PG* (не argv)', () => {
  it('extracts host/port/user/password/database/sslmode', () => {
    const env = pgEnvFromUrl('postgresql://studio_lk_user:S3cr3t!@rc1b-example.mdb.yandexcloud.net:6432/studio_lk?sslmode=require')
    expect(env.PGHOST).toBe('rc1b-example.mdb.yandexcloud.net')
    expect(env.PGPORT).toBe('6432')
    expect(env.PGUSER).toBe('studio_lk_user')
    expect(env.PGPASSWORD).toBe('S3cr3t!')
    expect(env.PGDATABASE).toBe('studio_lk')
    expect(env.PGSSLMODE).toBe('require')
  })

  it('defaults PGPORT to 5432 when the URL omits it', () => {
    const env = pgEnvFromUrl('postgresql://user:pass@host/db')
    expect(env.PGPORT).toBe('5432')
  })

  it('decodes percent-encoded credentials', () => {
    const env = pgEnvFromUrl('postgresql://user:p%40ss@host:5432/db')
    expect(env.PGPASSWORD).toBe('p@ss')
  })
})
