'use client'

import { format, parseISO, isSameDay, isToday } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Coins } from 'lucide-react'
import type { ScheduleEventVM } from '@/lib/schedule-model'
import {
  getEffectiveEventType, getBookingIssues, hasDangerIssue, hasPaymentIssue, shouldShowMaterialsBadge,
  PROBLEM_GLOW_CARD_CLASS,
} from '@/lib/schedule-model'
import { EVENT_TYPE_LABELS } from '@/lib/event-type'
import MaterialsStatusBadge from './MaterialsStatusBadge'
import StaffAbsenceBadge from './StaffAbsenceBadge'

interface Props {
  weekDays: Date[]
  events: ScheduleEventVM[]
  onSelectEvent: (vm: ScheduleEventVM) => void
}

function formatTime(iso: string) {
  try { return format(parseISO(iso), 'HH:mm') } catch { return '' }
}

function eventsForDay(events: ScheduleEventVM[], day: Date) {
  return events
    .filter(vm => { try { return isSameDay(parseISO(vm.calendarEvent.start), day) } catch { return false } })
    .sort((a, b) => new Date(a.calendarEvent.start).getTime() - new Date(b.calendarEvent.start).getTime())
}

function shortFormatLine(a: ScheduleEventVM['annotation']) {
  const parts = [a?.format, a?.room, a?.camerasCount != null ? `${a.camerasCount}к` : null].filter(Boolean)
  return parts.join(' · ')
}

export default function WeekView({ weekDays, events, onSelectEvent }: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
      {weekDays.map(day => {
        const dayEvents = eventsForDay(events, day)
        const absences = dayEvents.filter(vm => getEffectiveEventType(vm) === 'STAFF_UNAVAILABILITY')
        const bookings = dayEvents.filter(vm => getEffectiveEventType(vm) !== 'STAFF_UNAVAILABILITY')
        const today = isToday(day)
        return (
          <div
            key={day.toISOString()}
            className={`bg-zinc-900 border rounded-xl overflow-hidden flex flex-col ${today ? 'border-[#00c26b]/50' : 'border-zinc-800'}`}
          >
            <div className="px-3 py-2.5 border-b border-zinc-800 flex items-center justify-between flex-shrink-0">
              <div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{format(day, 'EEE', { locale: ru })}</p>
                <p className={`text-sm font-bold mt-0.5 ${today ? 'text-[#00c26b]' : 'text-white'}`}>
                  {format(day, 'd MMM', { locale: ru })}
                </p>
              </div>
              {bookings.length > 0 && (
                <span className="text-[10px] font-semibold text-zinc-400 bg-zinc-800 rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">
                  {bookings.length}
                </span>
              )}
            </div>

            <div className="p-2 space-y-1.5 max-h-[420px] overflow-y-auto flex-1">
              {absences.length > 0 && (
                <div className="space-y-1.5 pb-1.5 mb-1.5 border-b border-zinc-800/70">
                  {absences.map(vm => (
                    <StaffAbsenceBadge key={vm.calendarEvent.id} title={vm.calendarEvent.title} />
                  ))}
                </div>
              )}

              {bookings.length === 0 ? (
                absences.length === 0 && <p className="text-zinc-600 text-xs text-center py-4">Нет записей</p>
              ) : (
                bookings.map(vm => {
                  const effectiveType = getEffectiveEventType(vm)
                  const isBooking = effectiveType === 'STUDIO_BOOKING'
                  const issues = getBookingIssues(vm)
                  const isProblem = hasDangerIssue(issues)
                  const paymentMissing = hasPaymentIssue(issues)
                  const formatLine = shortFormatLine(vm.annotation)
                  return (
                    <button
                      key={vm.calendarEvent.id}
                      onClick={() => onSelectEvent(vm)}
                      className={`w-full text-left rounded-lg px-2.5 py-2 text-xs transition-colors ${
                        isProblem
                          ? `${PROBLEM_GLOW_CARD_CLASS} hover:bg-red-950/40`
                          : 'bg-zinc-800/60 border border-zinc-800 hover:bg-zinc-800'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="font-semibold text-zinc-200">
                          {vm.calendarEvent.allDay ? 'Весь день' : formatTime(vm.calendarEvent.start)}
                        </span>
                        {isBooking ? (
                          <span className="flex items-center gap-1 flex-shrink-0">
                            {paymentMissing && (
                              <span title="Оплата не указана" className="inline-flex">
                                <Coins className="w-3.5 h-3.5 text-amber-400" />
                              </span>
                            )}
                            {shouldShowMaterialsBadge(vm) && (
                              <MaterialsStatusBadge
                                status={vm.annotation?.materialsStatus ?? 'NO_LINKS'}
                                nasBackupUrl={vm.annotation?.nasBackupUrl}
                              />
                            )}
                          </span>
                        ) : (
                          <span className="text-[10px] text-zinc-500 bg-zinc-900 px-1.5 py-0.5 rounded-full flex-shrink-0">
                            {EVENT_TYPE_LABELS[effectiveType]}
                          </span>
                        )}
                      </div>
                      <p className="text-zinc-100 font-medium truncate mt-0.5">{vm.calendarEvent.title}</p>
                      {isBooking && vm.annotation?.clientName && (
                        <p className="text-zinc-400 truncate">{vm.annotation.clientName}</p>
                      )}
                      {isBooking && formatLine && <p className="text-zinc-500 truncate">{formatLine}</p>}
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
