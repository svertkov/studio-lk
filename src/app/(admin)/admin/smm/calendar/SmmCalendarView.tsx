'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  format, isSameDay, isSameMonth, isToday, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
} from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Share2, Camera, AlertTriangle } from 'lucide-react'
import {
  getSmmCalendarEvents, getSmmContentItemDetail,
  type SmmProjectDTO, type SmmContentItemDetailDTO,
} from '@/lib/actions/smm'
import type { EditorProfileListItemDTO } from '@/lib/actions/editors'
import type { StaffUserDTO } from '@/lib/actions/users'
import { filterSmmCalendarEvents, type SmmCalendarEvent, type SmmCalendarEventKind } from '@/lib/smm-model'
import SmmContentItemCard from '@/components/smm/SmmContentItemCard'

const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const KIND_ICON: Record<SmmCalendarEventKind, React.ElementType> = { PUBLICATION: Share2, SHOOT: Camera, DEADLINE: AlertTriangle }
const KIND_COLOR: Record<SmmCalendarEventKind, string> = {
  PUBLICATION: 'border-blue-600/50 bg-blue-950/30 text-blue-300',
  SHOOT: 'border-[#00c26b]/50 bg-green-950/30 text-green-300',
  DEADLINE: 'border-amber-600/50 bg-amber-950/30 text-amber-300',
}

function chunkIntoWeeks(days: Date[]): Date[][] {
  const weeks: Date[][] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))
  return weeks
}

interface Props {
  projects: SmmProjectDTO[]
  initialClientFilter: string | null
  editors: EditorProfileListItemDTO[]
  staff: StaffUserDTO[]
}

// Глобальный SMM-календарь — собственная лёгкая сетка на date-fns (та же
// техника, что studio-календарь /admin/schedule/MonthView.tsx использует
// для бронирований), НЕ повторное использование того компонента: он жёстко
// завязан на ScheduleEventVM бронирований студии, а здесь разнородные
// события (публикации/съёмки/дедлайны) с другой моделью данных. Без drag &
// drop (ТЗ разрешает пропустить, если увеличивает риск) — перенос даты
// публикации делается через карточку.
export default function SmmCalendarView({ projects, initialClientFilter, editors, staff }: Props) {
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month')
  const [referenceDate, setReferenceDate] = useState(() => new Date())
  const [events, setEvents] = useState<SmmCalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [clientFilter, setClientFilter] = useState(initialClientFilter ?? 'ALL')
  const [kindFilter, setKindFilter] = useState<SmmCalendarEventKind | 'ALL'>('ALL')
  const [openDetail, setOpenDetail] = useState<SmmContentItemDetailDTO | null>(null)

  const gridStart = viewMode === 'month' ? startOfWeek(startOfMonth(referenceDate), { weekStartsOn: 1 }) : startOfWeek(referenceDate, { weekStartsOn: 1 })
  const gridEnd = viewMode === 'month' ? endOfWeek(endOfMonth(referenceDate), { weekStartsOn: 1 }) : endOfWeek(referenceDate, { weekStartsOn: 1 })
  const weeks = chunkIntoWeeks(eachDayOfInterval({ start: gridStart, end: gridEnd }))

  useEffect(() => {
    getSmmCalendarEvents(gridStart.toISOString(), gridEnd.toISOString()).then(result => {
      setLoading(false)
      if (result.ok) setEvents(result.data)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gridStart/gridEnd производные от referenceDate/viewMode, достаточно этих двух в зависимостях
  }, [referenceDate, viewMode])

  const filteredEvents = filterSmmCalendarEvents(events, { smmProjectId: clientFilter, kind: kindFilter, platform: 'ALL' })

  function eventsForDay(day: Date) {
    return filteredEvents.filter(e => isSameDay(new Date(e.date), day))
  }

  async function handleEventClick(e: SmmCalendarEvent) {
    if (e.kind === 'SHOOT') return // ссылка на заказ уже видна прямо на чипе
    if (e.contentItemId) {
      const result = await getSmmContentItemDetail(e.contentItemId)
      if (result.ok) setOpenDetail(result.data)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setReferenceDate(d => new Date(d.getFullYear(), d.getMonth(), d.getDate() - (viewMode === 'month' ? 30 : 7)))} className="p-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors"><ChevronLeft className="w-4 h-4" /></button>
          <p className="text-zinc-200 text-sm font-medium capitalize w-40 text-center">{format(referenceDate, 'LLLL yyyy', { locale: ru })}</p>
          <button type="button" onClick={() => setReferenceDate(d => new Date(d.getFullYear(), d.getMonth(), d.getDate() + (viewMode === 'month' ? 30 : 7)))} className="p-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors"><ChevronRight className="w-4 h-4" /></button>
          <button type="button" onClick={() => setReferenceDate(new Date())} className="text-xs text-zinc-500 hover:text-zinc-200 ml-1">Сегодня</button>
        </div>
        <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1 w-fit">
          <button type="button" onClick={() => setViewMode('month')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === 'month' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>Месяц</button>
          <button type="button" onClick={() => setViewMode('week')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === 'week' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>Неделя</button>
        </div>
        <div className="flex items-center gap-2">
          <select className="h-9 bg-zinc-900 border border-zinc-800 rounded-lg px-3 text-xs text-zinc-300 outline-none focus:border-[#00c26b]" value={clientFilter} onChange={e => setClientFilter(e.target.value)}>
            <option value="ALL">Все клиенты</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.clientName ?? 'Без имени'}</option>)}
          </select>
          <select className="h-9 bg-zinc-900 border border-zinc-800 rounded-lg px-3 text-xs text-zinc-300 outline-none focus:border-[#00c26b]" value={kindFilter} onChange={e => setKindFilter(e.target.value as SmmCalendarEventKind | 'ALL')}>
            <option value="ALL">Все типы</option>
            <option value="PUBLICATION">Публикации</option>
            <option value="SHOOT">Съёмки</option>
            <option value="DEADLINE">Дедлайны</option>
          </select>
        </div>
      </div>

      {loading ? (
        <p className="text-zinc-500 text-sm">Загрузка...</p>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="grid grid-cols-7 border-b border-zinc-800 bg-zinc-950/40">
            {WEEKDAY_LABELS.map(label => <div key={label} className="p-2.5 text-center text-xs text-zinc-500 uppercase tracking-wide">{label}</div>)}
          </div>
          {weeks.map((week, i) => (
            <div key={i} className="grid grid-cols-7 border-b border-zinc-800/60 last:border-b-0">
              {week.map(day => {
                const dayEvents = eventsForDay(day)
                const inMonth = viewMode === 'week' || isSameMonth(day, referenceDate)
                return (
                  <div key={day.toISOString()} className={`min-h-[110px] border-r border-zinc-800/60 last:border-r-0 p-1.5 flex flex-col gap-1 ${inMonth ? '' : 'bg-zinc-950/40'}`}>
                    <span className={`text-xs font-semibold w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${isToday(day) ? 'text-white' : inMonth ? 'text-zinc-300' : 'text-zinc-700'}`} style={isToday(day) ? { background: '#00c26b' } : {}}>
                      {format(day, 'd')}
                    </span>
                    <div className="flex-1 flex flex-col gap-1 overflow-hidden">
                      {dayEvents.map(e => {
                        const Icon = KIND_ICON[e.kind]
                        const chip = (
                          <span className={`flex items-center gap-1 px-1 py-0.5 rounded text-[10px] leading-tight truncate border ${KIND_COLOR[e.kind]}`}>
                            <Icon className="w-2.5 h-2.5 flex-shrink-0" />
                            <span className="truncate">{e.clientName ? `${e.clientName}: ` : ''}{e.title}</span>
                          </span>
                        )
                        return e.kind === 'SHOOT' && e.orderId ? (
                          <Link key={e.id} href={`/admin/crm?openOrderId=${e.orderId}`}>{chip}</Link>
                        ) : (
                          <button key={e.id} type="button" onClick={() => handleEventClick(e)} className="text-left">{chip}</button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {openDetail && (
        <SmmContentItemCard
          detail={openDetail}
          editors={editors}
          staff={staff}
          onOpenChange={open => { if (!open) setOpenDetail(null) }}
          onChanged={setOpenDetail}
          onOpenContentItem={async id => { const r = await getSmmContentItemDetail(id); if (r.ok) setOpenDetail(r.data) }}
        />
      )}
    </div>
  )
}
