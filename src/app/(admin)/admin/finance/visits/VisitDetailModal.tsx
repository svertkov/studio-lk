'use client'

import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Info } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { RecentVisitDTO } from '@/lib/actions/finance'

interface Props {
  visit: RecentVisitDTO
  onOpenChange: (open: boolean) => void
}

function formatMoney(v: number | null) {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

const ROW = 'flex items-center justify-between py-2.5 border-b border-zinc-800/60 last:border-0'
const LABEL = 'text-zinc-500 text-xs'
const VALUE = 'text-zinc-100 text-sm text-right'

// Карточка визита — только чтение. Счёт/акт/заказ/контакты/статус действия
// из исходной Google-таблицы в базу никогда не импортировались (только дата,
// клиент, зал, формат, часы и суммы) — не выдумываем эти поля здесь.
export default function VisitDetailModal({ visit, onOpenChange }: Props) {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-800">
          <DialogTitle className="text-white text-lg font-semibold">Визит</DialogTitle>
          <p className="text-zinc-400 text-sm">
            {visit.date ? format(parseISO(visit.date), 'd MMMM yyyy', { locale: ru }) : '—'}
          </p>
        </DialogHeader>

        <div className="px-6 py-4">
          <div className={ROW}>
            <span className={LABEL}>Клиент</span>
            <Link href={`/admin/clients/${visit.clientId}`} className="text-[#00c26b] text-sm hover:underline">
              {visit.clientName}
            </Link>
          </div>
          <div className={ROW}><span className={LABEL}>Зал</span><span className={VALUE}>{visit.room ?? '—'}</span></div>
          <div className={ROW}><span className={LABEL}>Формат</span><span className={VALUE}>{visit.format ?? '—'}</span></div>
          <div className={ROW}><span className={LABEL}>Часов</span><span className={VALUE}>{visit.durationHours ?? '—'}</span></div>
          <div className={ROW}><span className={LABEL}>Выручка</span><span className={VALUE}>{formatMoney(visit.grossAmount)}</span></div>
          <div className={ROW}><span className={LABEL}>Чистая прибыль</span><span className={VALUE}>{formatMoney(visit.netAmount)}</span></div>

          {visit.comment && (
            <div className="pt-3">
              <p className={`${LABEL} mb-1`}>Примечания</p>
              <p className="text-zinc-300 text-sm whitespace-pre-wrap">{visit.comment}</p>
            </div>
          )}

          <div className="flex items-start gap-2 mt-4 bg-zinc-800/50 rounded-lg px-3 py-2.5 text-xs text-zinc-500">
            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <p>Счёт, акт, заказ и контакты из исходной таблицы пока не импортируются в базу.</p>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-zinc-800">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="w-full px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors"
          >
            Закрыть
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
