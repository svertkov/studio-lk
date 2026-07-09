'use client'

import {
  format, parseISO, isSameDay, isSameMonth, isToday,
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
} from 'date-fns'
import { ru } from 'date-fns/locale'
import { UserX, Coins } from 'lucide-react'
import type { ScheduleEventVM } from '@/lib/schedule-model'
import { getEffectiveEventType, getBookingAttentionInfo } from '@/lib/schedule-model'
import NasMissingBadge from './NasMissingBadge'

const MAX_CHIPS_PER_DAY = 3
const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

const CALENDAR_DOT: Record<string, string> = {
  studio: '#00c26b',
  smm:    '#3b82f6',
}

interface Props {
  month: Date
  events: ScheduleEventVM[]
  onSelectEvent: (vm: ScheduleEventVM) => void
  onSelectDay: (day: Date) => void
}

function formatTime(iso: string) {
  try { return format(parseISO(iso), 'HH:mm') } catch { return '' }
}

function chunkIntoWeeks(days: Date[]): Date[][] {
  const weeks: Date[][] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))
  return weeks
}

export default function MonthView({ month, events, onSelectEvent, onSelectDay }: Props) {
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 })
  const weeks = chunkIntoWeeks(eachDayOfInterval({ start: gridStart, end: gridEnd }))

  function eventsForDay(day: Date) {
    return events
      .filter(vm => {
        try { return isSameDay(parseISO(vm.calendarEvent.start), day) } catch { return false }
      })
      .sort((a, b) => new Date(a.calendarEvent.start).getTime() - new Date(b.calendarEvent.start).getTime())
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="grid grid-cols-7 border-b border-zinc-800 bg-zinc-950/40">
        {WEEKDAY_LABELS.map(label => (
          <div key={label} className="p-2.5 text-center text-xs text-zinc-500 uppercase tracking-wide">{label}</div>
        ))}
      </div>

      {weeks.map((week, i) => (
        <div key={i} className="grid grid-cols-7 border-b border-zinc-800/60 last:border-b-0">
          {week.map(day => {
            const dayEvents = eventsForDay(day)
            const visible = dayEvents.slice(0, MAX_CHIPS_PER_DAY)
            const overflow = dayEvents.length - visible.length
            const inMonth = isSameMonth(day, month)
            const isCurrentDay = isToday(day)
            return (
              <div
                key={day.toISOString()}
                role="button"
                tabIndex={0}
                onClick={() => onSelectDay(day)}
                onKeyDown={e => { if (e.key === 'Enter') onSelectDay(day) }}
                className={`min-h-[104px] border-r border-zinc-800/60 last:border-r-0 p-1.5 flex flex-col gap-1 cursor-pointer transition-colors hover:bg-zinc-800/40 ${inMonth ? '' : 'bg-zinc-950/40'}`}
              >
                <span
                  className={`text-xs font-semibold w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                    isCurrentDay ? 'text-white' : inMonth ? 'text-zinc-200' : 'text-zinc-700'
                  }`}
                  style={isCurrentDay ? { background: '#00c26b' } : {}}
                >
                  {format(day, 'd', { locale: ru })}
                </span>

                <div className="flex-1 flex flex-col gap-1 overflow-hidden">
                  {visible.map(vm => {
                    const ce = vm.calendarEvent
                    const dot = CALENDAR_DOT[ce.calendar]
                    const effectiveType = getEffectiveEventType(vm)

                    if (effectiveType === 'STAFF_UNAVAILABILITY') {
                      return (
                        <button
                          key={ce.id}
                          onClick={e => { e.stopPropagation(); onSelectEvent(vm) }}
                          className="flex items-center gap-1 px-1 py-0.5 rounded text-[10px] leading-tight truncate transition-all border border-amber-600/50 bg-amber-950/40 text-amber-300 hover:bg-amber-950/60"
                        >
                          <UserX className="w-2.5 h-2.5 flex-shrink-0" />
                          <span className="truncate">{ce.title}</span>
                        </button>
                      )
                    }

                    const attention = getBookingAttentionInfo(vm)
                    const isProblem = attention.severity === 'critical'
                    const isWarning = attention.severity === 'warning'
                    const nasOnlyWarning = isWarning
                      && attention.missingFields.includes('nasBackupUrl')
                      && !attention.missingFields.includes('yandexDiskUrl')
                    const paymentMissing = isWarning
                      && (attention.missingFields.includes('paymentAmount') || attention.missingFields.includes('paymentMethod'))

                    return (
                      <button
                        key={ce.id}
                        onClick={e => { e.stopPropagation(); onSelectEvent(vm) }}
                        className={`flex items-center gap-1 px-1 py-0.5 rounded text-[10px] leading-tight truncate transition-all ${
                          isProblem
                            ? 'bg-red-950/50 border border-red-600/60 text-red-300 shadow-[0_0_8px_rgba(239,68,68,0.3)] hover:bg-red-950/70'
                            : isWarning
                              ? 'bg-amber-950/50 border border-amber-600/60 text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.3)] hover:bg-amber-950/70'
                              : 'hover:brightness-125'
                        }`}
                        style={isProblem || isWarning ? undefined : { background: `${dot}26`, color: dot }}
                      >
                        {paymentMissing && <Coins className="w-2.5 h-2.5 flex-shrink-0 text-amber-400" />}
                        {nasOnlyWarning && <NasMissingBadge />}
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: isProblem ? '#ef4444' : isWarning ? '#f59e0b' : dot }} />
                        <span className="truncate">
                          {!ce.allDay && `${formatTime(ce.start)} `}{ce.title}
                        </span>
                      </button>
                    )
                  })}
                  {overflow > 0 && (
                    <span className="text-[10px] text-zinc-500 px-1">+{overflow}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
