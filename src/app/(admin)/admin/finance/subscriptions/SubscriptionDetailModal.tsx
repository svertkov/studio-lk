'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { AlertTriangle } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { getSubscriptionDetail, type SubscriptionDetailDTO } from '@/lib/actions/finance'
import {
  SUBSCRIPTION_DISPLAY_STATUS_LABELS, SUBSCRIPTION_DISPLAY_STATUS_COLORS,
  SUBSCRIPTION_ARCHIVED_BADGE_LABEL, SUBSCRIPTION_ARCHIVED_BADGE_CLASS,
  getSubscriptionDisplayStatus,
} from '@/lib/subscription-model'
import SubscriptionActionsMenu from '@/components/subscriptions/SubscriptionActionsMenu'
import type { SubscriptionRow } from '@/lib/actions/finance'

interface Props {
  subscription: SubscriptionRow
  onOpenChange: (open: boolean) => void
  onChanged?: () => void
}

function formatMoney(v: number | null) {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

function formatHours(v: number) {
  return v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)
}

function formatDate(v: string) {
  return format(parseISO(v), 'd MMM yyyy', { locale: ru })
}

const ROW = 'flex items-center justify-between py-2.5 border-b border-zinc-800/60 last:border-0'
const LABEL = 'text-zinc-500 text-xs'
const VALUE = 'text-zinc-100 text-sm text-right'

export default function SubscriptionDetailModal({ subscription, onOpenChange, onChanged }: Props) {
  const [detail, setDetail] = useState<SubscriptionDetailDTO | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getSubscriptionDetail(subscription.id).then(res => {
      if (cancelled) return
      if (res.ok) setDetail(res.data)
      else setLoadError(res.error)
    })
    return () => { cancelled = true }
  }, [subscription.id])

  const remaining = detail?.remainingHours ?? subscription.remainingHours
  const displayStatus = getSubscriptionDisplayStatus({
    status: subscription.status, isArchived: subscription.isArchived, remainingHours: remaining,
  })
  const isLow = displayStatus === 'LOW'

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-lg max-h-[85vh] flex flex-col p-0">
        {/* Управление статусом — наверху, рядом с бейджем, а не спрятано
            внизу возле "Закрыть" (владелец, 2026-07-10: старое расположение
            читалось как второстепенное действие). pr-8 держит ряд в стороне
            от закрывающего "X", который DialogContent рисует поверх, всегда
            в правом верхнем углу самого окна. */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-800 flex-shrink-0 pr-8">
          <DialogTitle className="text-white text-lg font-semibold">Абонемент</DialogTitle>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <Badge variant="outline" className={`text-xs ${SUBSCRIPTION_DISPLAY_STATUS_COLORS[displayStatus]}`}>
              {SUBSCRIPTION_DISPLAY_STATUS_LABELS[displayStatus]}
            </Badge>
            {subscription.isArchived && (
              <Badge variant="outline" className={`text-xs ${SUBSCRIPTION_ARCHIVED_BADGE_CLASS}`}>
                {SUBSCRIPTION_ARCHIVED_BADGE_LABEL}
              </Badge>
            )}
            <SubscriptionActionsMenu
              subscription={subscription}
              onChanged={() => { onChanged?.(); onOpenChange(false) }}
            />
          </div>
          <p className="text-zinc-400 text-sm mt-2">
            {subscription.clientName} · от {formatDate(subscription.purchasedAt)}
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLow && (
            <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs bg-amber-950/40 border border-amber-900 text-amber-300 mb-3">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p>Абонемент скоро закончится — осталось {formatHours(remaining)} ч.</p>
            </div>
          )}

          <div className={ROW}>
            <span className={LABEL}>Клиент</span>
            <Link href={`/admin/clients/${subscription.clientId}`} className="text-[#00c26b] text-sm hover:underline">
              {subscription.clientName}
            </Link>
          </div>
          <div className={ROW}><span className={LABEL}>Куплено часов</span><span className={VALUE}>{formatHours(subscription.packageHours)} ч</span></div>
          <div className={ROW}><span className={LABEL}>Оплачено</span><span className={VALUE}>{formatMoney(subscription.paidAmount)}</span></div>
          <div className={ROW}><span className={LABEL}>Использовано</span><span className={VALUE}>{formatHours(subscription.usedHours)} ч</span></div>
          <div className={ROW}><span className={LABEL}>Осталось</span><span className={VALUE}>{formatHours(remaining)} ч</span></div>
          <div className={ROW}><span className={LABEL}>Статус изменён</span><span className={VALUE}>{formatDate(subscription.statusUpdatedAt)}</span></div>

          {subscription.status === 'CANCELLED' && subscription.cancellationReason && (
            <div className="pt-3">
              <p className={`${LABEL} mb-1`}>Причина аннулирования</p>
              <p className="text-zinc-300 text-sm whitespace-pre-wrap">{subscription.cancellationReason}</p>
            </div>
          )}
          {subscription.status === 'REFUNDED' && (
            <div className="pt-3 space-y-1">
              {subscription.refundAmount != null && (
                <div className={ROW}><span className={LABEL}>Сумма возврата</span><span className={VALUE}>{formatMoney(subscription.refundAmount)}</span></div>
              )}
              {subscription.refundReason && (
                <div>
                  <p className={`${LABEL} mb-1`}>Причина возврата</p>
                  <p className="text-zinc-300 text-sm whitespace-pre-wrap">{subscription.refundReason}</p>
                </div>
              )}
            </div>
          )}
          {subscription.adminComment && (
            <div className="pt-3">
              <p className={`${LABEL} mb-1`}>Комментарий администратора</p>
              <p className="text-zinc-300 text-sm whitespace-pre-wrap">{subscription.adminComment}</p>
            </div>
          )}
          {detail?.notes && (
            <div className="pt-3">
              <p className={`${LABEL} mb-1`}>Заметки</p>
              <p className="text-zinc-300 text-sm whitespace-pre-wrap">{detail.notes}</p>
            </div>
          )}

          <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider mt-5 mb-2">История списаний</p>
          {loadError ? (
            <p className="text-red-400 text-xs">{loadError}</p>
          ) : detail === null ? (
            <p className="text-zinc-500 text-xs">Загрузка...</p>
          ) : detail.usages.length === 0 ? (
            <p className="text-zinc-500 text-xs">Списаний пока не было — часы будут списываться при сохранении записей расписания через эту оплату.</p>
          ) : (
            <div className="space-y-1.5">
              {detail.usages.map(u => (
                <div key={u.id} className="flex items-center justify-between gap-3 bg-zinc-800/50 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-zinc-200 text-xs font-medium truncate">
                      {format(parseISO(u.usedAt), 'd MMM yyyy', { locale: ru })}
                      {u.eventTitle && ` · ${u.eventTitle}`}
                    </p>
                    <p className="text-zinc-500 text-[11px]">
                      {[u.eventRoom, u.eventFormat].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  <span className="text-zinc-300 text-xs font-medium flex-shrink-0">{formatHours(u.usedHours)} ч</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Только "Закрыть" — управление статусом больше не живёт здесь. */}
        <div className="px-6 py-4 border-t border-zinc-800 flex-shrink-0">
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
