'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Clock, ChevronLeft, ChevronRight } from 'lucide-react'
import { parseEventTitle, isStudioBooking } from '@/lib/event-category'
import { getScheduleAnnotations } from '@/lib/actions/schedule'
import {
  getCalendarMonthRange, filterCompletedStudioBookings, calculateCompletedHours,
  formatMonthLabel, formatCompletedRangeLabel, type CalendarMonthRange,
} from '@/lib/booking-analytics'
import HoursReportTable, { type HoursRow } from './HoursReportTable'

interface CalendarEvent {
  id: string
  title: string
  description: string
  start: string
  end: string
  allDay: boolean
}

interface Props {
  initialYear: number
  initialMonth: number
  nowIso: string
}

// Google Calendar читается клиентским фетчем к /api/calendar/events, а не напрямую
// на сервере в этом компоненте — при прямом вызове googleapis внутри серверного
// рендера эта сборка Next 16 + Turbopack падает с "ArrayBuffer is not detachable"
// (тот же класс бага, что чинили в DashboardBody/ScheduleView).
export default function HoursReportBody({ initialYear, initialMonth, nowIso }: Props) {
  // year/month — одно состояние, а не два отдельных useState: переключение
  // месяца обновляет оба поля сразу через функциональный setState, иначе два
  // быстрых клика подряд ("вперёд"×2) могут оба прочитать один и тот же
  // "устаревший" year/month из замыкания (React батчит события в одном тике)
  // и в итоге продвинуть месяц только на один шаг вместо двух.
  const [{ year, month }, setYearMonth] = useState({ year: initialYear, month: initialMonth })
  const [events, setEvents] = useState<CalendarEvent[] | null>(null)
  const [annotations, setAnnotations] = useState<Record<string, {
    isCancelled: boolean
    clientId: string | null
    clientName: string | null
    estimatedPrice: number | null
  }>>({})

  const now = new Date(nowIso)
  const monthRange: CalendarMonthRange = getCalendarMonthRange(year, month)
  const monthLabel = formatMonthLabel(year, month)
  const completedRangeLabel = formatCompletedRangeLabel(monthRange, now)

  useEffect(() => {
    let stopped = false
    async function loadEvents() {
      setEvents(null)
      const data = await fetch(`/api/calendar/events?calendar=studio&timeMin=${encodeURIComponent(monthRange.start.toISOString())}&timeMax=${encodeURIComponent(monthRange.end.toISOString())}`)
        .then(res => res.json())
        .catch(() => ({ events: [] }))
      if (stopped) return
      const list: CalendarEvent[] = data.events ?? []
      setEvents(list)

      const studioIds = list.filter(e => !e.allDay && isStudioBooking(e.title)).map(e => e.id)
      if (studioIds.length === 0) { setAnnotations({}); return }
      const ann = await getScheduleAnnotations(studioIds)
      if (stopped) return
      const map: typeof annotations = {}
      for (const dto of Object.values(ann.data)) {
        if (!dto.calendarEventId) continue
        map[dto.calendarEventId] = {
          isCancelled: dto.isCancelled,
          clientId: dto.clientId,
          clientName: dto.clientName,
          estimatedPrice: dto.estimatedPrice,
        }
      }
      setAnnotations(map)
    }
    loadEvents()
    const interval = setInterval(loadEvents, 5 * 60 * 1000)
    return () => { stopped = true; clearInterval(interval) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month])

  const loading = events === null

  const studioEvents = (events ?? []).filter(e => !e.allDay && isStudioBooking(e.title))
  const completedEvents = filterCompletedStudioBookings(
    studioEvents.map(e => ({ ...e, isCancelled: annotations[e.id]?.isCancelled ?? false })),
    monthRange, now,
  )

  const rows: HoursRow[] = completedEvents.map(e => {
    const parsed = parseEventTitle(e.title, e.description)
    const ann = annotations[e.id]
    return {
      id: e.id,
      start: e.start,
      category: parsed.category,
      client: ann?.clientName || parsed.client || '—',
      clientId: ann?.clientId ?? null,
      hall: parsed.hall ?? '—',
      cameras: parsed.cameras,
      hours: Math.max(0, new Date(e.end).getTime() - new Date(e.start).getTime()) / 3_600_000,
      amount: ann?.estimatedPrice ?? null,
    }
  })

  const totalHours = calculateCompletedHours(completedEvents)

  function goToMonth(delta: number) {
    setYearMonth(prev => {
      const base = new Date(Date.UTC(prev.year, prev.month - 1 + delta, 1))
      return { year: base.getUTCFullYear(), month: base.getUTCMonth() + 1 }
    })
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <Link href="/admin/dashboard" className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-white text-sm transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Дашборд
        </Link>
        <div className="flex items-center justify-between mt-3 flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Часы записи</h1>
            <p className="text-zinc-400 text-sm mt-1">
              {monthLabel}
              {!loading && ` · ${totalHours.toFixed(1)} ч · ${rows.length} завершённых записей`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Переключатель месяца — предыдущий/следующий, текущий выбранный
                месяц в заголовке слева (ТЗ, часть 8). По умолчанию открывается
                текущий календарный месяц (initialYear/initialMonth из page.tsx). */}
            <div className="flex items-center gap-1 bg-zinc-800 border border-zinc-700 rounded-lg p-1">
              <button
                type="button"
                onClick={() => goToMonth(-1)}
                aria-label="Предыдущий месяц"
                className="w-8 h-8 flex items-center justify-center rounded-md text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-zinc-200 text-sm font-medium px-2 min-w-[120px] text-center">{monthLabel}</span>
              <button
                type="button"
                onClick={() => goToMonth(1)}
                aria-label="Следующий месяц"
                className="w-8 h-8 flex items-center justify-center rounded-md text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <div className="w-12 h-12 bg-zinc-800 rounded-lg flex items-center justify-center flex-shrink-0">
              <Clock className="w-6 h-6 text-zinc-300" />
            </div>
          </div>
        </div>
        <p className="text-zinc-500 text-xs mt-2">
          В расчёт включены только завершённые записи{!loading && ` · завершено: ${completedRangeLabel}`}
        </p>
      </div>

      {loading ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
          <p className="text-zinc-400 text-sm">Загрузка...</p>
        </div>
      ) : (
        <HoursReportTable rows={rows} />
      )}
    </div>
  )
}
