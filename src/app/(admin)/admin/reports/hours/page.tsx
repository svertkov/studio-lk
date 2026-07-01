import Link from 'next/link'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ArrowLeft, Clock } from 'lucide-react'
import { fetchCalendarEvents, type CalendarEvent } from '@/lib/google-calendar'
import { parseEventTitle, isStudioBooking } from '@/lib/event-category'
import HoursReportTable, { type HoursRow } from './HoursReportTable'

function eventHours(event: CalendarEvent): number {
  const ms = new Date(event.end).getTime() - new Date(event.start).getTime()
  return Math.max(0, ms) / 3600000
}

export default async function HoursReportPage() {
  const now = new Date()
  const monthStart = startOfMonth(now).toISOString()
  const monthEnd = endOfMonth(now).toISOString()

  const events = await fetchCalendarEvents('studio', monthStart, monthEnd).catch(() => [] as CalendarEvent[])
  const studioEvents = events.filter(e => !e.allDay && isStudioBooking(e.title))

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
              {format(now, 'LLLL yyyy', { locale: ru })} · {totalHours.toFixed(1)} ч · {rows.length} записей
            </p>
          </div>
          <div className="w-12 h-12 bg-zinc-800 rounded-lg flex items-center justify-center flex-shrink-0">
            <Clock className="w-6 h-6 text-zinc-300" />
          </div>
        </div>
      </div>

      <HoursReportTable rows={rows} />
    </div>
  )
}
