// Manifest / идемпотентность (ТЗ п.31/32) — стабильный fingerprint строится
// из НОРМАЛИЗОВАННЫХ значений исходной строки, не из номера строки (тот
// может съехать при правке файла); номер строки остаётся только для trace.

import type { ManifestEntry, RowTrace } from './types'
import { fingerprint } from './normalize'

export function makeManifestEntry(
  trace: RowTrace,
  entityType: ManifestEntry['entityType'],
  tempId: string,
  fingerprintParts: (string | number | null | undefined)[],
): ManifestEntry {
  return {
    sourceFile: trace.file,
    sourceSheet: trace.sheet,
    sourceRow: trace.row,
    entityType,
    tempId,
    fingerprint: fingerprint([entityType, ...fingerprintParts]),
  }
}
