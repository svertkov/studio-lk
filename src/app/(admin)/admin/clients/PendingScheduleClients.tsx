'use client'

import { useEffect, useState } from 'react'
import { format, parseISO, subDays, addDays } from 'date-fns'
import { ru } from 'date-fns/locale'
import { AlertCircle, UserPlus, Link2, X, ExternalLink } from 'lucide-react'
import {
  findSimilarClientsForEvent, confirmScheduleClient, ignoreScheduleClient,
  flagPendingClientFromEvent, getScheduleAnnotations,
  type PendingScheduleEventDTO, type SimilarClientMatch,
} from '@/lib/actions/schedule'
import { mergeScheduleEvent, type ScheduleEventVM } from '@/lib/schedule-model'
import { classifyEventType } from '@/lib/event-type'
import { parseEventTitle } from '@/lib/event-category'
import type { CalendarEvent } from '@/lib/google-calendar'
import AddClientModal from './AddClientModal'
import EventCardModal from '../schedule/EventCardModal'

interface Props {
  events: PendingScheduleEventDTO[]
  onChanged: () => void
}

// Окно, за которое проверяем студийные события на новых черновиков клиентов —
// достаточно недавнего прошлого (могли пропустить) и ближайшего будущего
// (клиента стоит завести до самой съёмки), не гонять весь календарь целиком.
const RECONCILE_LOOKBACK_DAYS = 14
const RECONCILE_LOOKAHEAD_DAYS = 14

function formatMoney(v: number | null | undefined) {
  if (v == null) return null
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

function formatWhen(startAt: string | null) {
  if (!startAt) return '—'
  try { return format(parseISO(startAt), 'd MMM, HH:mm', { locale: ru }) } catch { return '—' }
}

export default function PendingScheduleClients({ events, onChanged }: Props) {
  const [matches, setMatches] = useState<Record<string, SimilarClientMatch[]>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [addModalEventId, setAddModalEventId] = useState<string | null>(null)
  const [openVm, setOpenVm] = useState<ScheduleEventVM | null>(null)

  // Фоновая сверка: находит studio_booking события с распознанным именем
  // клиента в названии/описании, которое не совпало ни с одним существующим
  // клиентом, и заводит по ним черновик — без этого черновик появлялся только
  // если кто-то вручную открывал карточку события и жал кнопку.
  useEffect(() => {
    let cancelled = false

    async function reconcile() {
      try {
        const timeMin = subDays(new Date(), RECONCILE_LOOKBACK_DAYS).toISOString()
        const timeMax = addDays(new Date(), RECONCILE_LOOKAHEAD_DAYS).toISOString()
        const res = await fetch(`/api/calendar/events?calendar=studio&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`)
        const data = await res.json()
        const calEvents: CalendarEvent[] = data.events ?? []
        if (calEvents.length === 0) return

        const annResult = await getScheduleAnnotations(calEvents.map(e => e.id))
        let flaggedAny = false

        for (const ce of calEvents) {
          if (cancelled) return
          if (ce.allDay) continue

          const annotation = annResult.data[ce.id]
          if (annotation && annotation.clientConfirmationStatus !== 'NOT_REQUIRED') continue
          if (annotation?.clientId) continue

          const effectiveType = annotation?.eventType ?? classifyEventType(ce.title)
          if (effectiveType !== 'STUDIO_BOOKING') continue

          const parsed = parseEventTitle(ce.title, ce.description)
          if (!parsed.client) continue

          const matchResult = await findSimilarClientsForEvent({ name: parsed.client })
          if (matchResult.ok && matchResult.data.length > 0) continue

          const flagResult = await flagPendingClientFromEvent({
            calendarEventId: ce.id,
            title: ce.title,
            description: ce.description,
            startAt: ce.start,
            endAt: ce.end,
            clientNameRaw: parsed.client,
          })
          if (flagResult.ok) flaggedAny = true
        }

        if (flaggedAny && !cancelled) onChanged()
      } catch {
        // Фоновая сверка не критична — молча пропускаем при сбое (например, нет доступа к Google Calendar)
      }
    }

    reconcile()
    const interval = setInterval(reconcile, 5 * 60 * 1000)
    return () => { cancelled = true; clearInterval(interval) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (events.length === 0) return null

  async function handleConfirmClick(event: PendingScheduleEventDTO) {
    setBusyId(event.id)
    const result = await findSimilarClientsForEvent({
      name: event.clientNameRaw ?? undefined,
      contact: event.contactRaw ?? undefined,
      company: event.companyRaw ?? undefined,
    })
    setBusyId(null)
    if (result.ok && result.data.length > 0) {
      setMatches(prev => ({ ...prev, [event.id]: result.data }))
    } else {
      setAddModalEventId(event.id)
    }
  }

  async function handleLink(eventId: string, clientId: string) {
    setBusyId(eventId)
    await confirmScheduleClient(eventId, clientId)
    setBusyId(null)
    setMatches(prev => { const next = { ...prev }; delete next[eventId]; return next })
    onChanged()
  }

  async function handleIgnore(eventId: string) {
    setBusyId(eventId)
    await ignoreScheduleClient(eventId)
    setBusyId(null)
    onChanged()
  }

  async function handleOpen(event: PendingScheduleEventDTO) {
    if (!event.calendarEventId) return
    const annResult = await getScheduleAnnotations([event.calendarEventId])
    const annotation = annResult.data[event.calendarEventId] ?? null
    const calendarEvent: CalendarEvent = {
      id: event.calendarEventId,
      title: event.title ?? 'Без названия',
      start: event.startAt ?? new Date().toISOString(),
      end: event.endAt ?? new Date().toISOString(),
      allDay: false,
      description: annotation?.description ?? '',
      location: '',
      calendar: 'studio',
      color: '#00c26b',
    }
    setOpenVm(mergeScheduleEvent(calendarEvent, annotation))
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-5 pt-4 pb-3 border-b border-zinc-800">
        <h2 className="text-white font-semibold text-sm">Клиенты из расписания</h2>
        <p className="text-zinc-500 text-xs mt-0.5">Найдены в календаре, но ещё не подтверждены в базе</p>
      </div>
      <div className="divide-y divide-zinc-800">
        {events.map(event => {
          const candidateMatches = matches[event.id]
          const price = formatMoney(event.estimatedPrice)
          const isBusy = busyId === event.id
          return (
            <div key={event.id} className="px-5 py-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-start gap-3 min-w-0">
                  <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-zinc-100 text-sm font-medium truncate">
                      {event.clientNameRaw || 'Без имени'}
                      {event.contactRaw && <span className="text-zinc-500 font-normal"> · {event.contactRaw}</span>}
                    </p>
                    <p className="text-zinc-500 text-xs mt-0.5">
                      {formatWhen(event.startAt)}
                      {event.title && ` · ${event.title}`}
                      {event.room && ` · ${event.room}`}
                      {event.format && ` · ${event.format}`}
                      {price && ` · ${price}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleOpen(event)}
                    className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Открыть
                  </button>
                  <button
                    onClick={() => handleConfirmClick(event)}
                    disabled={isBusy}
                    className="flex items-center gap-1.5 bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    Подтвердить
                  </button>
                  <button
                    onClick={() => handleIgnore(event.id)}
                    disabled={isBusy}
                    className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 text-xs px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    Игнорировать
                  </button>
                </div>
              </div>

              {candidateMatches && (
                <div className="mt-3 ml-7 space-y-1.5">
                  {candidateMatches.map(c => (
                    <div key={c.id} className="flex items-center justify-between gap-3 bg-zinc-800/50 rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-zinc-200 text-xs font-medium truncate">{c.name}</p>
                        <p className="text-zinc-500 text-[11px]">{c.phone || c.email || '—'}</p>
                      </div>
                      <button
                        onClick={() => handleLink(event.id, c.id)}
                        disabled={isBusy}
                        className="flex items-center gap-1 text-xs text-[#00c26b] hover:underline disabled:opacity-50 flex-shrink-0"
                      >
                        <Link2 className="w-3 h-3" />
                        Привязать
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setAddModalEventId(event.id)}
                    className="text-xs text-zinc-400 hover:text-white underline"
                  >
                    Создать нового клиента
                  </button>
                </div>
              )}

              {addModalEventId === event.id && (
                <AddClientModal
                  key={event.id}
                  open
                  onOpenChange={open => { if (!open) setAddModalEventId(null) }}
                  onSuccess={() => {}}
                  initialValues={{
                    firstName: event.clientNameRaw ?? '',
                    contactPerson: event.clientNameRaw ?? '',
                    phone: event.contactRaw ?? '',
                    companyName: event.companyRaw ?? '',
                    source: 'OTHER',
                    customSource: 'Google Calendar',
                  }}
                  onCreated={async client => {
                    setAddModalEventId(null)
                    await confirmScheduleClient(event.id, client.id)
                    onChanged()
                  }}
                />
              )}
            </div>
          )
        })}
      </div>

      {openVm && (
        <EventCardModal
          vm={openVm}
          onOpenChange={open => { if (!open) setOpenVm(null) }}
          onSaved={() => { setOpenVm(null); onChanged() }}
        />
      )}
    </div>
  )
}
