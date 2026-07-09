'use client'

import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import type { ScheduleEventVM, BookingAttentionInfo } from '@/lib/schedule-model'
import { ATTENTION_BADGE_CLASS, ATTENTION_PANEL_STYLE } from '@/lib/schedule-model'

export interface AttentionRecord {
  vm: ScheduleEventVM
  attention: BookingAttentionInfo
}

interface Props {
  title: string
  severity: 'critical' | 'warning'
  records: AttentionRecord[]
  onOpen: (eventId: string) => void
}

function formatWhen(iso: string) {
  try { return format(parseISO(iso), 'd MMM · HH:mm', { locale: ru }) } catch { return '' }
}

// Одна цветная панель одного уровня критичности внутри блока "Записи
// требуют внимания" — красная ("Незаполненные карточки") и жёлтая
// ("Заполнены частично") рендерятся этим компонентом отдельно, каждая как
// самостоятельная панель на всю ширину, а не построчными акцентами внутри
// одного общего списка (см. ATTENTION_PANEL_STYLE в schedule-model.ts).
export default function AttentionSubsection({ title, severity, records, onOpen }: Props) {
  const style = ATTENTION_PANEL_STYLE[severity]

  return (
    <div className={`rounded-xl overflow-hidden ${style.panel}`}>
      <div className={`px-5 py-3 border-b ${style.headerBorder}`}>
        <h3 className={`text-sm font-semibold ${style.headerText}`}>{title}</h3>
      </div>
      <div className="divide-y divide-white/5">
        {records.map(({ vm, attention }) => {
          const ce = vm.calendarEvent
          const a = vm.annotation
          return (
            <div key={ce.id} className="px-5 py-3.5 flex items-center justify-between gap-4 flex-wrap">
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
                  {attention.badges.map(badge => (
                    <span key={badge} className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${ATTENTION_BADGE_CLASS[severity]}`}>
                      {badge}
                    </span>
                  ))}
                </div>
              </div>
              <button
                onClick={() => onOpen(ce.id)}
                className={`flex-shrink-0 text-white text-xs font-semibold px-3.5 py-1.5 rounded-lg transition-colors ${style.button}`}
              >
                Открыть
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
