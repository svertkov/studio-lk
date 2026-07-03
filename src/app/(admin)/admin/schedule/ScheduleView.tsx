'use client'

import { useState, useCallback, useEffect } from 'react'
import {
  format, parseISO, isSameDay,
  startOfDay, endOfDay,
  startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
  addDays, subDays, addWeeks, subWeeks, addMonths, subMonths,
  eachDayOfInterval,
} from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, RefreshCw, HelpCircle } from 'lucide-react'
import type { CalendarEvent } from '@/lib/google-calendar'
import { getScheduleAnnotations } from '@/lib/actions/schedule'
import { mergeScheduleEvent, type ScheduleEventDTO, type ScheduleEventVM } from '@/lib/schedule-model'
import DayView from './DayView'
import WeekView from './WeekView'
import MonthView from './MonthView'
import EventCardModal from './EventCardModal'

type ViewMode = 'day' | 'week' | 'month'

const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: 'day',   label: 'День' },
  { value: 'week',  label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
]

const CALENDAR_OPTIONS = [
  { value: 'all',    label: 'Все календари' },
  { value: 'studio', label: 'Студия' },
  { value: 'smm',    label: 'SMM' },
]

const CALENDAR_COLORS: Record<string, { dot: string }> = {
  studio: { dot: '#00c26b' },
  smm:    { dot: '#3b82f6' },
}

const TITLE_LEGEND = [
  { code: 'ГГ',  label: 'Говорящая голова' },
  { code: 'ТЗ',  label: 'Тёмный зал' },
  { code: 'СЗ',  label: 'Светлый зал' },
  { code: 'Nк',  label: 'Количество камер (например 3к — 3 камеры)' },
  { code: 'Nч',  label: 'Количество человек (например 3ч — 3 человека)' },
]

function getFetchRange(viewMode: ViewMode, anchorDate: Date): { start: Date; end: Date } {
  if (viewMode === 'day') return { start: startOfDay(anchorDate), end: endOfDay(anchorDate) }
  if (viewMode === 'week') {
    return { start: startOfWeek(anchorDate, { weekStartsOn: 1 }), end: endOfWeek(anchorDate, { weekStartsOn: 1 }) }
  }
  // Месяц: тянем события на всю видимую сетку (включая хвосты соседних месяцев),
  // чтобы дни на границах месяца в MonthView тоже показывали реальные события.
  return {
    start: startOfWeek(startOfMonth(anchorDate), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(anchorDate), { weekStartsOn: 1 }),
  }
}

export default function ScheduleView() {
  const [viewMode, setViewMode] = useState<ViewMode>('week')
  const [anchorDate, setAnchorDate] = useState(new Date())
  const [calendarFilter, setCalendarFilter] = useState<'all' | 'studio' | 'smm'>('all')
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([])
  const [annotations, setAnnotations] = useState<Record<string, ScheduleEventDTO>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [showLegend, setShowLegend] = useState(false)

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { start, end } = getFetchRange(viewMode, anchorDate)
      const params = new URLSearchParams({
        calendar: calendarFilter,
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
      })
      const res = await fetch(`/api/calendar/events?${params}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      const evs: CalendarEvent[] = data.events ?? []
      setCalendarEvents(evs)
      const annResult = await getScheduleAnnotations(evs.map(e => e.id))
      setAnnotations(annResult.data)
    } catch {
      setError('Не удалось загрузить события. Проверьте настройки Google Calendar.')
      setCalendarEvents([])
      setAnnotations({})
    } finally {
      setLoading(false)
    }
  }, [calendarFilter, viewMode, anchorDate])

  // Автообновление расписания раз в 5 минут — чтобы подсветка "нет материалов"/
  // "не оплачено" и новые события из Google Календаря появлялись сами, без
  // ручного нажатия "Обновить".
  useEffect(() => {
    fetchEvents()
    const interval = setInterval(fetchEvents, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchEvents])

  const refetchAnnotations = useCallback(async () => {
    const annResult = await getScheduleAnnotations(calendarEvents.map(e => e.id))
    setAnnotations(annResult.data)
  }, [calendarEvents])

  const eventVms: ScheduleEventVM[] = calendarEvents.map(ce => mergeScheduleEvent(ce, annotations[ce.id] ?? null))
  const selectedVm = eventVms.find(vm => vm.calendarEvent.id === selectedEventId) ?? null

  function handleSelectEvent(vm: ScheduleEventVM) { setSelectedEventId(vm.calendarEvent.id) }
  function handleSelectDay(day: Date) { setAnchorDate(day); setViewMode('day') }

  function goPrev() {
    setAnchorDate(d => viewMode === 'day' ? subDays(d, 1) : viewMode === 'week' ? subWeeks(d, 1) : subMonths(d, 1))
  }
  function goNext() {
    setAnchorDate(d => viewMode === 'day' ? addDays(d, 1) : viewMode === 'week' ? addWeeks(d, 1) : addMonths(d, 1))
  }
  function goToday() { setAnchorDate(new Date()) }

  const weekStart = startOfWeek(anchorDate, { weekStartsOn: 1 })
  const weekEnd = endOfWeek(anchorDate, { weekStartsOn: 1 })
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd })

  const rangeLabel =
    viewMode === 'day' ? format(anchorDate, 'd MMMM yyyy', { locale: ru }) :
    viewMode === 'week' ? `${format(weekStart, 'd MMM', { locale: ru })} — ${format(weekEnd, 'd MMM yyyy', { locale: ru })}` :
    format(anchorDate, 'LLLL yyyy', { locale: ru })

  return (
    <div className="p-8 max-w-6xl">
      {/* Заголовок */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Расписание</h1>
          <p className="text-zinc-400 text-sm mt-1">Google Календарь студии</p>
        </div>
        <button
          onClick={fetchEvents}
          className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Обновить
        </button>
      </div>

      {/* Переключатель вида */}
      <div className="flex items-center gap-2 mb-4">
        {VIEW_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setViewMode(opt.value)}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition-all ${
              viewMode === opt.value
                ? 'bg-white text-black'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Фильтр по календарям */}
      <div className="flex items-center gap-2 mb-6">
        {CALENDAR_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setCalendarFilter(opt.value as typeof calendarFilter)}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition-all ${
              calendarFilter === opt.value
                ? 'bg-white text-black'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
            }`}
          >
            {opt.value !== 'all' && (
              <span
                className="inline-block w-2 h-2 rounded-full mr-2"
                style={{ background: CALENDAR_COLORS[opt.value]?.dot }}
              />
            )}
            {opt.label}
          </button>
        ))}

        <div className="relative ml-1">
          <button
            onClick={() => setShowLegend(v => !v)}
            className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
              showLegend ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
            }`}
            title="Расшифровка обозначений"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
          {showLegend && (
            <div className="absolute left-0 top-10 z-30 w-72 bg-zinc-900 border border-zinc-800 rounded-xl shadow-lg p-4">
              <p className="text-xs font-bold text-white mb-2">Обозначения в названиях записей</p>
              <div className="space-y-1.5">
                {TITLE_LEGEND.map(item => (
                  <div key={item.code} className="flex items-baseline gap-2 text-xs">
                    <span className="font-bold flex-shrink-0 w-8" style={{ color: '#00c26b' }}>{item.code}</span>
                    <span className="text-zinc-400">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Навигация по датам */}
      <div className="flex items-center gap-4 mb-5">
        <button
          onClick={goPrev}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-800 hover:bg-zinc-800 transition-colors"
        >
          <ChevronLeft className="w-4 h-4 text-zinc-300" />
        </button>
        <span className="text-sm font-semibold text-white min-w-[200px] text-center capitalize">
          {rangeLabel}
        </span>
        <button
          onClick={goNext}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-800 hover:bg-zinc-800 transition-colors"
        >
          <ChevronRight className="w-4 h-4 text-zinc-300" />
        </button>
        {!isSameDay(anchorDate, new Date()) && (
          <button onClick={goToday} className="text-xs text-zinc-500 hover:text-white underline">
            Сегодня
          </button>
        )}
      </div>

      {error && (
        <div className="mb-5 p-4 rounded-xl bg-red-950/40 border border-red-900 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Основной вид расписания */}
      {viewMode === 'day' && <DayView day={anchorDate} events={eventVms} onSelectEvent={handleSelectEvent} />}
      {viewMode === 'week' && <WeekView weekDays={weekDays} events={eventVms} onSelectEvent={handleSelectEvent} />}
      {viewMode === 'month' && (
        <MonthView month={anchorDate} events={eventVms} onSelectEvent={handleSelectEvent} onSelectDay={handleSelectDay} />
      )}

      {/* Карточка события */}
      {selectedVm && (
        <EventCardModal
          vm={selectedVm}
          onOpenChange={open => { if (!open) setSelectedEventId(null) }}
          onSaved={refetchAnnotations}
        />
      )}

      {/* Легенда */}
      <div className="mt-4 flex items-center gap-4">
        {Object.entries(CALENDAR_COLORS).map(([key, colors]) => (
          <div key={key} className="flex items-center gap-1.5 text-xs text-zinc-500">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: colors.dot }} />
            {key === 'studio' ? 'Студия (запись)' : 'SMM проекты'}
          </div>
        ))}
      </div>
    </div>
  )
}
