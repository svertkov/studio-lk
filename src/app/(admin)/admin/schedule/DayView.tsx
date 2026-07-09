'use client'

import { format, parseISO, isSameDay } from 'date-fns'
import { Coins } from 'lucide-react'
import type { ScheduleEventVM } from '@/lib/schedule-model'
import {
  getEffectiveEventType, getBookingAttentionInfo, shouldShowMaterialsBadge,
  CRITICAL_GLOW_CARD_CLASS, WARNING_GLOW_CARD_CLASS,
} from '@/lib/schedule-model'
import { EVENT_TYPE_LABELS } from '@/lib/event-type'
import MaterialsStatusBadge from './MaterialsStatusBadge'
import StaffAbsenceBadge from './StaffAbsenceBadge'

interface Props {
  day: Date
  events: ScheduleEventVM[]
  onSelectEvent: (vm: ScheduleEventVM) => void
}

function formatMoney(v: number | null | undefined) {
  if (v == null) return null
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

export default function DayView({ day, events, onSelectEvent }: Props) {
  const dayVms = events
    .filter(vm => {
      try { return isSameDay(parseISO(vm.calendarEvent.start), day) } catch { return false }
    })
    .sort((a, b) => new Date(a.calendarEvent.start).getTime() - new Date(b.calendarEvent.start).getTime())

  // Отсутствия сотрудников — не съёмки, показываем отдельным блоком над списком.
  const absences = dayVms.filter(vm => getEffectiveEventType(vm) === 'STAFF_UNAVAILABILITY')
  const bookings = dayVms.filter(vm => getEffectiveEventType(vm) !== 'STAFF_UNAVAILABILITY')

  return (
    <div className="space-y-3">
      {absences.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {absences.map(vm => (
            <StaffAbsenceBadge key={vm.calendarEvent.id} title={vm.calendarEvent.title} />
          ))}
        </div>
      )}

      {bookings.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-10 text-center">
          <p className="text-zinc-500 text-sm">На этот день записей нет</p>
        </div>
      ) : (
        bookings.map(vm => {
          const { calendarEvent: ce, annotation: a } = vm
          const effectiveType = getEffectiveEventType(vm)
          const isBooking = effectiveType === 'STUDIO_BOOKING'
          const attention = getBookingAttentionInfo(vm)
          const isProblem = attention.severity === 'critical'
          const isWarning = attention.severity === 'warning'
          const paymentMissing = isWarning
            && (attention.missingFields.includes('paymentAmount') || attention.missingFields.includes('paymentMethod'))
          const materialsStatus = a?.materialsStatus ?? 'NO_LINKS'
          const price = formatMoney(a?.estimatedPrice)

          return (
            <button
              key={ce.id}
              onClick={() => onSelectEvent(vm)}
              className={`w-full text-left border rounded-xl p-5 transition-colors ${
                isProblem
                  ? `${CRITICAL_GLOW_CARD_CLASS} hover:bg-red-950/40`
                  : isWarning
                    ? `${WARNING_GLOW_CARD_CLASS} hover:bg-amber-950/40`
                    : 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800/60'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ background: ce.calendar === 'studio' ? '#00c26b' : '#3b82f6' }}
                  />
                  <p className="font-bold text-white truncate">
                    {ce.allDay ? 'Весь день' : `${format(parseISO(ce.start), 'HH:mm')}–${format(parseISO(ce.end), 'HH:mm')}`}
                    {' '}{ce.title}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {isBooking ? (
                    <>
                      {paymentMissing && (
                        <span title="Оплата не указана" className="inline-flex">
                          <Coins className="w-4 h-4 text-amber-400" />
                        </span>
                      )}
                      {shouldShowMaterialsBadge(vm) && (
                        <MaterialsStatusBadge status={materialsStatus} nasBackupUrl={a?.nasBackupUrl} showLabel />
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">
                      {EVENT_TYPE_LABELS[effectiveType]}
                    </span>
                  )}
                </div>
              </div>
              {isBooking && (
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-zinc-400">
                  {a?.clientName && <p><span className="text-zinc-500">Клиент: </span>{a.clientName}</p>}
                  {a?.room && <p><span className="text-zinc-500">Зал: </span>{a.room}</p>}
                  {a?.format && <p><span className="text-zinc-500">Формат: </span>{a.format}</p>}
                  {a?.camerasCount != null && <p><span className="text-zinc-500">Камер: </span>{a.camerasCount}</p>}
                  {price && <p><span className="text-zinc-500">Стоимость: </span>{price}</p>}
                </div>
              )}
              {a?.notes && (
                <p className="mt-2 text-zinc-500 text-xs whitespace-pre-wrap">{a.notes}</p>
              )}
            </button>
          )
        })
      )}
    </div>
  )
}
