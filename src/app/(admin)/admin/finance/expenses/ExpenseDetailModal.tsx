'use client'

import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import type { ExpenseRowDTO } from '@/lib/actions/expenses'
import { PLAN_FACT_STATUS_LABELS, PLAN_FACT_STATUS_COLORS } from '@/lib/expense-model'

interface Props {
  expense: ExpenseRowDTO
  onOpenChange: (open: boolean) => void
}

function formatMoney(v: number) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

const ROW = 'flex items-center justify-between py-2.5 border-b border-zinc-800/60 last:border-0'
const LABEL = 'text-zinc-500 text-xs'
const VALUE = 'text-zinc-100 text-sm text-right'

export default function ExpenseDetailModal({ expense, onOpenChange }: Props) {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-800">
          <DialogTitle className="text-white text-lg font-semibold">{expense.title}</DialogTitle>
          <p className="text-zinc-400 text-sm">
            {expense.date ? format(parseISO(expense.date), 'd MMMM yyyy', { locale: ru }) : 'Дата не указана'}
          </p>
        </DialogHeader>

        <div className="px-6 py-4">
          <div className={ROW}>
            <span className={LABEL}>Категория</span>
            <span className={VALUE}>{expense.category}</span>
          </div>
          <div className={ROW}>
            <span className={LABEL}>Плановая сумма</span>
            <span className={VALUE}>{formatMoney(expense.plannedAmount)}</span>
          </div>
          <div className={ROW}>
            <span className={LABEL}>Оплачено факт.</span>
            <span className={VALUE}>{formatMoney(expense.actualAmount)}</span>
          </div>
          <div className={ROW}>
            <span className={LABEL}>Остаток к оплате</span>
            <span className={VALUE}>{formatMoney(expense.remainingAmount)}</span>
          </div>
          <div className={ROW}>
            <span className={LABEL}>Статус оплаты</span>
            <Badge variant="outline" className={`text-xs ${PLAN_FACT_STATUS_COLORS[expense.planFactStatus]}`}>
              {PLAN_FACT_STATUS_LABELS[expense.planFactStatus]}
            </Badge>
          </div>
          {expense.rawStatus && (
            <div className={ROW}><span className={LABEL}>Статус в таблице</span><span className={VALUE}>{expense.rawStatus}</span></div>
          )}
          {expense.orderedBy && (
            <div className={ROW}><span className={LABEL}>Кто заказал</span><span className={VALUE}>{expense.orderedBy}</span></div>
          )}
          {expense.paidBy && (
            <div className={ROW}><span className={LABEL}>Кто оплатил</span><span className={VALUE}>{expense.paidBy}</span></div>
          )}
          {expense.receivedBy && (
            <div className={ROW}><span className={LABEL}>Кто получил</span><span className={VALUE}>{expense.receivedBy}</span></div>
          )}

          {expense.comment && (
            <div className="pt-3">
              <p className={`${LABEL} mb-1`}>Комментарий</p>
              <p className="text-zinc-300 text-sm whitespace-pre-wrap">{expense.comment}</p>
            </div>
          )}
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
