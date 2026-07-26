// Классификация типа события расписания по названию из Google Calendar.
// Проверки материалов/оплаты применяются к обоим коммерческим типам —
// STUDIO_BOOKING и OFFSITE_SHOOT (см. requiresFullBookingForm ниже) —
// остальные типы (встречи, отсутствия сотрудников, служебные пометки) не
// должны получать предупреждения и не должны попадать в блок проблемных
// записей на дашборде.

import type { EventType } from '@prisma/client'
import { isStudioBooking, isOffsiteShootTitle } from '@/lib/event-category'

export type { EventType }

// Порядок объекта определяет порядок пунктов в <select> "Тип события"
// (EventCardModal.tsx строит список через Object.keys(EVENT_TYPE_LABELS)) —
// выездная съёмка стоит сразу после студийной записи как второй коммерческий
// тип, не в конце списка.
export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  STUDIO_BOOKING:        'Запись в студии',
  OFFSITE_SHOOT:         'Выездная съёмка',
  MEETING:               'Встреча',
  STAFF_UNAVAILABILITY:  'Отсутствие сотрудника',
  SERVICE_NOTE:          'Служебная пометка',
  OTHER:                 'Прочее',
}

// Коммерческие типы события, для которых карточка показывает полный набор
// полей (клиент/оплата/монтаж/материалы/документы) — используется в
// EventCardModal.tsx ВМЕСТО точечных `eventType === 'STUDIO_BOOKING'`
// проверок везде, кроме самого поля "Зал" (зал есть только у студийной
// записи — см. AGENTS.md, "Тип события и формат/зал — разные справочники").
const FULL_BOOKING_FORM_TYPES: readonly EventType[] = ['STUDIO_BOOKING', 'OFFSITE_SHOOT']

export function requiresFullBookingForm(eventType: EventType): boolean {
  return FULL_BOOKING_FORM_TYPES.includes(eventType)
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
// Порядок важен: сначала самое специфичное (отсутствие сотрудника), затем
// выездная съёмка (тоже специфичная — иначе "выезд" в названии раньше уходил
// в STUDIO_BOOKING через isStudioBooking, см. 2026-07-27 в event-category.ts),
// затем уже проверенная эвристика реальных студийных записей (зал/камеры/
// человек или известная категория), затем встречи, и только в конце — "прочее".
export function classifyEventType(title: string): EventType {
  if (isStaffUnavailabilityTitle(title)) return 'STAFF_UNAVAILABILITY'
  if (isOffsiteShootTitle(title)) return 'OFFSITE_SHOOT'
  if (isStudioBooking(title)) return 'STUDIO_BOOKING'
  if (isMeetingTitle(title)) return 'MEETING'
  return 'OTHER'
}
