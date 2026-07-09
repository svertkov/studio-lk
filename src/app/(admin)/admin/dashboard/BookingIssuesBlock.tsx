'use client'

import { useCallback, useEffect, useState } from 'react'
import { subDays } from 'date-fns'
import { AlertTriangle } from 'lucide-react'
import type { CalendarEvent } from '@/lib/google-calendar'
import { getScheduleAnnotations } from '@/lib/actions/schedule'
import {
  mergeScheduleEvent, getEffectiveEventType, getBookingAttentionInfo,
  type ScheduleEventDTO, type ScheduleEventVM,
} from '@/lib/schedule-model'
import EventCardModal from '../schedule/EventCardModal'
import AttentionSubsection, { type AttentionRecord } from './AttentionSubsection'

const LOOKBACK_DAYS = 30

function byStart(a: AttentionRecord, b: AttentionRecord) {
  return new Date(a.vm.calendarEvent.start).getTime() - new Date(b.vm.calendarEvent.start).getTime()
}

// Проверяет прошедшие STUDIO_BOOKING за последние 30 дней и делит проблемные
// на critical (карточка практически не заполнена) и warning (частично
// заполнена); полностью заполненные записи сюда вообще не попадают — см.
// getBookingAttentionInfo в schedule-model.ts, единственный источник правды
// для этой логики. Встречи, отсутствия сотрудников и служебные пометки сюда
// никогда не попадают. Полный перебор всей истории календаря был бы медленным,
// поэтому окно проверки намеренно ограничено.
//
// Два уровня рендерятся ДВУМЯ отдельными цветными панелями (AttentionSubsection)
// — красная и жёлтая больше не смешиваются в один список с построчными
// акцентами: иначе жёлтая (неполная) запись визуально терялась внутри общей
// красной рамки (владелец, 2026-07-10).
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

  const attentionRecords: AttentionRecord[] = events
    .map(ce => mergeScheduleEvent(ce, annotations[ce.id] ?? null))
    .filter(vm => !vm.calendarEvent.allDay && getEffectiveEventType(vm) === 'STUDIO_BOOKING')
    .map(vm => ({ vm, attention: getBookingAttentionInfo(vm) }))
    // 'complete' (все ключевые поля заполнены) не показываем вообще.
    .filter(r => r.attention.severity !== 'complete')

  // Явно разделённые массивы — каждый уровень рендерится своей панелью,
  // отсортированной отдельно (внутри уровня — от самых старых записей, чтобы
  // их быстрее закрывали).
  const criticalRecords = attentionRecords.filter(r => r.attention.severity === 'critical').sort(byStart)
  const warningRecords = attentionRecords.filter(r => r.attention.severity === 'warning').sort(byStart)

  const selectedVm: ScheduleEventVM | null =
    [...criticalRecords, ...warningRecords].find(r => r.vm.calendarEvent.id === selectedEventId)?.vm ?? null

  if (!loaded || attentionRecords.length === 0) return null

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="w-5 h-5 flex-shrink-0 text-zinc-400 mt-0.5" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-white font-semibold text-sm">Записи требуют внимания</h2>
            {criticalRecords.length > 0 && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-950/60 border border-red-700/60 text-red-300">
                Критичные: {criticalRecords.length}
              </span>
            )}
            {warningRecords.length > 0 && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-950/60 border border-amber-700/60 text-amber-300">
                Неполные: {warningRecords.length}
              </span>
            )}
          </div>
          <p className="text-zinc-400 text-xs mt-0.5">
            Красные — не заполнены ключевые данные. Жёлтые — карточка заполнена частично.
          </p>
        </div>
      </div>

      {criticalRecords.length > 0 && (
        <AttentionSubsection
          title="Незаполненные карточки"
          severity="critical"
          records={criticalRecords}
          onOpen={setSelectedEventId}
        />
      )}

      {warningRecords.length > 0 && (
        <AttentionSubsection
          title="Заполнены частично"
          severity="warning"
          records={warningRecords}
          onOpen={setSelectedEventId}
        />
      )}

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
