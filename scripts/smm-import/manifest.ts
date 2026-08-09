// Manifest / идемпотентность (pre-apply hardening, ТЗ п.6-11) — ДВА разных
// понятия, сознательно не смешаны в одно:
//
// - entityKey — стабильный "это тот же реальный объект" (client+legacy-код,
//   либо client+title если кода нет). НЕ меняется при правке title/даты в
//   источнике — apply.ts ищет существующую SmmMigrationRecord ИМЕННО по
//   entityKey.
// - fingerprint — полный отпечаток нормализованного смыслового содержимого
//   (client+код+title+дата+url+platform+сумма/метрика, в зависимости от
//   entityType). Используется, чтобы ОТЛИЧИТЬ "то же самое, ничего не
//   изменилось" (fingerprint совпал → ALREADY_APPLIED) от "тот же объект, но
//   источник поменялся" (fingerprint разошёлся при том же entityKey →
//   SOURCE_CHANGED_AFTER_APPLY, business-данные НЕ обновляются молча).
//
// sourceRow нигде здесь не участвует в ключах — только в trace-полях
// ManifestEntry (см. types.ts) для отчёта/диагностики.

import type { ManifestEntry, RowTrace } from './types'
import { fingerprint } from './normalize'

export function makeManifestEntry(
  trace: RowTrace,
  entityType: ManifestEntry['entityType'],
  tempId: string,
  entityKeyParts: (string | number | null | undefined)[],
  fingerprintParts: (string | number | null | undefined)[] = entityKeyParts,
): ManifestEntry {
  return {
    sourceFile: trace.file,
    sourceSheet: trace.sheet,
    sourceRow: trace.row,
    entityType,
    tempId,
    entityKey: fingerprint([entityType, 'KEY', ...entityKeyParts]),
    fingerprint: fingerprint([entityType, 'FP', ...fingerprintParts]),
  }
}
