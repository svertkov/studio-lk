// Чистые функции решения статуса идемпотентности и batch ID (pre-apply
// hardening, ТЗ п.11/39/41) — без обращения к Prisma, тестируемо изолированно.

import type { Confidence } from './types'

export type MigrationStatus = 'NEW' | 'ALREADY_APPLIED' | 'SOURCE_CHANGED_AFTER_APPLY'

// entityKey совпал → тот же реальный объект. fingerprint внутри него решает,
// изменился ли смысл источника с прошлого apply (ТЗ п.11):
//   - fingerprint тот же  → ALREADY_APPLIED (пропустить, не дублировать)
//   - fingerprint другой  → SOURCE_CHANGED_AFTER_APPLY (НЕ обновлять бизнес-
//     данные молча, отметить исключение для ручного решения)
export function decideMigrationStatus(existing: { fingerprint: string } | null, newFingerprint: string): MigrationStatus {
  if (!existing) return 'NEW'
  return existing.fingerprint === newFingerprint ? 'ALREADY_APPLIED' : 'SOURCE_CHANGED_AFTER_APPLY'
}

const CONFIDENCE_RANK: Record<Confidence, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 }

// "--max-confidence HIGH" (ТЗ п.21/23) — на первый apply допускаются ТОЛЬКО
// сущности с confidence НЕ НИЖЕ порога (для HIGH это значит "равно HIGH",
// других уровней выше него не бывает) — назван "max" в ТЗ, реализован как
// нижняя граница допуска, т.к. смысл требования — "не ниже этого уровня".
export function meetsConfidenceThreshold(confidence: Confidence, threshold: Confidence): boolean {
  return CONFIDENCE_RANK[confidence] >= CONFIDENCE_RANK[threshold]
}

// batchId (ТЗ п.41) — напр. "smm-excel-2026-08-dia-v1", "...-v2" при повторном
// прогоне того же клиента в той же migrationName. Версия вычисляется от уже
// существующих batchId с тем же префиксом — не UUID/timestamp, чтобы batch
// ID оставался человекочитаемым и последовательным для reconciliation.
export function computeNextBatchId(migrationName: string, project: string, existingBatchIds: string[]): string {
  const prefix = `${migrationName}-${project.toLowerCase()}-v`
  const versions = existingBatchIds
    .filter(b => b.startsWith(prefix))
    .map(b => parseInt(b.slice(prefix.length), 10))
    .filter(n => !isNaN(n))
  const next = versions.length > 0 ? Math.max(...versions) + 1 : 1
  return `${prefix}${next}`
}
