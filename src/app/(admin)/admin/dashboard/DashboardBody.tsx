'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Users, Mic2, TrendingUp } from 'lucide-react'
import { categorizeEvent, colorForCategory, isStudioBooking } from '@/lib/event-category'
import MetricCard from '@/components/ui/metric-card'
import HoursStatCard from './HoursStatCard'
import BookingIssuesBlock from './BookingIssuesBlock'

interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string
  allDay: boolean
}

function eventHours(event: CalendarEvent): number {
  const ms = new Date(event.end).getTime() - new Date(event.start).getTime()
  return Math.max(0, ms) / 3600000
}

interface Props {
  clientsTotal: number
  monthStart: string
  monthEnd: string
  nowIso: string
}

// Google Calendar читается клиентским фетчем к /api/calendar/events, а не напрямую
// на сервере в этом компоненте — при прямом вызове googleapis внутри серверного
// рендера эта сборка Next 16 + Turbopack падает с "ArrayBuffer is not detachable"
// (тот же класс бага, что чинили в ScheduleView — там это уже работает так же).
export default function DashboardBody({ clientsTotal, monthStart, monthEnd, nowIso }: Props) {
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
    // Автообновление раз в 5 минут, чтобы новые записи и статусы подтягивались сами
    const interval = setInterval(loadEvents, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [monthStart, monthEnd])

  const monthlyStudioEvents = (events ?? []).filter(e => !e.allDay && isStudioBooking(e.title))
  const totalMonthHours = monthlyStudioEvents.reduce((sum, e) => sum + eventHours(e), 0)
  const todayEvents = monthlyStudioEvents.filter(e => new Date(e.start).toDateString() === now.toDateString())

  const categoryMap = new Map<string, { hours: number; events: CalendarEvent[] }>()
  for (const e of monthlyStudioEvents) {
    const cat = categorizeEvent(e.title)
    const entry = categoryMap.get(cat) ?? { hours: 0, events: [] }
    entry.hours += eventHours(e)
    entry.events.push(e)
    categoryMap.set(cat, entry)
  }
  const categoryBreakdown = Array.from(categoryMap.entries())
    .map(([name, { hours, events: catEvents }]) => ({
      name,
      hours,
      color: colorForCategory(name),
      events: [...catEvents].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()),
    }))
    .sort((a, b) => b.hours - a.hours)

  const loading = events === null

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">
          {format(now, 'd MMMM yyyy', { locale: ru })}
        </h1>
        <p className="text-zinc-400 text-sm mt-1">Обзор студии</p>
      </div>

      <BookingIssuesBlock />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <MetricCard
          icon={Users}
          label="Клиентов"
          value={String(clientsTotal)}
          padding="p-7"
          valueClassName="text-4xl mt-3"
          iconWrapperClassName="w-14 h-14"
          iconClassName="w-7 h-7 text-zinc-300"
          labelClassName="text-zinc-400 text-sm uppercase tracking-wider"
        />

        {loading ? (
          <>
            {[0, 1, 2].map(i => (
              <Card key={i} className="bg-zinc-900 border-zinc-800">
                <CardContent className="p-7 h-[124px] flex items-center justify-center">
                  <p className="text-zinc-600 text-sm">Загрузка...</p>
                </CardContent>
              </Card>
            ))}
          </>
        ) : (
          <>
            <HoursStatCard
              categories={categoryBreakdown}
              totalHours={totalMonthHours}
              recordsCount={monthlyStudioEvents.length}
            />

            <MetricCard
              icon={Mic2}
              label="Сегодня"
              value={String(todayEvents.length)}
              subtitle="записей в расписании"
              padding="p-7"
              valueClassName="text-4xl mt-3"
              iconWrapperClassName="w-14 h-14"
              iconClassName="w-7 h-7 text-zinc-300"
              labelClassName="text-zinc-400 text-sm uppercase tracking-wider"
              subtitleClassName="text-zinc-400 text-xs"
            />

            <MetricCard
              icon={TrendingUp}
              label="За месяц"
              value={String(monthlyStudioEvents.length)}
              subtitle="записей в студии"
              padding="p-7"
              valueClassName="text-4xl mt-3"
              iconWrapperClassName="w-14 h-14"
              iconClassName="w-7 h-7 text-zinc-300"
              labelClassName="text-zinc-400 text-sm uppercase tracking-wider"
              subtitleClassName="text-zinc-400 text-xs"
            />
          </>
        )}
      </div>

      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-white text-base">Записи сегодня из Google Календаря</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <p className="text-zinc-500 text-sm text-center py-6">Загрузка...</p>
          ) : todayEvents.length > 0 ? (
            todayEvents.map(event => (
              <div key={event.id} className="flex items-center justify-between p-3 bg-zinc-800 rounded-lg">
                <div>
                  <p className="text-white text-sm font-medium">{event.title}</p>
                  <p className="text-zinc-400 text-xs mt-0.5">
                    {format(new Date(event.start), 'HH:mm')} – {format(new Date(event.end), 'HH:mm')}
                  </p>
                </div>
                <span className="text-zinc-400 text-xs">{eventHours(event).toFixed(1)} ч</span>
              </div>
            ))
          ) : (
            <p className="text-zinc-400 text-sm text-center py-6">Записей на сегодня нет</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
