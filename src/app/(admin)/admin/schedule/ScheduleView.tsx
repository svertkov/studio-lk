'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { format, parseISO, startOfWeek, endOfWeek, addWeeks, isSameDay } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, RefreshCw, HelpCircle } from 'lucide-react'

interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string
  allDay: boolean
  description: string
  location: string
  calendar: 'studio' | 'smm'
  color: string
}

interface PositionedEvent {
  event: CalendarEvent
  col: number
  totalCols: number
  startMin: number
  endMin: number
}

const CALENDAR_OPTIONS = [
  { value: 'all',    label: 'Все календари' },
  { value: 'studio', label: 'Студия' },
  { value: 'smm',    label: 'SMM' },
]

const CALENDAR_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  studio: { bg: '#f0fdf6', text: '#166534', dot: '#00c26b' },
  smm:    { bg: '#eff6ff', text: '#1e40af', dot: '#3b82f6' },
}

const TITLE_LEGEND = [
  { code: 'ГГ',  label: 'Говорящая голова' },
  { code: 'ТЗ',  label: 'Тёмный зал' },
  { code: 'СЗ',  label: 'Светлый зал' },
  { code: 'Nк',  label: 'Количество камер (например 3к — 3 камеры)' },
  { code: 'Nч',  label: 'Количество человек (например 3ч — 3 человека)' },
]

const HOUR_HEIGHT = 44 // px per hour (компактная сетка)
const PX_PER_MIN = HOUR_HEIGHT / 60
const QUARTER_HEIGHT = HOUR_HEIGHT / 4
const DAY_HEIGHT = 24 * HOUR_HEIGHT
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const GUTTER_WIDTH = 52 // px

const GRID_BACKGROUND = [
  `repeating-linear-gradient(to bottom, transparent, transparent ${HOUR_HEIGHT - 1}px, #e5e7eb ${HOUR_HEIGHT - 1}px, ${HOUR_HEIGHT}px)`,
  `repeating-linear-gradient(to bottom, transparent, transparent ${QUARTER_HEIGHT - 1}px, #f3f4f6 ${QUARTER_HEIGHT - 1}px, ${QUARTER_HEIGHT}px)`,
].join(', ')

function minutesSinceMidnight(iso: string, day: Date): number {
  const d = parseISO(iso)
  if (!isSameDay(d, day)) return d < day ? 0 : 1440
  return d.getHours() * 60 + d.getMinutes()
}

function layoutDayEvents(dayEvents: CalendarEvent[], day: Date): PositionedEvent[] {
  const withTimes = dayEvents
    .map(event => ({
      event,
      startMin: minutesSinceMidnight(event.start, day),
      endMin: Math.max(minutesSinceMidnight(event.end, day), minutesSinceMidnight(event.start, day) + 15),
    }))
    .sort((a, b) => a.startMin - b.startMin)

  const result: PositionedEvent[] = []
  let cluster: PositionedEvent[] = []
  let colEnds: number[] = []
  let clusterEnd = -Infinity

  function commitCluster() {
    if (!cluster.length) return
    const totalCols = Math.max(...cluster.map(p => p.col)) + 1
    cluster.forEach(p => { p.totalCols = totalCols })
    result.push(...cluster)
    cluster = []
  }

  for (const item of withTimes) {
    if (item.startMin >= clusterEnd) {
      commitCluster()
      colEnds = []
      clusterEnd = -Infinity
    }
    let col = colEnds.findIndex(end => end <= item.startMin)
    if (col === -1) { col = colEnds.length; colEnds.push(item.endMin) }
    else { colEnds[col] = item.endMin }
    cluster.push({ event: item.event, col, totalCols: 1, startMin: item.startMin, endMin: item.endMin })
    clusterEnd = Math.max(clusterEnd, item.endMin)
  }
  commitCluster()
  return result
}

export default function ScheduleView() {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [calendarFilter, setCalendarFilter] = useState<'all' | 'studio' | 'smm'>('all')
  const [weekOffset, setWeekOffset] = useState(0)
  const [selected, setSelected] = useState<CalendarEvent | null>(null)
  const [now, setNow] = useState(new Date())
  const [showLegend, setShowLegend] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrolledOnce = useRef(false)

  const today = new Date()
  const currentWeekStart = addWeeks(startOfWeek(today, { weekStartsOn: 1 }), weekOffset)
  const currentWeekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 })

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(currentWeekStart)
    d.setDate(d.getDate() + i)
    return d
  })

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        calendar: calendarFilter,
        timeMin: currentWeekStart.toISOString(),
        timeMax: currentWeekEnd.toISOString(),
      })
      const res = await fetch(`/api/calendar/events?${params}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setEvents(data.events ?? [])
    } catch {
      setError('Не удалось загрузить события. Проверьте настройки Google Calendar.')
      setEvents([])
    } finally {
      setLoading(false)
    }
  }, [calendarFilter, weekOffset])

  useEffect(() => { fetchEvents() }, [fetchEvents])

  // Текущее время — обновляем раз в минуту для линии "сейчас"
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])

  // При первом открытии скроллим к текущему часу (с небольшим отступом сверху)
  useEffect(() => {
    if (scrolledOnce.current || !scrollRef.current) return
    const target = Math.max(0, now.getHours() - 2) * HOUR_HEIGHT
    scrollRef.current.scrollTop = target
    scrolledOnce.current = true
  }, [now])

  function eventsForDay(day: Date) {
    return events.filter(e => {
      if (e.allDay) return false
      try { return isSameDay(parseISO(e.start), day) } catch { return false }
    })
  }

  function allDayEventsForDay(day: Date) {
    return events.filter(e => {
      if (!e.allDay) return false
      try { return isSameDay(parseISO(e.start), day) } catch { return false }
    })
  }

  function formatTime(iso: string) {
    try { return format(parseISO(iso), 'HH:mm') } catch { return '' }
  }

  function jumpToEvent(event: CalendarEvent, day: Date) {
    setSelected(event)
    if (event.allDay || !scrollRef.current) return
    const startMin = minutesSinceMidnight(event.start, day)
    scrollRef.current.scrollTo({
      top: Math.max(0, startMin * PX_PER_MIN - 80),
      behavior: 'smooth',
    })
  }

  function daySummary(day: Date) {
    const dayEvents = [...eventsForDay(day)].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
    )
    return {
      events: dayEvents,
      studioCount: dayEvents.filter(e => e.calendar === 'studio').length,
      smmCount: dayEvents.filter(e => e.calendar === 'smm').length,
    }
  }

  const hasAllDayEvents = weekDays.some(d => allDayEventsForDay(d).length > 0)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()

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
            <div className="absolute left-0 top-10 z-30 w-72 card-base p-4">
              <p className="text-xs font-bold text-gray-900 mb-2">Обозначения в названиях записей</p>
              <div className="space-y-1.5">
                {TITLE_LEGEND.map(item => (
                  <div key={item.code} className="flex items-baseline gap-2 text-xs">
                    <span className="font-bold flex-shrink-0 w-8" style={{ color: '#00c26b' }}>{item.code}</span>
                    <span className="text-gray-500">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Навигация по неделям */}
      <div className="flex items-center gap-4 mb-5">
        <button
          onClick={() => setWeekOffset(w => w - 1)}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-800 hover:bg-zinc-800 transition-colors"
        >
          <ChevronLeft className="w-4 h-4 text-zinc-300" />
        </button>
        <span className="text-sm font-semibold text-white min-w-[200px] text-center">
          {format(currentWeekStart, 'd MMM', { locale: ru })} — {format(currentWeekEnd, 'd MMM yyyy', { locale: ru })}
        </span>
        <button
          onClick={() => setWeekOffset(w => w + 1)}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-800 hover:bg-zinc-800 transition-colors"
        >
          <ChevronRight className="w-4 h-4 text-zinc-300" />
        </button>
        {weekOffset !== 0 && (
          <button
            onClick={() => setWeekOffset(0)}
            className="text-xs text-zinc-500 hover:text-white underline"
          >
            Текущая неделя
          </button>
        )}
      </div>

      {error && (
        <div className="mb-5 p-4 rounded-xl bg-red-950/40 border border-red-900 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Резюме недели — отдельная карточка над календарём, колонки выровнены с сеткой ниже */}
      <div className="card-base overflow-hidden mb-5">
        <div className="px-4 pt-3 pb-2 border-b border-gray-100">
          <p className="text-xs font-bold text-gray-900 uppercase tracking-wide">Резюме по дням</p>
        </div>
        <div className="flex">
          <div style={{ width: GUTTER_WIDTH }} className="flex-shrink-0" />
          <div className="flex-1 grid grid-cols-7 divide-x divide-gray-100">
            {weekDays.map(day => {
              const { events: dayEvents, studioCount, smmCount } = loading ? { events: [], studioCount: 0, smmCount: 0 } : daySummary(day)
              return (
                <div key={day.toISOString()} className="p-2">
                  {loading ? (
                    <div className="h-4 mx-1 mt-1 rounded bg-gray-100 animate-pulse" />
                  ) : dayEvents.length === 0 ? (
                    <p className="text-[10px] text-gray-300 text-center py-1.5">—</p>
                  ) : (
                    <>
                      <div className="flex items-center justify-center gap-2 pb-1.5">
                        {studioCount > 0 && (
                          <span className="flex items-center gap-1 text-[10px] font-bold" style={{ color: CALENDAR_COLORS.studio.dot }}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: CALENDAR_COLORS.studio.dot }} />
                            {studioCount}
                          </span>
                        )}
                        {smmCount > 0 && (
                          <span className="flex items-center gap-1 text-[10px] font-bold" style={{ color: CALENDAR_COLORS.smm.dot }}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: CALENDAR_COLORS.smm.dot }} />
                            {smmCount}
                          </span>
                        )}
                      </div>
                      <div className="space-y-1 max-h-[160px] overflow-y-auto">
                        {dayEvents.map(event => {
                          const colors = CALENDAR_COLORS[event.calendar]
                          return (
                            <button
                              key={event.id}
                              onClick={() => jumpToEvent(event, day)}
                              className="w-full text-left rounded-md px-1.5 py-1 text-[10px] leading-tight transition-all hover:brightness-95"
                              style={{
                                background: colors.bg,
                                color: colors.text,
                                borderLeft: `3px solid ${colors.dot}`,
                              }}
                            >
                              <span className="font-semibold">{formatTime(event.start)}</span> {event.title}
                            </button>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Календарь */}
      <div className="card-base overflow-hidden">
        {/* Шапка дней */}
        <div className="flex border-b border-gray-200 bg-gray-50">
          <div style={{ width: GUTTER_WIDTH }} className="flex-shrink-0" />
          <div className="flex-1 grid grid-cols-7">
            {weekDays.map(day => {
              const isToday = isSameDay(day, today)
              return (
                <div key={day.toISOString()} className="border-r border-gray-200 last:border-r-0 p-2.5 text-center">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">
                    {format(day, 'EEE', { locale: ru })}
                  </p>
                  <p className={`text-lg font-bold mt-1 ${
                    isToday
                      ? 'w-8 h-8 rounded-full flex items-center justify-center mx-auto text-white'
                      : 'text-gray-900'
                  }`}
                    style={isToday ? { background: '#00c26b' } : {}}
                  >
                    {format(day, 'd')}
                  </p>
                </div>
              )
            })}
          </div>
        </div>

        {/* Весь день */}
        {hasAllDayEvents && (
          <div className="flex border-b border-gray-100">
            <div style={{ width: GUTTER_WIDTH }} className="flex-shrink-0 flex items-center justify-end pr-2">
              <span className="text-[10px] text-gray-300">весь день</span>
            </div>
            <div className="flex-1 grid grid-cols-7">
              {weekDays.map(day => (
                <div key={day.toISOString()} className="p-1.5 border-r border-gray-100 last:border-r-0 space-y-1">
                  {allDayEventsForDay(day).map(event => {
                    const colors = CALENDAR_COLORS[event.calendar]
                    return (
                      <button
                        key={event.id}
                        onClick={() => setSelected(selected?.id === event.id ? null : event)}
                        className="w-full text-left px-2 py-1 rounded-md text-[11px] font-semibold truncate transition-all hover:brightness-95"
                        style={{ background: colors.bg, color: colors.text }}
                      >
                        {event.title}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Временная сетка */}
        <div ref={scrollRef} className="flex max-h-[480px] overflow-y-auto">
          {/* Колонка часов */}
          <div style={{ width: GUTTER_WIDTH, height: DAY_HEIGHT }} className="flex-shrink-0 relative">
            {HOURS.map(hour => (
              <div
                key={hour}
                className="absolute right-2 text-[11px] font-medium text-gray-500 -translate-y-1/2"
                style={{ top: hour * HOUR_HEIGHT }}
              >
                {hour === 0 ? '' : `${String(hour).padStart(2, '0')}:00`}
              </div>
            ))}
          </div>

          {/* Колонки дней */}
          <div className="flex-1 grid grid-cols-7 relative" style={{ height: DAY_HEIGHT }}>
            {weekDays.map(day => {
              const isToday = isSameDay(day, today)
              const positioned = loading ? [] : layoutDayEvents(eventsForDay(day), day)
              return (
                <div
                  key={day.toISOString()}
                  className={`relative border-r border-gray-100 last:border-r-0 ${isToday ? 'bg-green-50/30' : ''}`}
                  style={{ backgroundImage: GRID_BACKGROUND }}
                >
                  {loading && (
                    <div className="absolute inset-x-1 top-2 space-y-1.5">
                      <div className="h-12 rounded-lg bg-gray-100 animate-pulse" />
                      <div className="h-8 rounded-lg bg-gray-100 animate-pulse opacity-60" />
                    </div>
                  )}

                  {isToday && nowMinutes >= 0 && nowMinutes <= 1440 && (
                    <div
                      className="absolute left-0 right-0 z-20 flex items-center pointer-events-none"
                      style={{ top: nowMinutes * PX_PER_MIN }}
                    >
                      <span className="w-2 h-2 rounded-full -ml-1" style={{ background: '#00c26b' }} />
                      <span className="flex-1 h-px" style={{ background: '#00c26b' }} />
                    </div>
                  )}

                  {positioned.map(({ event, col, totalCols, startMin, endMin }) => {
                    const colors = CALENDAR_COLORS[event.calendar]
                    const heightPx = Math.max((endMin - startMin) * PX_PER_MIN, 14)
                    const widthPct = 100 / totalCols
                    const showTime = heightPx >= 26
                    return (
                      <button
                        key={event.id}
                        onClick={() => setSelected(selected?.id === event.id ? null : event)}
                        className="absolute z-10 text-left rounded-md px-1.5 py-1 text-[11px] leading-tight overflow-hidden transition-all hover:brightness-95"
                        style={{
                          top: startMin * PX_PER_MIN,
                          height: heightPx,
                          left: `calc(${col * widthPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                          background: colors.bg,
                          color: colors.text,
                          borderLeft: `3px solid ${colors.dot}`,
                          boxShadow: selected?.id === event.id ? '0 0 0 2px rgba(0,0,0,0.15)' : undefined,
                        }}
                      >
                        <p className="font-semibold truncate">{event.title}</p>
                        {showTime && (
                          <p className="opacity-70 truncate">{formatTime(event.start)}–{formatTime(event.end)}</p>
                        )}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Детали события */}
      {selected && (
        <div className="mt-4 card-base p-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full"
                style={{ background: CALENDAR_COLORS[selected.calendar]?.dot }}
              />
              <h3 className="font-bold text-gray-900">{selected.title}</h3>
              <span className="text-xs text-gray-400 px-2 py-0.5 bg-gray-100 rounded-full">
                {selected.calendar === 'studio' ? 'Студия' : 'SMM'}
              </span>
            </div>
            <button onClick={() => setSelected(null)} className="text-gray-300 hover:text-gray-600 text-lg leading-none">×</button>
          </div>
          <div className="mt-3 space-y-1.5 text-sm text-gray-500">
            <p>
              <span className="font-semibold text-gray-700">Время: </span>
              {selected.allDay
                ? 'Весь день'
                : `${formatTime(selected.start)} — ${formatTime(selected.end)}`}
            </p>
            {selected.location && (
              <p><span className="font-semibold text-gray-700">Место: </span>{selected.location}</p>
            )}
            {selected.description && (
              <div>
                <span className="font-semibold text-gray-700">Описание:</span>
                <p className="whitespace-pre-wrap mt-1">{selected.description}</p>
              </div>
            )}
          </div>
        </div>
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
