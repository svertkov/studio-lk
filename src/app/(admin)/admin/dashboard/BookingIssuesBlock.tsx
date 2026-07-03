'use client'

import { useCallback, useEffect, useState } from 'react'
import { format, parseISO, subDays } from 'date-fns'
import { ru } from 'date-fns/locale'
import { AlertTriangle } from 'lucide-react'
import type { CalendarEvent } from '@/lib/google-calendar'
import { getScheduleAnnotations } from '@/lib/actions/schedule'
import {
  mergeScheduleEvent, getEffectiveEventType, getBookingIssues, hasDangerIssue,
  type IssueSeverity, type ScheduleEventDTO, type ScheduleEventVM,
} from '@/lib/schedule-model'
import EventCardModal from '../schedule/EventCardModal'

const LOOKBACK_DAYS = 30

const ISSUE_BADGE_CLASS: Record<IssueSeverity, string> = {
  danger:  'bg-red-950/50 border border-red-700/60 text-red-300',
  warning: 'bg-amber-950/50 border border-amber-700/60 text-amber-300',
}

function formatWhen(iso: string) {
  try { return format(parseISO(iso), 'd MMM · HH:mm', { locale: ru }) } catch { return '' }
}

function recordWord(n: number) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'запись'
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'записи'
  return 'записей'
}

// Проверяет прошедшие STUDIO_BOOKING за последние 30 дней и находит те, у
// которых есть проблема (нет материалов, истёкшая ссылка без бэкапа, не
// указана оплата). Встречи, отсутствия сотрудников и служебные пометки сюда
// никогда не попадают. Полный перебор всей истории календаря был бы медленным,
// поэтому окно проверки намеренно ограничено.
export default function BookingIssuesBlock() {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [annotations, setAnnotations] = useState<Record<string, ScheduleEventDTO>>({})
  const [loaded, setLoaded] = useState(false)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)

  const fetchProblems = useCallback(async () => {
    try {
      const timeMin = subDays(new Date(), LOOKBACK_DAYS).toISOString()
      const timeMax = new Date().toISOString()
      const res = await fetch(`/api/calendar/events?calendar=studio&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`)
      const data = await res.json()
      const evs: CalendarEvent[] = data.events ?? []
      setEvents(evs)
      const annResult = await getScheduleAnnotations(evs.map(e => e.id))
      setAnnotations(annResult.data)
    } catch {
      setEvents([])
      setAnnotations({})
    } finally {
      setLoaded(true)
    }
  }, [])

  // Автообновление раз в 5 минут — записи "краснеют" по времени (истечение
  // льготного периода после съёмки), поэтому список должен обновляться сам,
  // а не только при перезагрузке страницы.
  useEffect(() => {
    fetchProblems()
    const interval = setInterval(fetchProblems, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchProblems])

  const vms = events.map(ce => mergeScheduleEvent(ce, annotations[ce.id] ?? null))
  const problems = vms
    .filter(vm => !vm.calendarEvent.allDay && getEffectiveEventType(vm) === 'STUDIO_BOOKING' && getBookingIssues(vm).length > 0)
    .sort((a, b) => new Date(a.calendarEvent.start).getTime() - new Date(b.calendarEvent.start).getTime())

  const selectedVm: ScheduleEventVM | null = problems.find(vm => vm.calendarEvent.id === selectedEventId) ?? null
  const anyDanger = problems.some(vm => hasDangerIssue(getBookingIssues(vm)))

  if (!loaded || problems.length === 0) return null

  const accent = anyDanger
    ? { border: 'border-red-600/50', bg: 'bg-red-950/20', glow: 'shadow-[0_0_20px_rgba(239,68,68,0.12)]', headerBorder: 'border-red-900/40', icon: 'text-red-400', button: 'bg-red-600 hover:bg-red-500' }
    : { border: 'border-amber-600/50', bg: 'bg-amber-950/20', glow: 'shadow-[0_0_20px_rgba(245,158,11,0.12)]', headerBorder: 'border-amber-900/40', icon: 'text-amber-400', button: 'bg-amber-600 hover:bg-amber-500' }

  return (
    <div className={`border ${accent.border} ${accent.bg} rounded-xl ${accent.glow} overflow-hidden`}>
      <div className={`px-6 py-4 border-b ${accent.headerBorder} flex items-center gap-2.5`}>
        <AlertTriangle className={`w-5 h-5 flex-shrink-0 ${accent.icon}`} />
        <div>
          <h2 className="text-white font-semibold text-sm">Записи требуют внимания</h2>
          <p className="text-zinc-400 text-xs mt-0.5">
            {problems.length} {recordWord(problems.length)} за последние {LOOKBACK_DAYS} дней с незаполненными материалами или оплатой
          </p>
        </div>
      </div>
      <div className="divide-y divide-zinc-800/60">
        {problems.map(vm => {
          const issues = getBookingIssues(vm)
          const ce = vm.calendarEvent
          const a = vm.annotation
          return (
            <div key={ce.id} className="px-6 py-3.5 flex items-center justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <p className="text-zinc-100 text-sm font-medium truncate">
                  {formatWhen(ce.start)} · {ce.title}
                </p>
                <p className="text-zinc-400 text-xs mt-0.5 truncate">
                  {a?.clientName && `${a.clientName} · `}
                  {a?.room && `${a.room} · `}
                  {a?.format && `${a.format}`}
                </p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {issues.map(issue => (
                    <span key={issue.type} className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${ISSUE_BADGE_CLASS[issue.severity]}`}>
                      {issue.label}
                    </span>
                  ))}
                </div>
              </div>
              <button
                onClick={() => setSelectedEventId(ce.id)}
                className={`flex-shrink-0 text-white text-xs font-semibold px-3.5 py-1.5 rounded-lg transition-colors ${accent.button}`}
              >
                Открыть
              </button>
            </div>
          )
        })}
      </div>

      {selectedVm && (
        <EventCardModal
          vm={selectedVm}
          onOpenChange={open => { if (!open) setSelectedEventId(null) }}
          onSaved={fetchProblems}
        />
      )}
    </div>
  )
}
