// Единая бизнес-логика "завершённых записей студии за календарный месяц" —
// один и тот же критерий используется дашбордом (карточка часов, счётчик
// записей, диаграмма по форматам) и подробным отчётом (выбор месяца, таблица
// детализации), чтобы они никогда не расходились в цифрах (ТЗ, часть 10).
//
// Правило отнесения записи к месяцу — ПО ДАТЕ НАЧАЛА, не по дате окончания
// (тот же принцип, что уже применяется в client-shoots-model.ts/ClientVisit:
// вся история съёмок в проекте группируется по началу, а не по концу — см.
// mergeShoots/computeShootsSummary). Запись, начавшаяся 31 июля в 23:00 и
// закончившаяся 1 августа в 01:00, относится к июлю (ТЗ, часть 14).

import { STUDIO_UTC_OFFSET_HOURS } from '@/lib/import/normalize'

export { STUDIO_UTC_OFFSET_HOURS }

export interface CalendarMonthRange {
  start: Date
  end: Date
}

// Календарный месяц в часовом поясе студии (Москва, UTC+3, без перехода на
// летнее время с 2014 года — тот же helper-принцип, что и в normalize.ts):
// 1-е число 00:00 .. последнее число 23:59:59.999 включительно.
export function getCalendarMonthRange(year: number, month1to12: number): CalendarMonthRange {
  const start = new Date(Date.UTC(year, month1to12 - 1, 1, -STUDIO_UTC_OFFSET_HOURS))
  const end = new Date(Date.UTC(year, month1to12, 1, -STUDIO_UTC_OFFSET_HOURS) - 1)
  return { start, end }
}

// Компоненты календарной даты в часовом поясе студии для произвольного
// момента времени — нужно только для форматирования подписей (см. ниже),
// не для хранения: сам Date остаётся обычным UTC-инстантом.
function toStudioDateParts(d: Date): { year: number; month: number; day: number } {
  const shifted = new Date(d.getTime() + STUDIO_UTC_OFFSET_HOURS * 3_600_000)
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() }
}

export function getCurrentStudioYearMonth(now: Date = new Date()): { year: number; month: number } {
  const { year, month } = toStudioDateParts(now)
  return { year, month }
}

export interface BookingLike {
  start: string | Date
  end: string | Date
  // Единственный существующий в схеме сигнал отмены — статус связанного
  // Order (см. client-shoots-model.ts: ScheduleEvent сам по себе не хранит
  // статус отмены). Необязательное поле — по умолчанию считается не отменённой.
  isCancelled?: boolean
}

// Строго "уже закончилась к текущему моменту" — БЕЗ грейс-периода. Это
// отдельное понятие от BOOKING_ISSUE_GRACE_PERIOD_HOURS в schedule-model.ts
// (тот — про то, когда напоминать добавить материалы; здесь — когда запись
// реально засчитывается в аналитику завершённых съёмок, критерий из ТЗ
// строго "endDateTime <= now", без запаса).
export function isCompletedByEndTime(end: string | Date, now: Date): boolean {
  return new Date(end).getTime() <= now.getTime()
}

// Единый критерий "эта запись входит в аналитику завершённых съёмок месяца":
// не отменена + относится к выбранному месяцу (по дате начала) + уже
// закончилась к текущему моменту. Для будущего месяца start всегда вне
// диапазона [month.start, now], поэтому результат автоматически пуст без
// отдельного условия "если месяц в будущем" (ТЗ, часть 8).
export function isCompletedStudioBooking(booking: BookingLike, month: CalendarMonthRange, now: Date): boolean {
  if (booking.isCancelled) return false
  const startMs = new Date(booking.start).getTime()
  if (startMs < month.start.getTime() || startMs > month.end.getTime()) return false
  return isCompletedByEndTime(booking.end, now)
}

export function filterCompletedStudioBookings<T extends BookingLike>(
  bookings: T[], month: CalendarMonthRange, now: Date = new Date(),
): T[] {
  return bookings.filter(b => isCompletedStudioBooking(b, month, now))
}

export function calculateCompletedHours(bookings: Pick<BookingLike, 'start' | 'end'>[]): number {
  return bookings.reduce((sum, b) => {
    const ms = new Date(b.end).getTime() - new Date(b.start).getTime()
    return sum + Math.max(0, ms) / 3_600_000
  }, 0)
}

const MONTH_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]
const MONTH_NOMINATIVE = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

// "Июль 2026" — заголовок выбранного месяца в переключателе.
export function formatMonthLabel(year: number, month1to12: number): string {
  return `${MONTH_NOMINATIVE[month1to12 - 1]} ${year}`
}

// "1–31 июля 2026" для полностью прошедшего месяца, "1–11 июля 2026" для
// текущего (ограничено фактическим моментом) — вторичная подпись под
// заголовком карточки/отчёта, поясняющая, какая часть месяца реально вошла
// в расчёт (ТЗ, часть 4: "Завершённые записи · 1–10 июля").
export function formatCompletedRangeLabel(month: CalendarMonthRange, now: Date = new Date()): string {
  const clampedEndMs = Math.min(month.end.getTime(), Math.max(now.getTime(), month.start.getTime()))
  const startParts = toStudioDateParts(month.start)
  const endParts = toStudioDateParts(new Date(clampedEndMs))
  const monthName = MONTH_GENITIVE[startParts.month - 1]
  const days = startParts.day === endParts.day ? `${startParts.day}` : `${startParts.day}–${endParts.day}`
  return `${days} ${monthName} ${startParts.year}`
}
