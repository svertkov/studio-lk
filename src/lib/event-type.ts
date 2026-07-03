// Классификация типа события расписания по названию из Google Calendar.
// Проверки материалов/оплаты применяются только к STUDIO_BOOKING — остальные
// типы (встречи, отсутствия сотрудников, служебные пометки) не должны получать
// предупреждения и не должны попадать в блок проблемных записей на дашборде.

import type { EventType } from '@prisma/client'
import { isStudioBooking } from '@/lib/event-category'

export type { EventType }

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  STUDIO_BOOKING:        'Запись в студии',
  MEETING:               'Встреча',
  STAFF_UNAVAILABILITY:  'Отсутствие сотрудника',
  SERVICE_NOTE:          'Служебная пометка',
  OTHER:                 'Прочее',
}

// Расширяемый список сотрудников и вариантов написания их имени в календаре —
// добавление нового сотрудника не требует менять логику, только этот список.
const STAFF_ALIASES: Record<string, string[]> = {
  roman:  ['рома', 'роман', 'ромы'],
  danila: ['даня', 'дани', 'данил', 'данила', 'данилы'],
  ivan:   ['ваня', 'иван', 'вани', 'ивана'],
}

const ABSENCE_KEYWORDS = [
  'не будет', 'выходной', 'отпуск', 'заболел', 'болеет', 'не работает', 'недоступен', 'недоступна',
]

// Консервативный набор — только явные слова встречи/созвона, чтобы не задеть
// реальные студийные записи (те следуют строгому шаблону "категория, зал, камеры, человек").
const MEETING_KEYWORDS = ['встреча', 'созвон', 'совещание', 'планёрка', 'планерка', 'митинг']

export function isStaffUnavailabilityTitle(title: string): boolean {
  const lower = title.toLowerCase()
  const hasStaffName = Object.values(STAFF_ALIASES).some(aliases => aliases.some(alias => lower.includes(alias)))
  const hasAbsenceKeyword = ABSENCE_KEYWORDS.some(keyword => lower.includes(keyword))
  return hasStaffName && hasAbsenceKeyword
}

export function isMeetingTitle(title: string): boolean {
  const lower = title.toLowerCase()
  return MEETING_KEYWORDS.some(keyword => lower.includes(keyword))
}

// Классификация по умолчанию для события, у которого ещё нет сохранённой
// аннотации (пользователь ни разу не открывал и не сохранял его карточку).
// Порядок важен: сначала самое специфичное (отсутствие сотрудника), затем уже
// проверенная эвристика реальных студийных записей (зал/камеры/человек или
// известная категория), затем встречи, и только в конце — "прочее".
export function classifyEventType(title: string): EventType {
  if (isStaffUnavailabilityTitle(title)) return 'STAFF_UNAVAILABILITY'
  if (isStudioBooking(title)) return 'STUDIO_BOOKING'
  if (isMeetingTitle(title)) return 'MEETING'
  return 'OTHER'
}
