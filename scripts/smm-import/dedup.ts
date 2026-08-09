// Дедупликация ContentItem-кандидатов (ТЗ п.10/11) — один и тот же ролик
// легитимно встречается в рабочей таблице + клиентском контент-плане +
// финансовой таблице + аналитике; здесь строится граф "какие исходные
// строки — на самом деле одна и та же единица контента", с confidence.

import type { Confidence, ContentDedupGroup, SourceContentRow } from './types'

function normTitle(t: string): string {
  return t.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[«»"'.,!?]/g, '')
}

function legacyKey(clientHint: string, legacyCode: string): string {
  return `LC::${clientHint}::${legacyCode.toUpperCase().replace(/\s+/g, '')}`
}
function titleKey(clientHint: string, title: string): string {
  return `T::${clientHint}::${normTitle(title)}`
}

// Порядок сильных признаков совпадения (ТЗ п.10): legacy-код — самый
// надёжный (присваивался человеком один раз на единицу контента); затем
// совпадение названия (единственный общий признак между рабочей таблицей и
// её "безкодовой" аналитической парой, реальный случай — Контент-план
// Диамед РАБОЧИЙ vs Контент-план Диамед.xlsx); дата используется только для
// повышения confidence, не как первичный ключ (у части строк её нет).
export function dedupContentRows(rows: SourceContentRow[]): ContentDedupGroup[] {
  const groups: ContentDedupGroup[] = []
  const byKey = new Map<string, ContentDedupGroup>()

  // Проход 1 — строки с legacy-кодом задают "якорные" группы.
  for (const row of rows) {
    if (!row.legacyCode) continue
    const key = legacyKey(row.clientHint, row.legacyCode)
    let g = byKey.get(key)
    if (!g) {
      g = { key, confidence: 'HIGH', rows: [], evidence: [`объединено по legacy-коду "${row.legacyCode}"`] }
      byKey.set(key, g)
      groups.push(g)
    }
    g.rows.push(row)
    byKey.set(titleKey(row.clientHint, row.title), g) // тот же объект группы теперь доступен и по названию
  }

  // Проход 2 — строки без кода присоединяются к уже найденной группе по
  // совпадению названия (в пределах клиента), иначе копятся отдельно.
  const remaining: SourceContentRow[] = []
  for (const row of rows) {
    if (row.legacyCode) continue
    const tk = titleKey(row.clientHint, row.title)
    const g = byKey.get(tk)
    if (g) {
      g.rows.push(row)
      g.evidence.push(`присоединено по совпадению названия: "${row.title}"`)
    } else {
      remaining.push(row)
    }
  }

  // Проход 3 — оставшиеся строки без кода группируются между собой по
  // названию; наличие даты у ВСЕХ строк группы поднимает confidence до
  // HIGH (название+дата+клиент — уже достаточно специфичный признак,
  // ТЗ п.10 пример), без даты — только MEDIUM, уходит на ручную проверку.
  for (const row of remaining) {
    const tk = titleKey(row.clientHint, row.title)
    let g = byKey.get(tk)
    if (!g) {
      g = { key: tk, confidence: row.date ? 'HIGH' : 'MEDIUM', rows: [], evidence: [row.date ? 'объединено по названию + дате (без legacy-кода)' : 'объединено только по названию, без кода и даты — требует проверки'] }
      byKey.set(tk, g)
      groups.push(g)
    }
    g.rows.push(row)
  }

  for (const g of groups) downgradeOnDateConflict(g)
  return groups
}

// Если внутри одной группы встречаются РАЗНЫЕ непустые даты — это сигнал
// возможного ложного объединения (два разных ролика с одинаковым
// названием), группа не расформировывается автоматически (ТЗ п.11: не
// разъединяем сомнительное без участия человека), но confidence понижается,
// чтобы группа не применилась как HIGH автоматически.
function downgradeOnDateConflict(g: ContentDedupGroup): void {
  const dates = new Set(g.rows.map(r => r.date).filter((d): d is string => d !== null))
  if (dates.size > 1) {
    g.confidence = 'LOW'
    g.evidence.push(`конфликт: строки группы указывают на разные даты (${[...dates].join(', ')}) — возможно ложное объединение`)
  }
}

export function summarizeConfidence(groups: ContentDedupGroup[]): Record<Confidence, number> {
  const out: Record<Confidence, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 }
  for (const g of groups) out[g.confidence]++
  return out
}
