// Предварительные словари нормализации (ТЗ п.5) — построены по факту
// реальных файлов в ~/Desktop/Таблицы (аудит 2026-08-09). Правило: словарь
// схлопывает только НАПИСАНИЕ одного и того же значения (Инст/Инстаграм →
// INSTAGRAM), но НИКОГДА не решает, кто есть кто, когда это неоднозначно —
// такие случаи уходят в exceptions (ТЗ п.5: «не создавать нового
// Client/EditorProfile из каждой опечатки»).

import type { SmmPublicationPlatform } from './types'

const PLATFORM_ALIASES: Record<string, SmmPublicationPlatform> = {
  'инстаграм': 'INSTAGRAM', 'инст': 'INSTAGRAM', 'instagram': 'INSTAGRAM', 'insta': 'INSTAGRAM', 'reels': 'INSTAGRAM',
  'телеграм': 'TELEGRAM', 'тг': 'TELEGRAM', 'telegram': 'TELEGRAM',
  'вконтакте': 'VK', 'вк': 'VK', 'vk': 'VK',
  'ютуб': 'YOUTUBE', 'youtube': 'YOUTUBE', 'ютюб': 'YOUTUBE',
  'рутуб': 'RUTUBE', 'rutube': 'RUTUBE',
}

export function normalizePlatform(raw: string): SmmPublicationPlatform | null {
  const key = raw.trim().toLowerCase()
  return PLATFORM_ALIASES[key] ?? null
}

// Известные варианты префиксов legacy-кодов → человекочитаемая подсказка
// клиента (ТЗ п.6/7). Не окончательное сопоставление с SmmProject — только
// evidence для match-clients.ts. Найдено в реальных файлах: Диамед — "Д" (а
// заголовок колонки иногда называется "Индекс", иногда "номер" — тоже
// вариант написания, не значения). ЗубовЛаб — "ЗЛ". АльгизВет — ОБА "АЛ" и
// "А" встречаются в одном файле (АЛЬГИЗ РАБОЧАЯ.xlsx: "АЛ1" в июне, "А5" в
// июле-августе) — намеренно не выбираем один как "правильный", матчим оба.
// Пастернак — "П".
export const LEGACY_PREFIX_HINTS: { pattern: RegExp; clientHint: string }[] = [
  { pattern: /^Д\d+$/i, clientHint: 'Диамед' },
  { pattern: /^ЗЛ\d+$/i, clientHint: 'ЗубовЛаб' },
  { pattern: /^АЛ\d+$/i, clientHint: 'АльгизВет' },
  { pattern: /^А\d+$/i, clientHint: 'АльгизВет' },
  { pattern: /^П\d+$/i, clientHint: 'Пастернак' },
]

export function hintFromLegacyCode(code: string): string | null {
  const trimmed = code.trim()
  for (const { pattern, clientHint } of LEGACY_PREFIX_HINTS) {
    if (pattern.test(trimmed)) return clientHint
  }
  return null
}

// Имя файла → предполагаемый клиент (ТЗ п.6, "Source → Proposed Client").
// Только evidence уровня workbook — конкретный SmmProject ищется отдельно
// по реальным Client/SmmProject в БД (match-clients.ts), сюда угадывание
// нового клиента не заводится.
export const WORKBOOK_CLIENT_HINTS: { pattern: RegExp; clientHint: string }[] = [
  { pattern: /диамед/i, clientHint: 'Диамед' },
  { pattern: /\btok\b/i, clientHint: 'TOK' },
  { pattern: /ток(?!мебель)/i, clientHint: 'TOK' },
  { pattern: /альгиз/i, clientHint: 'АльгизВет' },
  { pattern: /зубов\s*лаб/i, clientHint: 'ЗубовЛаб' },
  { pattern: /пастернак/i, clientHint: 'Пастернак' },
  { pattern: /2470\s*смм\s*оплата/i, clientHint: 'МУЛЬТИ-КЛИЕНТ' },
  { pattern: /финансы\s*smm/i, clientHint: 'МУЛЬТИ-КЛИЕНТ' },
]

export function hintFromWorkbookName(fileName: string): string | null {
  for (const { pattern, clientHint } of WORKBOOK_CLIENT_HINTS) {
    if (pattern.test(fileName)) return clientHint
  }
  return null
}

// Известные варианты написания клиента (для сопоставления с реальным
// Client.name в БД, где название может отличаться от файла) — НЕ создаёт
// новых клиентов, только список синонимов для поиска существующего.
export const CLIENT_NAME_SYNONYMS: Record<string, string[]> = {
  'Диамед': ['диамед', 'diamed'],
  'TOK': ['ток', 'токмебель', 'tok'],
  'АльгизВет': ['альгизвет', 'альгиз', 'альгиз вет', 'algisvet', 'алексей марченков'],
  'ЗубовЛаб': ['зубовлаб', 'зубов лаб', 'зубов лаборатория'],
  'Пастернак': ['пастернак', 'виктор пастернак'],
}

// Известные варианты написания имён сотрудников/монтажёров (ТЗ п.5/п.21) —
// сопоставляются с реальными EditorProfile.displayName в БД по нормализованному
// имени; варианты НИЖЕ — то, что реально встречено в файлах, каждый должен
// пройти через match-editors.ts (evidence), а не автосоздание.
export const PERSON_NAME_VARIANTS: Record<string, string[]> = {
  // "Лиза Ваниосова" (2470 SMM Оплата.xlsx) написана иначе, чем любой
  // существующий EditorProfile — намеренно НЕ мержим с "Лиза Терентьева"
  // (это другой человек) и не создаём новый профиль автоматически.
}

function stripDiacriticsLower(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ')
}

export function normalizeName(s: string): string {
  return stripDiacriticsLower(s)
}
