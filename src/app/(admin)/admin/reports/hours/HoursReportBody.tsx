'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ArrowLeft, Clock } from 'lucide-react'
import { parseEventTitle, isStudioBooking } from '@/lib/event-category'
import HoursReportTable, { type HoursRow } from './HoursReportTable'

interface CalendarEvent {
  id: string
  title: string
  description: string
  start: string
  end: string
  allDay: boolean
}

function eventHours(event: CalendarEvent): number {
  const ms = new Date(event.end).getTime() - new Date(event.start).getTime()
  return Math.max(0, ms) / 3600000
}

interface Props {
  monthStart: string
  monthEnd: string
  nowIso: string
}

// Google Calendar читается клиентским фетчем к /api/calendar/events, а не напрямую
// на сервере в этом компоненте — при прямом вызове googleapis внутри серверного
// рендера эта сборка Next 16 + Turbopack падает с "ArrayBuffer is not detachable"
// (тот же класс бага, что чинили в DashboardBody/ScheduleView).
export default function HoursReportBody({ monthStart, monthEnd, nowIso }: Props) {
  const [events, setEvents] = useState<CalendarEvent[] | null>(null)
  const now = new Date(nowIso)

  useEffect(() => {
    function loadEvents() {
      fetch(`/api/calendar/events?calendar=studio&timeMin=${encodeURIComponent(monthStart)}&timeMax=${encodeURIComponent(monthEnd)}`)
        .then(res => res.json())
        .then(data => setEvents(data.events ?? []))
        .catch(() => setEvents([]))
    }
    loadEvents()
    const interval = setInterval(loadEvents, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [monthStart, monthEnd])

  const loading = events === null
  const studioEvents = (events ?? []).filter(e => !e.allDay && isStudioBooking(e.title))

  const rows: HoursRow[] = studioEvents.map(e => {
    const parsed = parseEventTitle(e.title, e.description)
    return {
      id: e.id,
      start: e.start,
      category: parsed.category,
      client: parsed.client ?? '—',
      hall: parsed.hall ?? '—',
      cameras: parsed.cameras,
      hours: eventHours(e),
    }
  })

  const totalHours = rows.reduce((sum, r) => sum + r.hours, 0)

  return (
    <div className="p-8 space-y-6">
      <div>
        <Link href="/admin/dashboard" className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-white text-sm transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Дашборд
        </Link>
        <div className="flex items-center justify-between mt-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Часы записи</h1>
            <p className="text-zinc-400 text-sm mt-1">
              {format(now, 'LLLL yyyy', { locale: ru })}
              {!loading && ` · ${totalHours.toFixed(1)} ч · ${rows.length} записей`}
            </p>
          </div>
          <div className="w-12 h-12 bg-zinc-800 rounded-lg flex items-center justify-center flex-shrink-0">
            <Clock className="w-6 h-6 text-zinc-300" />
          </div>
        </div>
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
