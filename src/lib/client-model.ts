// Типы и лейблы клиентов — зеркало Prisma-энумов для использования в UI
// Сами энумы импортируются из @prisma/client, здесь только UI-лейблы и цвета

import { Prisma } from '@prisma/client'

export type ClientType = 'INDIVIDUAL' | 'SELF_EMPLOYED' | 'IP' | 'LLC' | 'AGENCY'
export type ClientStatus = 'NEW' | 'ACTIVE' | 'REPEAT' | 'REGULAR' | 'SLEEPING' | 'PROBLEM' | 'ARCHIVED'
export type ClientSource =
  | 'YANDEX_MAPS' | 'CONTEXT_ADS' | 'RECOMMENDATION' | 'REPEAT_REQUEST'
  | 'WEBSITE' | 'TELEGRAM' | 'INSTAGRAM' | 'YOUTUBE'
  | 'AVITO_PROFI' | 'COLD_OUTREACH' | 'PARTNER_AGENCY' | 'OTHER'

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  INDIVIDUAL:    'Физлицо',
  SELF_EMPLOYED: 'Самозанятый',
  IP:            'ИП',
  LLC:           'ООО',
  AGENCY:        'Агентство',
}

export const CLIENT_TYPE_COLORS: Record<ClientType, string> = {
  INDIVIDUAL:    'border-zinc-600 text-zinc-400',
  SELF_EMPLOYED: 'border-teal-700 text-teal-400',
  IP:            'border-blue-700 text-blue-400',
  LLC:           'border-indigo-700 text-indigo-400',
  AGENCY:        'border-orange-700 text-orange-400',
}

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  NEW:      'Новый',
  ACTIVE:   'В работе',
  REPEAT:   'Повторный',
  REGULAR:  'Постоянный',
  SLEEPING: 'Спящий',
  PROBLEM:  'Проблемный',
  ARCHIVED: 'Архив',
}

export const CLIENT_STATUS_COLORS: Record<ClientStatus, string> = {
  NEW:      'border-blue-700 text-blue-400',
  ACTIVE:   'border-green-700 text-green-400',
  REPEAT:   'border-violet-700 text-violet-400',
  REGULAR:  'border-amber-600 text-amber-400',
  SLEEPING: 'border-orange-700 text-orange-400',
  PROBLEM:  'border-red-700 text-red-400',
  ARCHIVED: 'border-zinc-600 text-zinc-500',
}

// Автоматическая классификация статуса клиента по числу визитов (используется при импорте).
// Пороги задаются здесь одним местом — легко поменять при необходимости.
export const CLIENT_STATUS_VISIT_THRESHOLDS = {
  regular: 10, // больше — «Постоянный»
  repeat: 1,   // больше — «Повторный», ровно столько или меньше — «Новый»
}

export function computeStatusFromVisitCount(visitCount: number): ClientStatus {
  if (visitCount > CLIENT_STATUS_VISIT_THRESHOLDS.regular) return 'REGULAR'
  if (visitCount > CLIENT_STATUS_VISIT_THRESHOLDS.repeat) return 'REPEAT'
  return 'NEW'
}

// Расшифровка ошибки Prisma в понятное сообщение для createClient/updateClient
// (actions/clients.ts) — раньше обе функции ловили ЛЮБУЮ ошибку в один и тот
// же generic текст ("Не удалось создать/обновить клиента"), включая обрыв
// связи с БД (реальный случай: управляемый кластер PostgreSQL был остановлен,
// 2026-08-08 — с этим текстом невозможно было понять, что дело не во введённых
// данных). Различаем ПО ТИПУ ошибки Prisma, не по тексту сообщения (текст —
// деталь реализации конкретной версии Prisma/Postgres, на неё нельзя
// полагаться) — и никогда не отдаём наружу сырое e.message/stack, только
// заранее заданные безопасные формулировки. Сейчас в Client нет ни одного
// @unique-поля (см. prisma/schema.prisma) — ветка P2002 на будущее, а не для
// существующего ограничения. Живёт здесь, а не в actions/clients.ts — та же
// функция чистая (без обращения к БД), но клиентские actions тянут за собой
// '@/auth' (NextAuth), который ломает импорт файла в vitest; здесь только
// @prisma/client, тестируется как обычная модельная функция.
export function describeClientActionError(e: unknown, fallback: string): string {
  if (e instanceof Prisma.PrismaClientInitializationError) {
    return 'Нет связи с базой данных. Попробуйте ещё раз через минуту — если не поможет, сообщите администратору.'
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') return 'Клиент с такими данными уже существует.'
    if (e.code === 'P2003') return 'Не удалось сохранить: указана несуществующая связанная запись (например, ответственный сотрудник).'
  }
  return fallback
}

export const CLIENT_SOURCE_LABELS: Record<ClientSource, string> = {
  YANDEX_MAPS:    'Яндекс.Карты',
  CONTEXT_ADS:    'Контекстная реклама',
  RECOMMENDATION: 'Рекомендации',
  REPEAT_REQUEST: 'Повторное обращение',
  WEBSITE:        'Сайт',
  TELEGRAM:       'Telegram',
  INSTAGRAM:      'Instagram / Reels',
  YOUTUBE:        'YouTube',
  AVITO_PROFI:    'Авито / Профи',
  COLD_OUTREACH:  'Холодный контакт',
  PARTNER_AGENCY: 'Партнёр / агентство',
  OTHER:          'Прочее',
}
