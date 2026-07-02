// Типы и лейблы клиентов — зеркало Prisma-энумов для использования в UI
// Сами энумы импортируются из @prisma/client, здесь только UI-лейблы и цвета

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
